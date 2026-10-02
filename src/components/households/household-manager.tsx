"use client";
import { useEffect, useRef, useState } from "react";
import { Home, Plus, UserPlus, Users } from "lucide-react";
import { api, type Membership } from "../api";
import type {
  HouseholdDetail,
  HouseholdRole,
} from "../../../shared/households";
import type { Locale } from "../translations";
import { householdMessages, roleLabel } from "./messages";
export function HouseholdManager({
  memberships,
  householdId,
  userId,
  locale,
  onSelect,
  onChanged,
}: {
  memberships: Membership[];
  householdId: string;
  userId: string;
  locale: Locale;
  onSelect: (id: string) => void;
  onChanged: (preferred?: string) => void;
}) {
  const t = householdMessages[locale];
  const [household, setHousehold] = useState<HouseholdDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createName, setCreateName] = useState("");
  const [renameName, setRenameName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<HouseholdRole>("VIEWER");
  const [latest, setLatest] = useState<{ id: string; link: string } | null>(
    null,
  );
  const [copyStatus, setCopyStatus] = useState("");
  const linkInput = useRef<HTMLInputElement>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setLatest(null);
    setCopyStatus("");
    setError("");
    setHousehold(null);
    if (!householdId) return;
    let active = true;
    setLoading(true);
    api<{ household: HouseholdDetail }>(`/households/${householdId}`)
      .then((result) => {
        if (active) {
          setHousehold(result.household);
          setRenameName(result.household.name);
          setRole((previous) =>
            previous === "ADMIN" && result.household.role !== "OWNER"
              ? "VIEWER"
              : previous,
          );
        }
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : t.failed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [householdId, refresh, t.failed]);
  async function reload() {
    const result = await api<{ household: HouseholdDetail }>(
      `/households/${householdId}`,
    );
    setHousehold(result.household);
    setRenameName(result.household.name);
    setRole((previous) =>
      previous === "ADMIN" && result.household.role !== "OWNER"
        ? "VIEWER"
        : previous,
    );
    onChanged();
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
    }
  }
  async function copyLink() {
    if (!latest) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard");
      await navigator.clipboard.writeText(latest.link);
      setCopyStatus(t.copied);
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setCopyStatus(t.manualCopy);
    }
  }
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const ownerCount =
    household?.members.filter((m) => m.role === "OWNER").length ?? 0;
  return (
    <>
      <div className="page-heading">
        <span className="eyebrow">{t.management}</span>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </div>
      {memberships.length > 0 && (
        <label className="household-manage-select">
          {t.select}
          <select
            value={householdId}
            onChange={(event) => onSelect(event.target.value)}
            disabled={busy}
          >
            {memberships.map((m) => (
              <option key={m.household.id} value={m.household.id}>
                {m.household.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <div className="error-box" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              setRefresh((value) => value + 1);
              onChanged();
            }}
          >
            {t.reload}
          </button>
        </div>
      )}
      <section className="panel household-create">
        <h2>
          <Home size={20} />
          {t.createTitle}
        </h2>
        <p className="small muted">{t.createHint}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const result = await api<{ household: HouseholdDetail }>(
                "/households",
                { name: createName.trim() },
              );
              setCreateName("");
              onChanged(result.household.id);
            });
          }}
        >
          <label>
            {t.name}
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              required
              maxLength={120}
              disabled={busy}
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !createName.trim()}
          >
            <Plus size={17} />
            {t.create}
          </button>
        </form>
      </section>
      {!householdId && <p className="muted">{t.noHousehold}</p>}
      {loading && (
        <p role="status" className="muted">
          {t.loading}
        </p>
      )}
      {household && (
        <>
          <section className="panel household-members">
            <div className="section-heading">
              <h2>
                <Users size={20} />
                {household.name}
              </h2>
              <span className="recipe-chip">
                {t.yourRole}: {roleLabel(locale, household.role)}
              </span>
            </div>
            <p className="small muted">{t.ownerHint}</p>
            {household.canManage ? (
              <form
                className="household-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(
                      `/households/${household.id}`,
                      { name: renameName.trim(), revision: household.revision },
                      "PATCH",
                    );
                    await reload();
                  });
                }}
              >
                <label>
                  {t.name}
                  <input
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    required
                    maxLength={120}
                    disabled={busy}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={busy || !renameName.trim()}
                >
                  {t.rename}
                </button>
              </form>
            ) : (
              <p className="muted">{t.readOnly}</p>
            )}
            <h3>
              {t.members} ({household.members.length})
            </h3>
            <div className="household-member-list">
              {household.members.map((member) => {
                const manageable =
                  household.role === "OWNER" ||
                  (household.role === "ADMIN" &&
                    !["OWNER", "ADMIN"].includes(member.role));
                const lastOwner = member.role === "OWNER" && ownerCount === 1;
                return (
                  <div className="household-member-row" key={member.userId}>
                    <div>
                      <strong>
                        {member.name}
                        {member.userId === userId ? ` · ${t.you}` : ""}
                      </strong>
                      {member.email && (
                        <span className="small muted">{member.email}</span>
                      )}
                    </div>
                    {manageable ? (
                      <>
                        <select
                          aria-label={`${t.role}: ${member.name}`}
                          value={member.role}
                          disabled={busy || lastOwner}
                          onChange={(event) =>
                            void run(async () => {
                              await api(
                                `/households/${household.id}/members/${member.userId}`,
                                {
                                  role: event.target.value,
                                  revision: household.revision,
                                },
                                "PATCH",
                              );
                              await reload();
                            })
                          }
                        >
                          {(
                            [
                              "OWNER",
                              "ADMIN",
                              "EDITOR",
                              "VIEWER",
                            ] as HouseholdRole[]
                          )
                            .filter(
                              (r) =>
                                household.role === "OWNER" ||
                                !["OWNER", "ADMIN"].includes(r),
                            )
                            .map((r) => (
                              <option value={r} key={r}>
                                {roleLabel(locale, r)}
                              </option>
                            ))}
                        </select>
                        {member.userId !== userId && (
                          <button
                            className="text-button danger"
                            aria-label={`${t.remove}: ${member.name}`}
                            disabled={busy || lastOwner}
                            onClick={() => {
                              if (window.confirm(t.removeConfirm))
                                void run(async () => {
                                  await api(
                                    `/households/${household.id}/members/${member.userId}?revision=${household.revision}`,
                                    undefined,
                                    "DELETE",
                                  );
                                  await reload();
                                });
                            }}
                          >
                            {t.remove}
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="recipe-chip">
                        {roleLabel(locale, member.role)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className="text-button danger household-leave"
              disabled={
                busy || (household.role === "OWNER" && ownerCount === 1)
              }
              onClick={() => {
                if (window.confirm(t.leaveConfirm))
                  void run(async () => {
                    await api(`/households/${household.id}/leave`, {
                      revision: household.revision,
                    });
                    onChanged("");
                    setHousehold(null);
                  });
              }}
            >
              {t.leave}
            </button>
          </section>
          {household.canManage && (
            <section className="panel household-invitations">
              <h2>
                <UserPlus size={20} />
                {t.inviteTitle}
              </h2>
              <p className="small muted">{t.inviteHint}</p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const result = await api<{
                      invitation: { id: string; link: string };
                    }>(`/households/${household.id}/invitations`, {
                      email: email.trim(),
                      role,
                      revision: household.revision,
                    });
                    setLatest(result.invitation);
                    setCopyStatus("");
                    setEmail("");
                    await reload();
                  });
                }}
              >
                <label>
                  {t.email}
                  <input
                    type="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  {t.role}
                  <select
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value as HouseholdRole)
                    }
                    disabled={busy}
                  >
                    {(["VIEWER", "EDITOR", "ADMIN"] as HouseholdRole[])
                      .filter(
                        (r) => household.role === "OWNER" || r !== "ADMIN",
                      )
                      .map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(locale, r)}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="button primary" disabled={busy}>
                  {t.invite}
                </button>
              </form>
              {latest && (
                <div className="invitation-link">
                  <label>
                    {t.link}
                    <input
                      ref={linkInput}
                      readOnly
                      value={latest.link}
                      onClick={(event) => event.currentTarget.select()}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() => void copyLink()}
                  >
                    {t.copy}
                  </button>
                  {copyStatus && (
                    <p className="small muted" role="status">
                      {copyStatus}
                    </p>
                  )}
                </div>
              )}
              <h3>{t.invitations}</h3>
              {!household.invitations.length && (
                <p className="muted">{t.noInvitations}</p>
              )}
              {household.invitations.map((invitation) => (
                <div className="household-invitation-row" key={invitation.id}>
                  <div>
                    <strong>{invitation.email}</strong>
                    <span className="small muted">
                      {roleLabel(locale, invitation.role)} ·{" "}
                      {new Date(invitation.expiresAt) <= new Date()
                        ? t.expired
                        : `${t.expires}: ${date.format(new Date(invitation.expiresAt))}`}
                    </span>
                  </div>
                  <button
                    className="text-button danger"
                    aria-label={`${t.revoke}: ${invitation.email}`}
                    disabled={
                      busy ||
                      (household.role === "ADMIN" &&
                        invitation.role === "ADMIN")
                    }
                    onClick={() => {
                      if (window.confirm(t.revokeConfirm))
                        void run(async () => {
                          await api(
                            `/households/${household.id}/invitations/${invitation.id}?revision=${household.revision}`,
                            undefined,
                            "DELETE",
                          );
                          if (latest?.id === invitation.id) setLatest(null);
                          await reload();
                        });
                    }}
                  >
                    {t.revoke}
                  </button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
