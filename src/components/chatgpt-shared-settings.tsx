"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Locale } from "./translations";
import type { ChatgptStatus } from "../../shared/chatgpt";

export function ChatgptSharedSettings({ locale }: { locale: Locale }) {
  const de = locale === "de";
  const [status, setStatus] = useState<ChatgptStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    api<ChatgptStatus>("/chatgpt").then(s => { if (!stopped) setStatus(s); }).catch(e => { if (!stopped) setError(e.message); });
    return () => { stopped = true; };
  }, []);
  async function share(accountId: string | null) {
    setBusy(true); setError("");
    try {
      await api("/chatgpt/shared", { accountId }, "PUT");
      setStatus(await api<ChatgptStatus>("/chatgpt"));
    } catch (e) { setError(e instanceof Error ? e.message : "Fehler"); }
    finally { setBusy(false); }
  }
  const accounts = status?.accounts.filter(a => a.connected && a.provider === "device") ?? [];
  return <section className="panel" aria-label={de ? "Zentrale ChatGPT-Verbindung" : "Shared ChatGPT connection"}>
    <h2>{de ? "Zentrale ChatGPT-Verbindung" : "Shared ChatGPT connection"}</h2>
    <p className="small muted">{de
      ? "Gib eine deiner ChatGPT-Verbindungen für alle angemeldeten Benutzer frei. Alle KI-Anfragen dieser App verwenden dann diese Verbindung und teilen sich deren Nutzungslimit. Persönliche Verbindungen werden währenddessen nicht verwendet."
      : "Share one of your ChatGPT connections with all signed-in users. All AI requests in this app then use this connection and share its usage allowance. Personal connections are not used while sharing is enabled."}</p>
    {status && <p role="status">{status.shared?.enabled
      ? de ? "Zentrale Verbindung aktiviert." : "Shared connection enabled."
      : de ? "Persönliche Verbindungen sind aktiv." : "Personal connections are in use."}</p>}
    {status?.shared?.enabled && (!status.shared.connected || status.shared.blocked || !status.shared.creditsConfirmed || !status.creditsDisabledConfirmed) &&
      <p className="error-box small">{de ? "Die zentrale Erkennung ist noch gesperrt. Verbindung und Nutzungseinstellungen beim Fotoimport prüfen. Es wird keine persönliche Ersatzverbindung verwendet." : "Shared recognition is currently locked. Review the connection and usage settings in photo import. No personal fallback is used."}</p>}
    {status?.canManageShared && <>
      {accounts.map(a => <div className="photo-account" key={a.id}>
        <strong>{a.email || a.label}</strong>
        <button type="button" className="button secondary" disabled={busy || !status.enabled || !status.secureOrigin || (status.shared?.enabled && status.shared.ownAccountId === a.id)} onClick={() => void share(a.id)}>
          {status.shared?.enabled && status.shared.ownAccountId === a.id
            ? de ? "Für alle Benutzer aktiv" : "Active for all users"
            : de ? "Für alle Benutzer verwenden" : "Use for all users"}
        </button>
      </div>)}
      {!accounts.length && <p className="small">{de ? "Verbinde zuerst dein ChatGPT-Konto unter Rezepte → Rezept hinzufügen → Rezept aus Foto." : "First connect your ChatGPT account under Recipes → Add recipe → Recipe from photo."}</p>}
      {status.shared?.enabled && <button type="button" className="text-button" disabled={busy} onClick={() => void share(null)}>{de ? "Zentrale Freigabe beenden" : "Stop sharing"}</button>}
    </>}
    {error && <p className="error-box" role="alert">{error}</p>}
  </section>;
}
