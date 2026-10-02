"use client";
import { useCallback, useEffect, useState } from "react";
import type { Locale } from "../translations";
import { api } from "../api";
import type { SyncConflict, SyncState } from "../../../shared/cookidoo-sync";
import { remoteState } from "../../../shared/cookidoo-sync";
interface Connection {
  id: string;
  householdId: string;
  listId: string;
  listName: string;
  accountEmail: string;
  market: string;
  paused: boolean;
  status: string;
  revision: number;
  lastSyncedAt: string | null;
  lastError: string;
  running: boolean;
  requested: boolean;
  report: {
    remoteCount: number;
    localCount: number;
    conflicts: SyncConflict[];
  } | null;
}
export function CookidooManager({
  householdId,
  listId,
  locale,
}: {
  householdId: string;
  listId: string;
  locale: Locale;
}) {
  const de = locale === "de",
    say = (a: string, b: string) => (de ? a : b);
  const [options, setOptions] = useState<{
      enabled: boolean;
      allowHttp: boolean;
      secureOrigin: boolean;
    } | null>(null),
    [connection, setConnection] = useState<Connection | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [formShown, setFormShown] = useState(false);
  const refresh = useCallback(async () => {
    const opts = await api<{
      enabled: boolean;
      allowHttp: boolean;
      secureOrigin: boolean;
    }>("/cookidoo/options");
    setOptions(opts);
    if (opts.enabled)
      setConnection(
        (await api<{ connection: Connection | null }>("/cookidoo")).connection,
      );
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => {
      if (active)
        void refresh().catch(
          (e) => active && setError(e instanceof Error ? e.message : String(e)),
        );
    };
    load();
    const timer = setInterval(load, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!options?.enabled) return null;
  const working = busy || connection?.running || connection?.requested;
  const belongs =
    connection?.listId === listId && connection?.householdId === householdId;
  const stateLabels: Record<string, string> = {
    PENDING: say("Bereit zur Bestätigung", "Ready for confirmation"),
    ACTIVE: say("Verbunden", "Connected"),
    CONFLICT: say("Entscheidung erforderlich", "Review needed"),
    UNKNOWN: say("Übertragung unklar; pausiert", "Transfer uncertain; paused"),
    AUTH: say("Erneut anmelden", "Sign in again"),
    ACCESS: say("Berechtigung fehlt", "Access unavailable"),
    FAILED: say("Abgleich fehlgeschlagen", "Sync failed"),
  };
  function describe(state: SyncState | null) {
    if (!state) return say("Gelöscht", "Deleted");
    const f = state.fields;
    return `${[f.amount, f.unit, f.name].filter(Boolean).join(" ")}${f.note ? ` · ${f.note}` : ""} — ${state.checked ? say("erledigt", "checked") : say("offen", "unchecked")}`;
  }
  const consent = say(
    "Änderungen und Löschungen werden in beide Richtungen übertragen. Die Cookidoo-Liste wird für die Mitglieder dieses Haushalts sichtbar.",
    "Changes and deletions sync in both directions. The Cookidoo list becomes visible to members of this household.",
  );
  return (
    <section
      className="panel cookidoo-panel"
      aria-label={say("Cookidoo-Verbindung", "Cookidoo connection")}
    >
      <h2>Cookidoo</h2>
      <p className="small muted">
        {say(
          "Optionaler automatischer Einkaufslisten-Abgleich über eine inoffizielle Schnittstelle. Cookidoo kann diese jederzeit ändern.",
          "Optional automatic shopping list sync through an unofficial interface. Cookidoo may change it at any time.",
        )}
      </p>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {connection && (
        <>
          <p>
            <strong>
              {stateLabels[connection.status] ?? connection.status}
            </strong>
            {connection.paused && connection.status !== "PENDING"
              ? say(" · pausiert", " · paused")
              : ""}
            {working
              ? say(" · Abgleich wird bearbeitet", " · Sync processing")
              : ""}
          </p>
          <p className="small">
            {connection.accountEmail} · {connection.listName}
          </p>
          {connection.lastSyncedAt && (
            <p className="small muted">
              {say("Letzter Abgleich: ", "Last sync: ")}
              {new Date(connection.lastSyncedAt).toLocaleString(locale)}
            </p>
          )}
          {connection.lastError && (
            <div className="error-box" role="alert">
              {connection.lastError}
            </div>
          )}
          {!belongs && (
            <p>
              {say(
                "Dein Cookidoo-Konto ist mit einer anderen Einkaufsliste verbunden. Vor einem Wechsel diese Verbindung trennen.",
                "Your Cookidoo account is connected to another shopping list. Disconnect it before switching.",
              )}
            </p>
          )}
          {belongs && (
            <>
              {connection.status === "PENDING" && (
                <>
                  <p>
                    {say("Vorschau: ", "Preview: ")}
                    {connection.report?.localCount ?? 0}
                    {say(" Einträge in der App, ", " items in the app, ")}
                    {connection.report?.remoteCount ?? 0}
                    {say(
                      " bei Cookidoo. Gleiche Einträge werden zugeordnet; weitere Einträge werden ergänzt.",
                      " on Cookidoo. Matching entries are linked; other entries are added.",
                    )}
                  </p>
                  <p>{consent}</p>
                </>
              )}
              <div className="detail-actions">
                <button
                  className="button secondary"
                  disabled={!!working || connection.status === "UNKNOWN"}
                  onClick={() => {
                    if (connection.paused && !window.confirm(consent)) return;
                    void run(() =>
                      api(
                        "/cookidoo",
                        {
                          paused: !connection.paused,
                          revision: connection.revision,
                          confirmedBidirectional: true,
                        },
                        "PATCH",
                      ),
                    );
                  }}
                >
                  {connection.paused
                    ? say("Abgleich aktivieren", "Enable sync")
                    : say("Pausieren", "Pause")}
                </button>
                <button
                  className="button secondary"
                  disabled={!!working || connection.status === "PENDING"}
                  onClick={() => void run(() => api("/cookidoo/sync", {}))}
                >
                  {connection.status === "UNKNOWN"
                    ? say("Übertragung erneut prüfen", "Recheck transfer")
                    : say("Jetzt abgleichen", "Sync now")}
                </button>
                <button
                  className="text-button"
                  disabled={!!working}
                  onClick={() => setFormShown((v) => !v)}
                >
                  {say("Erneut anmelden", "Sign in again")}
                </button>
              </div>
              {connection.report?.conflicts.map((conflict) => (
                <article className="cookidoo-conflict" key={conflict.id}>
                  <h3>{say("Änderung prüfen", "Review change")}</h3>
                  <p>
                    <strong>{say("Diese App: ", "This app: ")}</strong>
                    {describe(conflict.local)}
                  </p>
                  <p>
                    <strong>Cookidoo: </strong>
                    {describe(
                      conflict.remote ? remoteState(conflict.remote) : null,
                    )}
                  </p>
                  <p className="small muted">
                    {conflict.reason === "INGREDIENT_READONLY"
                      ? say(
                          "Rezeptzutaten lassen sich hier nur abhaken. Inhalt und Entfernen werden von Cookidoo verwaltet.",
                          "Recipe ingredients can only be checked here. Cookidoo manages their content and removal.",
                        )
                      : conflict.reason === "RESOLUTION_STALE"
                        ? say(
                            "Seit deiner Entscheidung wurde der Eintrag erneut geändert. Bitte den aktuellen Stand prüfen.",
                            "The item changed after your decision. Review the current versions.",
                          )
                        : say(
                            "Beide Seiten haben einen unterschiedlichen Stand. Wähle die gewünschte Version oder trenne diesen Eintrag vom Abgleich.",
                            "The two sides differ. Choose a version or stop syncing this item.",
                          )}
                  </p>
                  <div className="detail-actions">
                    {(["REMOTE", "LOCAL", "UNLINK"] as const).map((choice) => (
                      <button
                        key={choice}
                        className="button secondary"
                        disabled={
                          !!working ||
                          (choice === "LOCAL" && !conflict.allowLocal)
                        }
                        onClick={() => {
                          if (
                            !window.confirm(
                              choice === "UNLINK"
                                ? say(
                                    "Diesen Eintrag künftig vom Abgleich ausschließen? Beide Versionen bleiben erhalten.",
                                    "Exclude this item from future sync? Both versions stay.",
                                  )
                                : say(
                                    "Diese Version auf beiden Seiten übernehmen? Damit wird die andere Version ersetzt oder gelöscht.",
                                    "Use this version on both sides? The other version will be replaced or deleted.",
                                  ),
                            )
                          )
                            return;
                          void run(() =>
                            api("/cookidoo/resolve", {
                              conflictId: conflict.id,
                              choice,
                              revision: connection.revision,
                            }),
                          );
                        }}
                      >
                        {choice === "REMOTE"
                          ? say("Cookidoo übernehmen", "Use Cookidoo")
                          : choice === "LOCAL"
                            ? say("App übernehmen", "Use app")
                            : say("Eintrag trennen", "Unlink item")}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </>
          )}
          <button
            className="text-button danger"
            disabled={!!working}
            onClick={() => {
              if (
                window.confirm(
                  say(
                    "Verbindung trennen? Die Einkaufslisten auf beiden Seiten bleiben erhalten.",
                    "Disconnect? Both shopping lists stay.",
                  ),
                )
              )
                void run(() => api("/cookidoo", undefined, "DELETE"));
            }}
          >
            {say("Verbindung trennen", "Disconnect")}
          </button>
        </>
      )}
      {!connection && !formShown && (
        <button className="button secondary" onClick={() => setFormShown(true)}>
          {say("Cookidoo verbinden", "Connect Cookidoo")}
        </button>
      )}
      {formShown &&
        (!connection || belongs) &&
        (options.secureOrigin || options.allowHttp ? (
          <form
            className="cookidoo-connect"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                data = new FormData(form);
              void run(() =>
                api("/cookidoo/connect", {
                  householdId,
                  listId,
                  email: String(data.get("email")),
                  password: String(data.get("password")),
                  market: String(data.get("market")),
                  confirmedSharing: true,
                  confirmedHttp: true,
                }),
              ).then((success) => {
                form.reset();
                if (success) setFormShown(false);
              });
            }}
          >
            <div className="planning-form-grid">
              <label>
                {say("Cookidoo-E-Mail", "Cookidoo email")}
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  defaultValue={connection?.accountEmail}
                  autoComplete="off"
                />
              </label>
              <label>
                {say("Cookidoo-Passwort", "Cookidoo password")}
                <input
                  name="password"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="off"
                />
              </label>
              <label>
                {say("Region", "Region")}
                <select name="market" defaultValue={connection?.market ?? "de"}>
                  <option value="de">Deutschland</option>
                  <option value="at">Österreich</option>
                  <option value="ch">Schweiz</option>
                  <option value="gb">United Kingdom</option>
                </select>
              </label>
            </div>
            <label className="ingredient-checkbox">
              <input type="checkbox" required />
              <span>{consent}</span>
            </label>
            {!options.secureOrigin && (
              <label className="ingredient-checkbox">
                <input type="checkbox" required />
                <span>
                  {say(
                    "Diese Entwicklungsinstanz verwendet HTTP. Meine Zugangsdaten werden zwischen Browser und App unverschlüsselt übertragen. Ich möchte fortfahren.",
                    "This development instance uses HTTP. My credentials travel unencrypted between the browser and app. I want to continue.",
                  )}
                </span>
              </label>
            )}
            <p className="small muted">
              {say(
                "Das Passwort wird nur für die Anmeldung verwendet. Gespeichert werden verschlüsselte Sitzungsschlüssel.",
                "The password is used only to sign in. Only encrypted session tokens are stored.",
              )}
            </p>
            <div className="detail-actions">
              <button className="button primary" disabled={!!working}>
                {say("Verbinden und Vorschau laden", "Connect and preview")}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setFormShown(false)}
              >
                {say("Abbrechen", "Cancel")}
              </button>
            </div>
          </form>
        ) : (
          <p>
            {say(
              "Für die Cookidoo-Anmeldung diese App über HTTPS öffnen. HTTP lässt sich vom Betreiber ausdrücklich für Entwicklung freigeben.",
              "Open this app over HTTPS to sign in to Cookidoo. The operator can explicitly enable HTTP for development.",
            )}
          </p>
        ))}
    </section>
  );
}
