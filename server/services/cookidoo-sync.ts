import {
  Prisma,
  type PrismaClient,
  type CookidooConnection,
  type ShoppingListItem,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Config } from "../lib/config";
import { RecipeError } from "../lib/errors";
import { connectionSecrets } from "../lib/connection-secrets";
import { lockHousehold, membership } from "./household-access";
import { normalizedQuantity } from "../../shared/planning";
import {
  planCookidooSync,
  syncEqual,
  localState,
  remoteState,
  remoteLabel,
  type SyncLocal,
  type SyncState,
  type SyncPair,
  type SyncUnit,
  type SyncConflict,
  type SyncResolution,
} from "../../shared/cookidoo-sync";
import {
  pythonCookidooProvider,
  type CookidooProvider,
  type CookidooToken,
  type RemoteShoppingItem,
  type CookidooAction,
} from "../integrations/cookidoo-provider";
type Report = {
  units: number;
  conflicts: SyncConflict[];
  remoteCount: number;
  localCount: number;
};
type Pending = {
  unit: SyncUnit;
  action: CookidooAction;
  local: SyncLocal | null;
  priorKeys: string[];
  result?: RemoteShoppingItem | null;
  done?: boolean;
};
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const same = syncEqual;
const dto = (item: ShoppingListItem): SyncLocal => ({
  id: item.id,
  name: item.name,
  amount: item.amount?.toString() ?? null,
  unit: item.unit,
  note: item.note,
  checked: item.checked,
});
const txOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  timeout: 20000,
  maxWait: 10000,
};
export function cookidooSync(
  db: PrismaClient,
  config: Config,
  provider: CookidooProvider = pythonCookidooProvider,
) {
  const secrets = connectionSecrets(config);
  let stopping = false;
  async function own(userId: string) {
    const connection = await db.cookidooConnection.findUnique({
      where: { userId },
      include: { list: { select: { name: true } } },
    });
    if (connection) await membership(db, userId, connection.householdId);
    return connection;
  }
  async function writer(
    tx: Prisma.TransactionClient,
    connection: CookidooConnection,
    runToken?: string,
  ) {
    await lockHousehold(tx, connection.householdId);
    await membership(tx, connection.userId, connection.householdId, true);
    if (
      (
        await tx.accountStatus.findUnique({
          where: { userId: connection.userId },
        })
      )?.disabled
    )
      throw new RecipeError(403, "Konto gesperrt.");
    const current = await tx.cookidooConnection.findUnique({
      where: { id: connection.id },
    });
    if (!current || (runToken && current.runToken !== runToken))
      throw new RecipeError(409, "Abgleich wurde beendet.");
    return current;
  }
  async function tokens(
    connection: CookidooConnection,
    result: { tokens?: CookidooToken | null },
    runToken?: string,
  ) {
    if (result.tokens)
      await db.cookidooConnection.updateMany({
        where: { id: connection.id, ...(runToken ? { runToken } : {}) },
        data: { encryptedTokens: await secrets.encrypt(result.tokens) },
      });
  }
  async function remote(
    connection: CookidooConnection,
    operation: "read" | "apply",
    action?: CookidooAction,
    runToken?: string,
  ) {
    const fresh = await db.cookidooConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    const result = await provider.call({
      operation,
      market: connection.market,
      tokens: await secrets.decrypt<CookidooToken>(fresh.encryptedTokens),
      action,
    });
    await tokens(connection, result, runToken);
    if (!result.ok)
      throw new RecipeError(
        result.code === "AUTH" ? 401 : result.code === "CONFLICT" ? 409 : 502,
        result.code === "AUTH"
          ? "Cookidoo-Anmeldung abgelaufen. Bitte erneut verbinden."
          : result.code === "CONFLICT"
            ? "Cookidoo wurde parallel geändert."
            : "Cookidoo ist derzeit nicht verfügbar.",
      );
    if (!result.items || result.items.length > 1000)
      throw new RecipeError(502, "Cookidoo-Liste nicht lesbar.");
    return result;
  }
  async function state(connection: CookidooConnection, runToken: string) {
    return db.$transaction(async (tx) => {
      const current = await writer(tx, connection, runToken);
      const list = await tx.shoppingList.findUniqueOrThrow({
        where: { id: connection.listId },
        include: { items: { orderBy: { id: "asc" } } },
      });
      const links = await tx.cookidooItemLink.findMany({
        where: { connectionId: connection.id },
        orderBy: { id: "asc" },
      });
      const pairs: SyncPair[] = links.map((link) => ({
        id: link.id,
        localId: link.localItemId,
        remoteKey: link.remoteKey,
        local: link.localBaseJson as unknown as SyncState,
        remote: link.remoteBaseJson as unknown as RemoteShoppingItem,
      }));
      return { current, list: { ...list, items: list.items.map(dto) }, pairs };
    }, txOptions);
  }
  async function savePair(
    tx: Prisma.TransactionClient,
    connection: CookidooConnection,
    unit: SyncUnit,
    local: SyncLocal | null,
    r: RemoteShoppingItem,
    baseline?: SyncState,
  ) {
    const values = {
      localItemId: local?.id ?? null,
      remoteKey: r.key,
      localBaseJson: json(
        baseline ?? (local ? localState(local) : unit.desired!),
      ),
      remoteBaseJson: json(r),
    };
    if (unit.pairId)
      await tx.cookidooItemLink.update({
        where: { id: unit.pairId },
        data: values,
      });
    else
      await tx.cookidooItemLink.create({
        data: { connectionId: connection.id, ...values },
      });
  }
  async function commitUnit(
    connection: CookidooConnection,
    runToken: string,
    unit: SyncUnit,
    original: SyncLocal | null,
    remoteItem: RemoteShoppingItem | null,
    pending = false,
  ) {
    await db.$transaction(async (tx) => {
      const current = await writer(tx, connection, runToken);
      const row = unit.localId
        ? await tx.shoppingListItem.findFirst({
            where: { id: unit.localId, listId: connection.listId },
          })
        : null;
      let local = row ? dto(row) : null;
      const unchanged = same(
        local ? localState(local) : null,
        original ? localState(original) : null,
      );
      if (!pending && !unchanged)
        throw new RecipeError(409, "Einkaufsliste wurde parallel geändert.");
      let changed = false;
      if (unit.kind === "UNLINK") {
        const ignoredLocal = current.ignoredLocalJson as string[],
          ignoredRemote = current.ignoredRemoteJson as string[];
        const remoteKey =
          unit.remote?.key ??
          (unit.pairId
            ? (
                await tx.cookidooItemLink.findUnique({
                  where: { id: unit.pairId },
                })
              )?.remoteKey
            : undefined);
        await tx.cookidooConnection.update({
          where: { id: connection.id },
          data: {
            ignoredLocalJson: unit.localId
              ? [...new Set([...ignoredLocal, unit.localId])]
              : ignoredLocal,
            ignoredRemoteJson: remoteKey
              ? [...new Set([...ignoredRemote, remoteKey])]
              : ignoredRemote,
          },
        });
        if (unit.pairId)
          await tx.cookidooItemLink.delete({ where: { id: unit.pairId } });
      } else if (
        ["FORGET", "DELETE_REMOTE", "DELETE_LOCAL"].includes(unit.kind)
      ) {
        if (unit.kind === "DELETE_LOCAL" && local && unchanged) {
          await tx.shoppingListItem.delete({ where: { id: local.id } });
          changed = true;
        } else if (unit.kind === "DELETE_LOCAL" && local && !unchanged)
          throw new RecipeError(409, "Einkaufsliste wurde parallel geändert.");
        if (unit.pairId)
          await tx.cookidooItemLink.delete({ where: { id: unit.pairId } });
      } else {
        if (unit.kind === "CREATE_LOCAL") {
          if (
            (await tx.shoppingListItem.count({
              where: { listId: connection.listId },
            })) >= 1000
          )
            throw new RecipeError(
              409,
              "Maximal 1000 Einträge pro Einkaufsliste.",
            );
          const quantity = normalizedQuantity(unit.desired!.fields);
          local = dto(
            await tx.shoppingListItem.create({
              data: {
                listId: connection.listId,
                name: quantity.name,
                amount: quantity.amount,
                unit: quantity.unit,
                note: quantity.note,
                mergeKey: quantity.key,
                checked: unit.desired!.checked,
              },
            }),
          );
          changed = true;
        } else if (
          unit.kind === "UPDATE" &&
          local &&
          unchanged &&
          !same(localState(local), unit.desired)
        ) {
          const quantity = normalizedQuantity(unit.desired!.fields);
          local = dto(
            await tx.shoppingListItem.update({
              where: { id: local.id },
              data: {
                name: quantity.name,
                amount: quantity.amount,
                unit: quantity.unit,
                note: quantity.note,
                mergeKey: quantity.key,
                checked: unit.desired!.checked,
              },
            }),
          );
          changed = true;
        }
        if (!remoteItem) throw new RecipeError(409, "Cookidoo-Eintrag fehlt.");
        if (pending && !unchanged && unit.kind === "UPDATE") {
          // Preserve both original baselines so a simultaneous local edit remains a conflict.
          if (!unit.pairId)
            throw new RecipeError(409, "Abgleichzuordnung fehlt.");
        } else
          await savePair(
            tx,
            connection,
            unit,
            local,
            remoteItem,
            unit.kind === "CREATE_REMOTE" && !unchanged
              ? localState(original!)
              : undefined,
          );
      }
      if (changed)
        await tx.shoppingList.update({
          where: { id: connection.listId },
          data: { revision: { increment: 1 } },
        });
      const remaining = (
        current.resolutionsJson as unknown as SyncResolution[]
      ).filter((r) => r.pairId !== unit.pairId);
      await tx.cookidooConnection.update({
        where: { id: connection.id },
        data: {
          pendingJson: Prisma.DbNull,
          resolutionsJson: json(remaining),
          leaseUntil: new Date(Date.now() + 120000),
        },
      });
    }, txOptions);
  }
  async function recover(
    connection: CookidooConnection,
    runToken: string,
    items: RemoteShoppingItem[],
  ) {
    const current = await db.cookidooConnection.findUniqueOrThrow({
      where: { id: connection.id },
    });
    if (!current.pendingJson) return;
    const pending = current.pendingJson as unknown as Pending;
    let result: RemoteShoppingItem | null = null;
    if (pending.action.type === "create") {
      if (pending.result) result = pending.result;
      else {
        const matches = items.filter(
          (r) =>
            !pending.priorKeys.includes(r.key) &&
            r.kind === "additional" &&
            same(remoteState(r), pending.unit.desired),
        );
        if (matches.length === 1) result = matches[0];
      }
      if (!result)
        throw new RecipeError(
          409,
          "Unklarer Cookidoo-Schreibstatus. Es wird kein Eintrag blind erneut erstellt. Abgleich erneut prüfen oder Verbindung trennen.",
        );
    } else if (pending.action.type === "delete") {
      if (items.some((r) => r.key === pending.action.remoteKey))
        throw new RecipeError(
          409,
          "Unklarer Cookidoo-Löschstatus. Abgleich erneut prüfen.",
        );
    } else {
      result = items.find((r) => r.key === pending.action.remoteKey) ?? null;
      if (!result || !same(remoteState(result), pending.unit.desired))
        throw new RecipeError(
          409,
          "Unklarer Cookidoo-Änderungsstatus. Abgleich erneut prüfen.",
        );
    }
    await commitUnit(
      connection,
      runToken,
      pending.unit,
      pending.local,
      result,
      true,
    );
  }
  async function executeUnit(
    connection: CookidooConnection,
    runToken: string,
    unit: SyncUnit,
    locals: SyncLocal[],
    items: RemoteShoppingItem[],
  ) {
    const original = locals.find((l) => l.id === unit.localId) ?? null;
    let action: CookidooAction | undefined;
    if (unit.kind === "CREATE_REMOTE")
      action = {
        type: "create",
        name: remoteLabel(unit.desired!),
        checked: unit.desired!.checked,
      };
    else if (unit.kind === "DELETE_REMOTE")
      action = {
        type: "delete",
        remoteKey: unit.remote!.key,
        expected: unit.remote,
      };
    else if (
      unit.kind === "UPDATE" &&
      unit.remote &&
      !same(remoteState(unit.remote), unit.desired)
    )
      action = {
        type: "update",
        remoteKey: unit.remote.key,
        expected: unit.remote,
        name:
          unit.remote.kind === "ingredient"
            ? unit.remote.name
            : remoteLabel(unit.desired!),
        checked: unit.desired!.checked,
      };
    if (!action) {
      await commitUnit(
        connection,
        runToken,
        unit,
        original,
        unit.remote ?? null,
      );
      return;
    }
    if (action.name) {
      const synthetic: RemoteShoppingItem = {
        key: "additional:test",
        kind: "additional",
        id: "test",
        name: action.name,
        description: "",
        preparation: "",
        checked: action.checked!,
      };
      if (
        action.name.length > 500 ||
        (unit.remote?.kind !== "ingredient" &&
          !same(remoteState(synthetic), unit.desired))
      )
        throw new RecipeError(
          400,
          "Dieser Eintrag lässt sich nicht verlustfrei an Cookidoo übertragen (maximal 500 Zeichen). Bitte kürzen oder die Verbindung trennen.",
        );
    }
    const pending: Pending = {
      unit,
      action,
      local: original,
      priorKeys: items.map((r) => r.key),
    };
    await db.$transaction(async (tx) => {
      const current = await writer(tx, connection, runToken);
      if (current.pendingJson)
        throw new RecipeError(409, "Unklarer vorheriger Abgleich.");
      const fresh = unit.localId
        ? await tx.shoppingListItem.findFirst({
            where: { id: unit.localId, listId: connection.listId },
          })
        : null;
      if (
        !same(
          fresh ? localState(dto(fresh)) : null,
          original ? localState(original) : null,
        )
      )
        throw new RecipeError(409, "Einkaufsliste wurde parallel geändert.");
      await tx.cookidooConnection.update({
        where: { id: connection.id },
        data: {
          pendingJson: json(pending),
          leaseUntil: new Date(Date.now() + 120000),
        },
      });
    }, txOptions);
    let result: Awaited<ReturnType<typeof remote>>;
    try {
      result = await remote(connection, "apply", action, runToken);
    } catch (error) {
      if (
        error instanceof RecipeError &&
        error.statusCode === 409 &&
        error.message === "Cookidoo wurde parallel geändert."
      )
        await db.cookidooConnection.updateMany({
          where: { id: connection.id, runToken },
          data: { pendingJson: Prisma.DbNull },
        });
      throw error;
    }
    const created =
      action.type === "create" ? (result.created?.[0] ?? null) : null;
    if (action.type === "create" && !created)
      throw new RecipeError(409, "Cookidoo-Erstellungsstatus unklar.");
    await db.cookidooConnection.updateMany({
      where: { id: connection.id, runToken },
      data: { pendingJson: json({ ...pending, result: created, done: true }) },
    });
    await commitUnit(
      connection,
      runToken,
      unit,
      original,
      created ?? result.items!.find((r) => r.key === action!.remoteKey) ?? null,
      true,
    );
  }
  function makePlan(
    snapshot: Awaited<ReturnType<typeof state>>,
    items: RemoteShoppingItem[],
  ) {
    return planCookidooSync(
      snapshot.list.items,
      items,
      snapshot.pairs,
      snapshot.current.resolutionsJson as unknown as SyncResolution[],
      snapshot.current.ignoredLocalJson as string[],
      snapshot.current.ignoredRemoteJson as string[],
    );
  }
  async function process(id: string, manual = false) {
    const connection = await db.cookidooConnection.findUnique({
      where: { id },
    });
    if (
      !connection ||
      (!manual && !connection.requested && connection.paused) ||
      stopping
    )
      return;
    const runToken = randomUUID(),
      now = new Date();
    const claimed = await db.cookidooConnection.updateMany({
      where: {
        id,
        revision: connection.revision,
        paused: connection.paused,
        requested: connection.requested,
        OR: [{ runToken: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        runToken,
        requested: false,
        leaseUntil: new Date(Date.now() + 120000),
      },
    });
    if (!claimed.count) return;
    try {
      await state(connection, runToken);
      let read = await remote(connection, "read", undefined, runToken);
      await recover(connection, runToken, read.items!);
      let applied = 0;
      for (let batch = 0; batch < 25 && !stopping; batch++) {
        const snapshot = await state(connection, runToken),
          plan = makePlan(snapshot, read.items!);
        const unit = plan.units.find((u) => {
          if (u.kind !== "UPDATE") return true;
          const l = snapshot.list.items.find((i) => i.id === u.localId),
            pair = snapshot.pairs.find((p) => p.id === u.pairId);
          return (
            !l ||
            !same(localState(l), u.desired) ||
            !same(remoteState(u.remote!), u.desired) ||
            !pair ||
            !same(pair.local, localState(l)) ||
            !same(pair.remote, u.remote) ||
            (
              snapshot.current.resolutionsJson as unknown as SyncResolution[]
            ).some((r) => r.pairId === u.pairId)
          );
        });
        if (!unit) {
          const report: Report = {
            units: applied,
            conflicts: plan.conflicts,
            remoteCount: read.items!.length,
            localCount: snapshot.list.items.length,
          };
          await db.cookidooConnection.updateMany({
            where: { id, runToken },
            data: {
              status: plan.conflicts.length ? "CONFLICT" : "ACTIVE",
              lastError: "",
              reportJson: json(report),
              lastSyncedAt: new Date(),
              nextSyncAt: new Date(Date.now() + 300000),
              revision: { increment: 1 },
            },
          });
          return;
        }
        await executeUnit(
          connection,
          runToken,
          unit,
          snapshot.list.items,
          read.items!,
        );
        applied++;
        if (stopping) break;
        read = await remote(connection, "read", undefined, runToken);
      }
      await db.cookidooConnection.updateMany({
        where: { id, runToken },
        data: {
          status: "ACTIVE",
          requested: true,
          nextSyncAt: new Date(),
          lastError: "",
          lastSyncedAt: new Date(),
        },
      });
    } catch (error) {
      const fresh = await db.cookidooConnection.findUnique({ where: { id } });
      const code = error instanceof RecipeError ? error.statusCode : 502;
      const uncertain = !!fresh?.pendingJson;
      await db.cookidooConnection.updateMany({
        where: { id, runToken },
        data: {
          status: uncertain
            ? "UNKNOWN"
            : code === 401
              ? "AUTH"
              : code === 403 || code === 404
                ? "ACCESS"
                : "FAILED",
          paused:
            uncertain ||
            code === 400 ||
            code === 401 ||
            code === 403 ||
            code === 404
              ? true
              : undefined,
          lastError:
            error instanceof RecipeError
              ? error.message
              : "Abgleich vorübergehend nicht verfügbar.",
          nextSyncAt: new Date(Date.now() + 300000),
        },
      });
    } finally {
      await db.cookidooConnection.updateMany({
        where: { id, runToken },
        data: { runToken: null, leaseUntil: null },
      });
    }
  }
  return {
    async get(userId: string) {
      const connection = await own(userId);
      if (!connection) return null;
      return {
        id: connection.id,
        householdId: connection.householdId,
        listId: connection.listId,
        listName: connection.list.name,
        accountEmail: connection.accountEmail,
        market: connection.market,
        paused: connection.paused,
        status: connection.status,
        revision: connection.revision,
        lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
        lastError: connection.lastError,
        running:
          !!connection.runToken &&
          !!connection.leaseUntil &&
          connection.leaseUntil > new Date(),
        requested: connection.requested,
        report: connection.reportJson as unknown as Report | null,
      };
    },
    async connect(
      userId: string,
      input: {
        householdId: string;
        listId: string;
        email: string;
        password: string;
        market: string;
      },
    ) {
      await membership(db, userId, input.householdId, true);
      const target = await db.shoppingList.findFirst({
        where: { id: input.listId, householdId: input.householdId },
      });
      if (!target) throw new RecipeError(404, "Einkaufsliste nicht gefunden.");
      const existing = await db.cookidooConnection.findUnique({
        where: { userId },
      });
      if (
        existing &&
        (existing.listId !== input.listId ||
          existing.accountEmail !== input.email.toLowerCase().trim() ||
          existing.market !== input.market)
      )
        throw new RecipeError(
          409,
          "Zum Wechseln zuerst die alte Verbindung trennen.",
        );
      const result = await provider.call({
        operation: "login",
        market: input.market,
        email: input.email,
        password: input.password,
      });
      if (!result.ok || !result.tokens || !result.items)
        throw new RecipeError(
          502,
          "Cookidoo-Anmeldung oder Listenabruf fehlgeschlagen. Zugangsdaten, Region und Cookidoo-Verfügbarkeit prüfen.",
        );
      const encryptedTokens = await secrets.encrypt(result.tokens);
      await db.$transaction(async (tx) => {
        await lockHousehold(tx, input.householdId);
        await membership(tx, userId, input.householdId, true);
        if (
          (await tx.accountStatus.findUnique({ where: { userId } }))?.disabled
        )
          throw new RecipeError(403, "Konto gesperrt.");
        const busy = await tx.cookidooConnection.findUnique({
          where: { userId },
        });
        if (busy?.runToken && busy.leaseUntil && busy.leaseUntil > new Date())
          throw new RecipeError(409, "Abgleich läuft.");
        if (!!busy !== !!existing || busy?.id !== existing?.id)
          throw new RecipeError(409, "Verbindung wurde parallel geändert.");
        const taken = await tx.cookidooConnection.findUnique({
          where: { listId: input.listId },
        });
        if (taken && taken.userId !== userId)
          throw new RecipeError(
            409,
            "Diese Einkaufsliste ist bereits mit einem Cookidoo-Konto verbunden.",
          );
        const list = await tx.shoppingList.findFirst({
          where: { id: input.listId, householdId: input.householdId },
        });
        if (!list) throw new RecipeError(404, "Einkaufsliste nicht gefunden.");
        if (existing) {
          await tx.cookidooConnection.update({
            where: { id: existing.id },
            data: {
              encryptedTokens,
              paused: true,
              requested: false,
              status: busy?.pendingJson ? "UNKNOWN" : "PENDING",
              lastError: "",
              revision: { increment: 1 },
            },
          });
        } else {
          await tx.cookidooConnection.create({
            data: {
              userId,
              householdId: input.householdId,
              listId: input.listId,
              accountEmail: input.email.toLowerCase().trim(),
              market: input.market,
              encryptedTokens,
              reportJson: json({
                units: 0,
                conflicts: [],
                remoteCount: result.items!.length,
                localCount: await tx.shoppingListItem.count({
                  where: { listId: input.listId },
                }),
              }),
            },
          });
        }
      }, txOptions);
      return this.get(userId);
    },
    async activate(userId: string, paused: boolean, revision: number) {
      const connection = await own(userId);
      if (!connection) throw new RecipeError(404, "Verbindung nicht gefunden.");
      await db.$transaction(async (tx) => {
        const current = await writer(tx, connection);
        if (
          current.revision !== revision ||
          (current.runToken &&
            current.leaseUntil &&
            current.leaseUntil > new Date())
        )
          throw new RecipeError(409, "Verbindung wurde parallel geändert.");
        if (!paused && current.pendingJson)
          throw new RecipeError(
            409,
            "Zuerst den unklaren Abgleich erneut prüfen.",
          );
        await tx.cookidooConnection.update({
          where: { id: connection.id },
          data: {
            paused,
            status: paused ? current.status : "ACTIVE",
            nextSyncAt: new Date(),
            revision: { increment: 1 },
          },
        });
      }, txOptions);
    },
    async sync(userId: string) {
      const connection = await own(userId);
      if (!connection) throw new RecipeError(404, "Verbindung nicht gefunden.");
      await db.$transaction(async (tx) => {
        const current = await writer(tx, connection);
        if (
          current.runToken &&
          current.leaseUntil &&
          current.leaseUntil > new Date()
        )
          throw new RecipeError(409, "Abgleich läuft bereits.");
        if (current.status === "PENDING")
          throw new RecipeError(
            409,
            "Zuerst den Abgleich in beide Richtungen bestätigen.",
          );
        await tx.cookidooConnection.update({
          where: { id: connection.id },
          data: { requested: true, nextSyncAt: new Date() },
        });
      }, txOptions);
    },
    async disconnect(userId: string) {
      const connection = await db.cookidooConnection.findUnique({
        where: { userId },
      });
      if (!connection) return;
      await db.$transaction(async (tx) => {
        await lockHousehold(tx, connection.householdId);
        const current = await tx.cookidooConnection.findUnique({
          where: { id: connection.id },
        });
        if (
          current?.runToken &&
          current.leaseUntil &&
          current.leaseUntil > new Date()
        )
          throw new RecipeError(
            409,
            "Abgleich läuft. Kurz warten und erneut trennen.",
          );
        await tx.cookidooConnection.deleteMany({
          where: { id: connection.id, userId },
        });
      }, txOptions);
    },
    async resolve(
      userId: string,
      conflictId: string,
      choice: "LOCAL" | "REMOTE" | "UNLINK",
      revision: number,
    ) {
      const connection = await own(userId);
      if (!connection) throw new RecipeError(404, "Verbindung nicht gefunden.");
      await db.$transaction(async (tx) => {
        const current = await writer(tx, connection);
        if (
          current.revision !== revision ||
          (current.runToken &&
            current.leaseUntil &&
            current.leaseUntil > new Date())
        )
          throw new RecipeError(409, "Konfliktstand geändert.");
        const conflict = (
          current.reportJson as unknown as Report | null
        )?.conflicts.find((c) => c.id === conflictId);
        if (!conflict) throw new RecipeError(404, "Konflikt nicht gefunden.");
        if (choice === "LOCAL" && !conflict.allowLocal)
          throw new RecipeError(
            409,
            "Diese Cookidoo-Rezeptzutat kann nur dort geändert oder getrennt werden.",
          );
        let pairId = conflict.pairId;
        if (!pairId) {
          if (choice === "UNLINK") {
            await tx.cookidooConnection.update({
              where: { id: connection.id },
              data: {
                ignoredLocalJson: json([
                  ...(current.ignoredLocalJson as string[]),
                  ...(conflict.localId ? [conflict.localId] : []),
                ]),
                ignoredRemoteJson: json([
                  ...(current.ignoredRemoteJson as string[]),
                  conflict.remoteKey,
                ]),
                requested: true,
                nextSyncAt: new Date(),
                revision: { increment: 1 },
              },
            });
            return;
          }
          const link = await tx.cookidooItemLink.create({
            data: {
              connectionId: connection.id,
              localItemId: conflict.localId,
              remoteKey: conflict.remoteKey,
              localBaseJson: json(conflict.local!),
              remoteBaseJson: json(conflict.remote!),
            },
          });
          pairId = link.id;
        }
        const resolutions = (
          current.resolutionsJson as unknown as SyncResolution[]
        ).filter((r) => r.pairId !== pairId);
        resolutions.push({
          pairId: pairId!,
          choice,
          local: conflict.local,
          remote: conflict.remote,
        });
        await tx.cookidooConnection.update({
          where: { id: connection.id },
          data: {
            resolutionsJson: json(resolutions),
            requested: true,
            nextSyncAt: new Date(),
            revision: { increment: 1 },
          },
        });
      }, txOptions);
    },
    process,
    async next() {
      if (!config.cookidooEnabled) return;
      const now = new Date(),
        connection = await db.cookidooConnection.findFirst({
          where: {
            AND: [
              {
                OR: [
                  { paused: false, nextSyncAt: { lte: now } },
                  { requested: true },
                ],
              },
              { OR: [{ runToken: null }, { leaseUntil: { lt: now } }] },
            ],
          },
          orderBy: { nextSyncAt: "asc" },
        });
      if (connection) await process(connection.id, connection.requested);
    },
    stop() {
      stopping = true;
    },
  };
}
export function startCookidooWorker(
  service: ReturnType<typeof cookidooSync>,
  onError: () => void,
) {
  let pending: Promise<void> | null = null;
  const tick = () => {
    if (!pending)
      pending = service
        .next()
        .catch(onError)
        .finally(() => {
          pending = null;
        });
  };
  const timer = setInterval(tick, 3000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    service.stop();
    if (pending) await pending;
  };
}
