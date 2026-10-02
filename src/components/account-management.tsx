"use client";
import { useState, useEffect } from "react";
import { api, type User } from "./api";
import type { Locale } from "./translations";
import { AccountOptions } from "./account-options";
interface Event {
  id: string;
  action: string;
  targetId: string | null;
  status: number;
  createdAt: string;
  actor?: { name: string } | null;
}
function activityLabel(action: string, de: boolean) {
  const [method, path = ""] = action.split(" ");
  const say = (a: string, b: string) => (de ? a : b);
  if (path.includes("/cookidoo"))
    return say("Cookidoo-Verbindung verwaltet", "Cookidoo connection managed");
  if (path.includes("/auth/profile") || path.includes("/auth/avatar"))
    return say("Profil geändert", "Profile updated");
  if (path.includes("/auth/password"))
    return say("Passwort geändert", "Password changed");
  if (path.includes("/auth/logout")) return say("Abgemeldet", "Signed out");
  if (path.includes("/auth/oidc"))
    return say("Konto-Verknüpfung verwaltet", "Account connection managed");
  if (path.includes("/favorite"))
    return say("Favorit geändert", "Favorite updated");
  if (path.includes("/rating")) return say("Rezept bewertet", "Recipe rated");
  if (path.includes("/shopping-lists"))
    return say("Einkaufsliste geändert", "Shopping list updated");
  if (path.includes("/meal-plan"))
    return say("Wochenplan geändert", "Meal plan updated");
  if (path.includes("/cooking-history"))
    return say("Kochhistorie geändert", "Cooking history updated");
  if (path.includes("/cookbooks"))
    return say("Rezeptbuch geändert", "Cookbook updated");
  if (path.includes("/recipe-imports"))
    return say("Import verwaltet", "Import managed");
  if (path.includes("/publication"))
    return say("Veröffentlichung verwaltet", "Publication managed");
  if (path.includes("/recipes"))
    return method === "DELETE"
      ? say("Rezeptinhalt entfernt", "Recipe content removed")
      : say("Rezept verwaltet", "Recipe managed");
  if (path.includes("/household"))
    return say("Haushalt verwaltet", "Household managed");
  return say("Kontoaktivität", "Account activity");
}
export function AccountManagement({
  user,
  locale,
}: {
  user: User;
  locale: Locale;
}) {
  const de = locale === "de";
  const [avatar, setAvatar] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [events, setEvents] = useState<Event[]>([]),
    [users, setUsers] = useState<(User & { disabled: boolean })[]>([]),
    [admin, setAdmin] = useState(false);
  async function load() {
    const info = await api<{ url: string | null }>("/auth/avatar/info");
    setAvatar(info.url);
    const activity = await api<{ events: Event[] }>(
      admin ? "/admin/activity" : "/auth/activity",
    );
    setEvents(activity.events);
    if (admin) {
      const result = await api<{ users: (User & { disabled: boolean })[] }>(
        "/admin/users",
      );
      setUsers(result.users);
    }
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [admin]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel">
        <h2>{de ? "Profilbild" : "Profile picture"}</h2>
        {avatar && (
          <img
            className="profile-avatar"
            src={avatar}
            alt={user.name}
            width={96}
            height={96}
          />
        )}
        <label>
          {de ? "Bild wählen" : "Choose picture"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void run(async () => {
                const form = new FormData();
                form.set("file", file);
                const response = await fetch("/api/v1/auth/avatar", {
                  method: "POST",
                  body: form,
                });
                if (!response.ok) throw Error((await response.json()).message);
              });
            }}
          />
        </label>
        {avatar && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(() => api("/auth/avatar", undefined, "DELETE"))
            }
          >
            {de ? "Profilbild entfernen" : "Remove profile picture"}
          </button>
        )}
        <AccountOptions locale={locale} link />
      </section>
      {user.isAdmin && (
        <section className="panel">
          <h2>{de ? "Administration" : "Administration"}</h2>
          <button className="button secondary" onClick={() => setAdmin(!admin)}>
            {de
              ? "Konten und Protokoll anzeigen"
              : "Show accounts and audit log"}
          </button>
          {admin &&
            users.map((account) => (
              <div className="history-row" key={account.id}>
                <span>
                  <strong>{account.name}</strong>
                  <small>
                    {account.email} · {account.isAdmin ? "Admin" : "User"} ·{" "}
                    {account.disabled
                      ? de
                        ? "Gesperrt"
                        : "Disabled"
                      : de
                        ? "Aktiv"
                        : "Active"}
                  </small>
                </span>
                <div className="detail-actions">
                  {["disabled", "isAdmin"].map((field) => (
                    <button
                      className="button secondary"
                      key={field}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            de
                              ? "Kontorechte ändern? Betroffene Sitzungen werden beendet."
                              : "Change account permissions? Affected sessions will end.",
                          )
                        )
                          void run(() =>
                            api(
                              `/admin/users/${account.id}`,
                              {
                                disabled: account.disabled,
                                isAdmin: account.isAdmin,
                                [field]:
                                  !account[field as "disabled" | "isAdmin"],
                              },
                              "PATCH",
                            ),
                          );
                      }}
                    >
                      {field === "disabled"
                        ? account.disabled
                          ? de
                            ? "Entsperren"
                            : "Enable"
                          : de
                            ? "Sperren"
                            : "Disable"
                        : account.isAdmin
                          ? de
                            ? "Admin entziehen"
                            : "Remove admin"
                          : de
                            ? "Zum Admin machen"
                            : "Make admin"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </section>
      )}
      <section className="panel">
        <h2>
          {admin
            ? de
              ? "Audit-Protokoll"
              : "Audit log"
            : de
              ? "Meine Aktivitäten"
              : "My activity"}
        </h2>
        {events.length ? (
          events.map((event) => (
            <div className="history-row" key={event.id}>
              <span>
                <strong>
                  {admin ? event.action : activityLabel(event.action, de)}
                </strong>
                <small>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(event.createdAt))}{" "}
                  · {event.actor?.name ?? ""} ·{" "}
                  {admin
                    ? event.status
                    : event.status < 400
                      ? de
                        ? "Erfolgreich"
                        : "Successful"
                      : de
                        ? "Fehlgeschlagen"
                        : "Failed"}
                </small>
              </span>
            </div>
          ))
        ) : (
          <p className="muted">
            {de ? "Noch keine Aktivitäten." : "No activity yet."}
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </>
  );
}
