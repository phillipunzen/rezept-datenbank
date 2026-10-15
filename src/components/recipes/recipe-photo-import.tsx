"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, ScanText } from "lucide-react";
import { api, ApiError } from "../api";
import type { Locale } from "../translations";
import type { ChatgptStatus, ChatgptModel, ChatgptDeviceStatus } from "../../../shared/chatgpt";
import type { RecipeImportPreview } from "../../../shared/recipe-import";

const messages = {
  de: {
    title: "Rezept aus Foto", hint: "Gedruckte und handschriftliche Rezepte als Foto übernehmen. Du prüfst und bearbeitest das Ergebnis vor dem Speichern.",
    shared: "Zentrale ChatGPT-Verbindung", sharedHint: "Die KI-Erkennung verwendet die vom Administrator freigegebene Verbindung. Du brauchst kein eigenes ChatGPT-Konto.", sharedUnavailable: "Die zentrale Verbindung ist nicht verfügbar oder noch nicht freigegeben. Bitte den Administrator informieren.", sharedConsent: "Ich möchte dieses Foto zur Erkennung über die zentrale ChatGPT-Verbindung an OpenAI senden.",
    personal: "Meine ChatGPT-Verbindungen",
    connection: "ChatGPT-Verbindung", loading: "Verbindung wird geprüft …", refresh: "Verbindungsstatus aktualisieren",
    disabled: "Die Fotoerkennung wurde vom Betreiber noch nicht freigegeben.", https: "Die Verbindung zu ChatGPT benötigt eine HTTPS-Adresse für diese App.",
    operator: "Die Erkennung bleibt gesperrt, bis der Betreiber die Nutzung ohne zusätzliche Credits freigegeben hat.",
    credits: "Lasse zusätzliches Codex-Guthaben und automatische Guthabenaufladung deaktiviert. Vor jeder Erkennung prüft die App die von Codex gemeldete enthaltene Nutzung. Bei vorhandenem Zusatzguthaben oder unbekanntem Status bleibt sie gesperrt.",
    confirm: "Für dieses ChatGPT-Konto ist zusätzliches Codex-Guthaben samt automatischer Aufladung deaktiviert.", confirmAction: "Einstellung bestätigen", manage: "Nutzung in ChatGPT verwalten",
    start: "Continue with ChatGPT", reconnect: "Erneut verbinden", another: "Weiteres ChatGPT-Konto verbinden", select: "Dieses Konto verwenden", disconnect: "Verbindung trennen",
    active: "Aktives Konto", disconnected: "Getrennt", paused: "Nutzung angehalten", resume: "Nutzung geprüft – fortsetzen",
    steps: "Öffne die OpenAI-Anmeldung, melde dich mit deinem ChatGPT-Konto an und gib den unten angezeigten Einmalcode ein. Die Verbindung wird danach automatisch übernommen. Falls Device Code gesperrt ist, aktiviere ihn in den Sicherheitseinstellungen deines ChatGPT-Kontos.",
    guide: "Einrichtungsanleitung", code: "Einmalcode für OpenAI", openLogin: "Bei OpenAI anmelden", waiting: "Warte auf die Bestätigung bei OpenAI …", cancelLogin: "Anmeldung abbrechen", expired: "Der Einmalcode ist abgelaufen. Bitte die Anmeldung erneut starten.", deviceFailed: "Die Device-Anmeldung wurde nicht abgeschlossen. Bitte Device-Code-Freigabe in ChatGPT prüfen und erneut starten.",
    welcome: "Dein ChatGPT-Konto wurde über Device Code verbunden. Prüfe vor der ersten Erkennung die Nutzungseinstellungen für Codex und bestätige, dass Zusatzguthaben und automatische Aufladung deaktiviert sind.",
    revoke: "Lokal getrennt. Die externe Abmeldung konnte nicht bestätigt werden. Trenne die App zusätzlich in deinen ChatGPT-Einstellungen.",
    image: "Rezeptfoto", photoAlt: "Ausgewähltes Rezeptfoto", model: "Modell für die Erkennung", modelHint: "Wähle ein Modell mit Bildeingabe. Die verfügbaren Modelle stammen aus deinem ChatGPT-Konto.", loadModels: "Modelle laden", choose: "Modell auswählen", keep: "Foto zusätzlich als Rezeptbild speichern",
    consent: "Ich möchte dieses Foto zur Erkennung an OpenAI senden und dafür meinen ChatGPT-Tarif verwenden.",
    submit: "Foto erkennen und Vorschau öffnen", recognizing: "Rezept wird gelesen …", failed: "Der Fotoimport ist fehlgeschlagen.", fileError: "Bitte JPEG, PNG oder WebP mit höchstens 8 MiB auswählen.",
  },
  en: {
    title: "Recipe from photo", hint: "Import printed or handwritten recipes from a photo. Review and edit the result before saving.",
    shared: "Shared ChatGPT connection", sharedHint: "AI recognition uses the connection shared by the administrator. You do not need your own ChatGPT account.", sharedUnavailable: "The shared connection is unavailable or not yet approved. Please contact the administrator.", sharedConsent: "Send this photo to OpenAI for recognition using the shared ChatGPT connection.",
    personal: "My ChatGPT connections",
    connection: "ChatGPT connection", loading: "Checking connection …", refresh: "Refresh connection status",
    disabled: "Photo recognition has not been enabled by the operator.", https: "Connecting ChatGPT requires an HTTPS address for this app.",
    operator: "Recognition stays locked until the operator enables usage without additional credits.",
    credits: "Keep additional Codex credits and automatic top-ups disabled. Before recognition the app checks the included usage reported by Codex. Available extra credits or an unknown status keep recognition locked.",
    confirm: "Additional Codex credits and automatic top-ups are disabled for this ChatGPT account.", confirmAction: "Confirm setting", manage: "Manage usage in ChatGPT",
    start: "Continue with ChatGPT", reconnect: "Reconnect", another: "Connect another ChatGPT account", select: "Use this account", disconnect: "Disconnect",
    active: "Active account", disconnected: "Disconnected", paused: "Usage paused", resume: "Usage reviewed – resume",
    steps: "Open the OpenAI sign-in page, sign in to your ChatGPT account and enter the one-time code below. The app will pick up the completed sign-in automatically. If device login is disabled, enable it in your ChatGPT security settings.",
    guide: "Setup guide", code: "One-time code for OpenAI", openLogin: "Sign in at OpenAI", waiting: "Waiting for confirmation at OpenAI …", cancelLogin: "Cancel sign-in", expired: "The one-time code has expired. Please start sign-in again.", deviceFailed: "Device sign-in did not complete. Check your ChatGPT device-code setting and try again.",
    welcome: "Your ChatGPT account is connected through device code. Review Codex usage settings and confirm that additional credits and automatic top-ups are disabled before recognition.",
    revoke: "Disconnected locally. Remote sign-out could not be confirmed. Also disconnect this app in your ChatGPT settings.",
    image: "Recipe photo", photoAlt: "Selected recipe photo", model: "Recognition model", modelHint: "Choose a model that accepts image input. Available models come from your ChatGPT account.", loadModels: "Load models", choose: "Select a model", keep: "Also save the photo as a recipe image",
    consent: "Send this photo to OpenAI for recognition using my ChatGPT plan.",
    submit: "Recognize photo and open preview", recognizing: "Reading recipe …", failed: "Photo import failed.", fileError: "Choose a JPEG, PNG or WebP file up to 8 MiB.",
  },
};
export function RecipePhotoImport({ householdId, locale, busy, onLoading, onReplace, onImport }: {
  householdId: string; locale: Locale; busy: boolean; onLoading: (loading: boolean) => void;
  onReplace: () => boolean; onImport: (preview: RecipeImportPreview) => void;
}) {
  const t = messages[locale], mounted = useRef(true);
  const [status, setStatus] = useState<ChatgptStatus | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false), [loading, setLoading] = useState(false), [device, setDevice] = useState<ChatgptDeviceStatus | null>(null);
  const [credits, setCredits] = useState(false), [file, setFile] = useState<File | null>(null), [imageUrl, setImageUrl] = useState("");
  const [models, setModels] = useState<ChatgptModel[]>([]), [model, setModel] = useState(""), [consent, setConsent] = useState(false), [keep, setKeep] = useState(false);
  const active = status?.accounts.find(a => a.active && a.connected);
  const shared = status?.shared?.enabled ? status.shared : null;
  const effective = shared || active;
  const locked = busy || working || loading;
  const ready = !!(status?.enabled && status.secureOrigin && status.creditsDisabledConfirmed && effective?.provider === "device" && effective.creditsConfirmed && !effective.blocked && (shared ? shared.connected : !!active));
  async function refresh() {
    const next = await api<ChatgptStatus>("/chatgpt");
    if (mounted.current) {
      setStatus(next);
      setCredits(false);
      setModels([]);
      setModel("");

    }
    return next;
  }
  useEffect(() => {
    mounted.current = true;
    api<ChatgptStatus>("/chatgpt").then(next => { if (mounted.current) setStatus(next); })
      .catch(e => { if (mounted.current) setError(e instanceof Error ? e.message : t.failed); });
    return () => { mounted.current = false; };
  }, [t.failed]);
  useEffect(() => {
    if (!file) { setImageUrl(""); return; }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function action(work: () => Promise<void>) {
    if (locked) return;
    setWorking(true); setError(""); setNotice("");
    try { await work(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t.failed); }
    finally { if (mounted.current) setWorking(false); }
  }
  async function start(accountId: string | null) {
    const next = await api<ChatgptDeviceStatus>("/chatgpt/device/start", { accountId });
    if (!mounted.current) return;
    if (next.status === "COMPLETE") { await refresh(); setDevice(null); setNotice(t.welcome); }
    else setDevice(next);
  }
  useEffect(() => {
    if (!device || device.status !== "PENDING") return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const current = device;
    async function poll() {
      if (Date.parse(current.expiresAt) <= Date.now()) { setDevice({ ...current, status: "EXPIRED", userCode: "" }); return; }
      try {
        const next = await api<ChatgptDeviceStatus>(`/chatgpt/device/${current.id}`);
        if (stopped) return;
        if (next.status === "COMPLETE") {
          await refresh();
          if (!stopped) { setDevice(null); setNotice(t.welcome); }
          return;
        }
        if (next.status !== "PENDING") { setDevice(next); return; }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : t.failed);
      }
      if (!stopped) timer = setTimeout(poll, 2500);
    }
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
    // A login keeps its own ID and expiry; ordinary form edits must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id, device?.status, t.failed, t.welcome]);
  async function recognize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !ready || !file || !model || !consent || !onReplace()) return;
    setLoading(true); onLoading(true); setError("");
    try {
      const query = new URLSearchParams({ householdId, model, consent: "true", keepPhoto: String(keep) });
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`/api/v1/recipe-imports/photo/preview?${query}`, { method: "POST", credentials: "same-origin", body });
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.message ?? t.failed, response.status);
      if (mounted.current) onImport(data as RecipeImportPreview);
    } catch (e) {
      if (mounted.current) { setError(e instanceof Error ? e.message : t.failed); await refresh().catch(() => {}); }
    } finally {
      if (mounted.current) { setLoading(false); onLoading(false); }
    }
  }
  return <section className="panel recipe-photo-import" aria-label={t.title}>
    <h2><ScanText size={19} /> {t.title}</h2>
    <p className="muted small">{t.hint}</p>
    {!status && !error && <p role="status">{t.loading}</p>}
    {status && !status.enabled && <p className="small muted">{t.disabled}</p>}
    {status?.enabled && !status.secureOrigin && <p className="error-box">{t.https}</p>}
    {status?.enabled && status.secureOrigin && <>
      {shared && <div className="photo-account">
        <strong>{t.shared}</strong>
        <p className="small">{t.sharedHint}</p>
        {!ready && <p className="small error-box">{t.sharedUnavailable}</p>}
        <button type="button" className="text-button" disabled={locked} onClick={() => void action(async () => { await refresh(); })}><RefreshCw size={15} /> {t.refresh}</button>
      </div>}
      {(!shared || status.canManageShared) && <details className="photo-connection" open={!active || !active.creditsConfirmed || !!active.blocked || !!device}>
        <summary>{shared ? t.personal : t.connection}{active ? ` · ${active.email || active.label}` : ""}</summary>
        <div className="photo-connection-content">
          <p className="small">{t.credits} <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer">{t.manage}</a></p>
          {!status.creditsDisabledConfirmed && <p className="small error-box">{t.operator}</p>}
          {status.accounts.map(a => <div key={a.id} className="photo-account">
            <strong>{a.email || a.label} · {a.label}</strong>
            <span className="small muted">{a.active ? t.active : !a.connected ? t.disconnected : ""}{a.blocked ? ` · ${t.paused}` : ""}</span>
            <div className="actions wrap">
              <button type="button" className="button secondary" disabled={locked} onClick={() => void action(() => start(a.id))}>{t.reconnect}</button>
              {a.connected && !a.active && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(async () => { await api(`/chatgpt/accounts/${a.id}/select`, {}, "POST"); await refresh(); })}>{t.select}</button>}
              {a.connected && <button type="button" className="text-button" disabled={locked} onClick={() => void action(async () => {
                const result = await api<{ revoked: boolean }>(`/chatgpt/accounts/${a.id}`, undefined, "DELETE");
                await refresh(); setDevice(null); if (!result.revoked) setNotice(t.revoke);
              })}>{t.disconnect}</button>}
              {a.blocked && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(async () => { await api(`/chatgpt/accounts/${a.id}/resume`, { reviewedUsage: true }); await refresh(); })}>{t.resume}</button>}
            </div>
          </div>)}
          {active?.provider === "device" && !active.creditsConfirmed && <div>
            <label className="checkbox-line"><input type="checkbox" checked={credits} disabled={locked} onChange={e => setCredits(e.target.checked)} />{t.confirm}</label>
            <button type="button" className="button secondary" disabled={locked || !credits} onClick={() => void action(async () => { await api(`/chatgpt/accounts/${active.id}/credits`, { confirmedZeroCredits: true }); await refresh(); })}>{t.confirmAction}</button>
          </div>}
          <div className="actions wrap">
            {status.accounts.length < 5 && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(() => start(null))}>{status.accounts.length ? t.another : t.start}</button>}
            <button type="button" className="text-button" disabled={locked} onClick={() => void action(async () => {
              await refresh();
            })}><RefreshCw size={15} /> {t.refresh}</button>
          </div>
          {device && <div className="photo-pairing">
            {device.status === "PENDING" ? <>
              <p className="small">{t.steps}</p>
              <p><a className="button secondary" href={device.verificationUrl} target="_blank" rel="noopener noreferrer">{t.openLogin}</a></p>
              <label>{t.code}<input readOnly value={device.userCode} autoComplete="off" spellCheck={false} onFocus={e => e.target.select()} /></label>
              <p className="small muted" role="status">{t.waiting}</p>
              <button className="text-button" type="button" disabled={locked} onClick={() => void action(async () => { await api(`/chatgpt/device/${device.id}`, undefined, "DELETE"); setDevice(null); })}>{t.cancelLogin}</button>
            </> : <p role="alert" className="small error-box">{device.status === "EXPIRED" ? t.expired : t.deviceFailed}</p>}
            <p className="small"><a href="https://github.com/phillipunzen/rezept-datenbank/blob/main/docs/PHOTO_IMPORT.md" target="_blank" rel="noopener noreferrer">{t.guide}</a></p>
          </div>}
        </div>
      </details>}
      {(shared || active) && <form onSubmit={recognize} className="photo-import-form">
        <label>{t.image}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={e => {
          const selected = e.target.files?.[0]; setConsent(false); setError("");
          if (!selected) { setFile(null); return; }
          if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 8 * 1024 * 1024) { setError(t.fileError); setFile(null); e.target.value = ""; return; }
          setFile(selected);
        }} /></label>
        {imageUrl && <img className="photo-source-preview" src={imageUrl} alt={t.photoAlt} />}
        <div className="photo-models">
          <label>{t.model}<select aria-label={t.model} value={model} disabled={locked || !ready} onChange={e => setModel(e.target.value)}><option value="">{t.choose}</option>{models.map(m => <option key={m.slug} value={m.slug}>{m.displayName}</option>)}</select></label>
          <button className="button secondary" type="button" disabled={locked || !ready} onClick={() => void action(async () => {
            const result = await api<{ models: ChatgptModel[] }>("/chatgpt/models"); setModels(result.models); setModel("");
          })}>{t.loadModels}</button>
        </div>
        <p className="muted small">{t.modelHint}</p>
        <label className="checkbox-line"><input type="checkbox" checked={keep} disabled={locked} onChange={e => setKeep(e.target.checked)} />{t.keep}</label>
        <label className="checkbox-line"><input type="checkbox" checked={consent} disabled={locked || !ready} onChange={e => setConsent(e.target.checked)} />{shared ? t.sharedConsent : t.consent}</label>
        <button type="submit" className="button" disabled={locked || !ready || !file || !model || !consent}><Camera size={17} />{loading ? t.recognizing : t.submit}</button>
      </form>}
    </>}
    {loading && <p role="status" className="small muted">{t.recognizing}</p>}
    {notice && <p role="status" className="small">{notice}</p>}
    {error && <div role="alert" className="error-box">{error}</div>}
  </section>;
}
