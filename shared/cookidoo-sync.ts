import { normalizedQuantity } from "./planning";
import type { IngredientQuantity } from "./planning";
import type { RemoteShoppingItem } from "../server/integrations/cookidoo-provider";
export interface SyncLocal extends IngredientQuantity {
  id: string;
  checked: boolean;
}
export interface SyncState {
  fields: IngredientQuantity;
  checked: boolean;
}
export interface SyncPair {
  id: string;
  localId: string | null;
  remoteKey: string;
  local: SyncState;
  remote: RemoteShoppingItem;
}
export interface SyncResolution {
  pairId: string;
  choice: "LOCAL" | "REMOTE" | "UNLINK";
  local: SyncState | null;
  remote: RemoteShoppingItem | null;
}
export interface SyncUnit {
  kind:
    | "LINK"
    | "CREATE_LOCAL"
    | "CREATE_REMOTE"
    | "UPDATE"
    | "DELETE_LOCAL"
    | "DELETE_REMOTE"
    | "FORGET"
    | "UNLINK";
  pairId?: string;
  localId?: string;
  remote?: RemoteShoppingItem;
  desired?: SyncState;
}
export interface SyncConflict {
  id: string;
  pairId: string | null;
  localId: string | null;
  remoteKey: string;
  reason:
    | "BOTH_CHANGED"
    | "DELETE_CHANGED"
    | "INGREDIENT_READONLY"
    | "INITIAL_DIFFERENCE"
    | "RESOLUTION_STALE";
  local: SyncState | null;
  remote: RemoteShoppingItem | null;
  allowLocal: boolean;
}
const canonical = (value: unknown): unknown =>
  value === null || typeof value !== "object"
    ? value
    : Array.isArray(value)
      ? value.map(canonical)
      : Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)]),
        );
export const syncEqual = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const equal = syncEqual;
const fields = (input: IngredientQuantity): IngredientQuantity => {
  const n = normalizedQuantity(input);
  return { name: n.name, amount: n.amount, unit: n.unit, note: n.note };
};
export function localState(item: SyncLocal): SyncState {
  return { fields: fields(item), checked: item.checked };
}
export function remoteState(remote: RemoteShoppingItem): SyncState {
  let name = remote.name,
    amount: string | null = null,
    unit = "",
    note = remote.preparation;
  if (remote.kind === "ingredient") {
    const quantity = remote.description
      .trim()
      .match(/^(\d{1,8}(?:[.,]\d{1,4})?)\s*(\S{0,24})$/);
    if (quantity) {
      amount = quantity[1].replace(",", ".");
      unit = quantity[2];
    } else if (remote.description)
      note = [remote.description, note].filter(Boolean).join(" · ");
  } else {
    const parts = name.split(" · ");
    name = parts.shift()!;
    note = parts.join(" · ");
    const bracket = name.match(
      /^\[(\?|\d{1,16}(?:[.,]\d{1,4})?)(?: ([^\]]{1,24}))?\] (.+)$/,
    );
    if (bracket) {
      amount = bracket[1] === "?" ? null : bracket[1].replace(",", ".");
      unit = bracket[2] || "";
      name = bracket[3];
    }
    const prefix =
      !bracket &&
      name.match(
        /^(\d{1,8}(?:[.,]\d{1,4})?)\s+(g|kg|ml|l|TL|EL|Stück|Prise|Packung|Dose)\s+(.+)$/i,
      );
    if (prefix) {
      amount = prefix[1].replace(",", ".");
      unit = prefix[2];
      name = prefix[3];
    }
  }
  if (name.length > 150) {
    note = [name.slice(150), note].filter(Boolean).join(" · ");
    name = name.slice(0, 150);
  }
  if (note.length > 2000) throw Error("Cookidoo-Eintrag ist zu lang.");
  return {
    fields: fields({ name, amount, unit, note }),
    checked: remote.checked,
  };
}
export function remoteLabel(state: SyncState) {
  const f = state.fields;
  const quantity =
    f.amount === null
      ? f.unit
        ? `[? ${f.unit}] ${f.name}`
        : f.name
      : `${/^(g|ml|TL|EL|Stück|Prise|Packung|Dose)$/i.test(f.unit) ? [f.amount, f.unit].join(" ") : `[${[f.amount, f.unit].filter(Boolean).join(" ")}]`} ${f.name}`;
  return [quantity, f.note].filter(Boolean).join(" · ");
}
export function planCookidooSync(
  locals: SyncLocal[],
  remotes: RemoteShoppingItem[],
  pairs: SyncPair[],
  resolutions: SyncResolution[] = [],
  ignoredLocalIds: string[] = [],
  ignoredRemoteKeys: string[] = [],
): { units: SyncUnit[]; conflicts: SyncConflict[] } {
  const units: SyncUnit[] = [],
    conflicts: SyncConflict[] = [];
  const localMap = new Map(locals.map((item) => [item.id, item])),
    remoteMap = new Map(remotes.map((item) => [item.key, item]));
  const linkedLocal = new Set<string>([...ignoredLocalIds]),
    linkedRemote = new Set<string>([...ignoredRemoteKeys]);
  for (const pair of pairs) {
    if (pair.localId) linkedLocal.add(pair.localId);
    linkedRemote.add(pair.remoteKey);
    const local = pair.localId ? localMap.get(pair.localId) : undefined,
      remote = remoteMap.get(pair.remoteKey),
      l = local ? localState(local) : null,
      r = remote ? remoteState(remote) : null;
    const conflict = (reason: SyncConflict["reason"]) =>
      conflicts.push({
        id: pair.id,
        pairId: pair.id,
        localId: local?.id ?? null,
        remoteKey: pair.remoteKey,
        reason,
        local: l,
        remote: remote ?? null,
        allowLocal:
          remote?.kind !== "ingredient" ||
          (l !== null && r !== null && equal(l.fields, r.fields)),
      });
    const resolution = resolutions.find((choice) => choice.pairId === pair.id);
    if (resolution) {
      if (
        !equal(resolution.local, l) ||
        !equal(resolution.remote, remote ?? null)
      ) {
        conflict("RESOLUTION_STALE");
        continue;
      }
      if (resolution.choice === "UNLINK") {
        units.push({
          kind: "UNLINK",
          pairId: pair.id,
          localId: local?.id,
          remote,
        });
        continue;
      }
      if (resolution.choice === "REMOTE") {
        if (remote)
          units.push({
            kind: local ? "UPDATE" : "CREATE_LOCAL",
            pairId: pair.id,
            localId: local?.id,
            remote,
            desired: r!,
          });
        else
          units.push({
            kind: "DELETE_LOCAL",
            pairId: pair.id,
            localId: local?.id,
          });
      } else if (
        remote?.kind === "ingredient" &&
        (!l || !equal(l.fields, r!.fields))
      )
        conflict("INGREDIENT_READONLY");
      else if (l)
        units.push({
          kind: remote ? "UPDATE" : "CREATE_REMOTE",
          pairId: pair.id,
          localId: local!.id,
          remote,
          desired: l,
        });
      else
        units.push({
          kind: remote ? "DELETE_REMOTE" : "FORGET",
          pairId: pair.id,
          remote,
        });
      continue;
    }
    if (!local && !remote) {
      units.push({ kind: "FORGET", pairId: pair.id });
      continue;
    }
    if (!local) {
      if (!equal(remote, pair.remote)) {
        conflict("DELETE_CHANGED");
        continue;
      }
      if (remote!.kind === "ingredient") {
        conflict("INGREDIENT_READONLY");
        continue;
      }
      units.push({ kind: "DELETE_REMOTE", pairId: pair.id, remote });
      continue;
    }
    if (!remote) {
      if (!equal(l, pair.local)) {
        conflict("DELETE_CHANGED");
        continue;
      }
      units.push({ kind: "DELETE_LOCAL", pairId: pair.id, localId: local.id });
      continue;
    }
    const oldR = remoteState(pair.remote);
    let desired: SyncState = { fields: r!.fields, checked: r!.checked };
    let collided = false;
    for (const field of ["fields", "checked"] as const) {
      const leftChanged = !equal(l![field], pair.local[field]),
        rightChanged = !equal(r![field], oldR[field]);
      if (leftChanged && rightChanged && !equal(l![field], r![field])) {
        collided = true;
        break;
      }
      if (leftChanged) desired = { ...desired, [field]: l![field] };
    }
    if (collided) {
      conflict("BOTH_CHANGED");
      continue;
    }
    if (remote.kind === "ingredient" && !equal(desired.fields, r!.fields)) {
      conflict("INGREDIENT_READONLY");
      continue;
    }
    units.push({
      kind: "UPDATE",
      pairId: pair.id,
      localId: local.id,
      remote,
      desired,
    });
  }
  const newLocals = locals.filter((local) => !linkedLocal.has(local.id)),
    newRemotes = remotes.filter((remote) => !linkedRemote.has(remote.key));
  for (const remote of newRemotes) {
    const state = remoteState(remote),
      matches = newLocals.filter(
        (l) =>
          !linkedLocal.has(l.id) && equal(localState(l).fields, state.fields),
      );
    // Only an unambiguous exact match can be linked automatically.
    const otherMatches = newRemotes.filter((r) =>
      equal(remoteState(r).fields, state.fields),
    );
    if (matches.length === 1 && otherMatches.length === 1) {
      const local = matches[0];
      linkedLocal.add(local.id);
      if (local.checked !== state.checked)
        conflicts.push({
          id: "new:" + remote.key,
          pairId: null,
          localId: local.id,
          remoteKey: remote.key,
          reason: "INITIAL_DIFFERENCE",
          local: localState(local),
          remote,
          allowLocal: true,
        });
      else
        units.push({ kind: "LINK", localId: local.id, remote, desired: state });
    } else units.push({ kind: "CREATE_LOCAL", remote, desired: state });
  }
  for (const local of newLocals.filter((l) => !linkedLocal.has(l.id)))
    units.push({
      kind: "CREATE_REMOTE",
      localId: local.id,
      desired: localState(local),
    });
  return { units, conflicts };
}
