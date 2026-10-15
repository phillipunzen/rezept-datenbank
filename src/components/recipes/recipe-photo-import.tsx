"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, ScanText } from "lucide-react";
import { api, ApiError } from "../api";
import type { Locale } from "../translations";
import type { ChatgptStatus, ChatgptModel } from "../../../shared/chatgpt";
import type { RecipeImportPreview } from "../../../shared/recipe-import";

const messages = {
  de: {
    title: "Rezept aus Foto", hint: "Gedruckte und handschriftliche Rezepte als Foto übernehmen. Du prüfst und bearbeitest das Ergebnis vor dem Speichern.",
    connection: "ChatGPT-Verbindung", loading: "Verbindung wird geprüft …", refresh: "Verbindungsstatus aktualisieren",
    disabled: "Die Fotoerkennung wurde vom Betreiber noch nicht freigegeben.", https: "Die Verbindung zu ChatGPT benötigt eine HTTPS-Adresse für diese App.",
    operator: "Die Erkennung bleibt gesperrt, bis der Betreiber die Nutzung ohne zusätzliche Credits freigegeben hat.",
    credits: "Setze in ChatGPT → Einstellungen → Nutzung das Credit-Limit dieser App auf 0. Diese App kann die Einstellung weder selbst prüfen noch setzen. Falls das nicht möglich ist, lasse die Erkennung gesperrt.",
    confirm: "Ich habe das Credit-Limit dieser App für dieses ChatGPT-Konto auf 0 gesetzt.", confirmAction: "Einstellung bestätigen", manage: "Nutzung in ChatGPT verwalten",
    start: "Continue with ChatGPT", reconnect: "Erneut verbinden", another: "Weiteres ChatGPT-Konto verbinden", select: "Dieses Konto verwenden", disconnect: "Verbindung trennen",
    active: "Aktives Konto", disconnected: "Getrennt", paused: "Nutzung angehalten", resume: "Nutzung geprüft – fortsetzen",
    steps: "Lade das Anmeldeprogramm herunter und starte es auf deinem Rechner mit Node.js 22 oder neuer: node chatgpt-connect.mjs. Gib dort die Adresse dieser App und den folgenden Verbindungscode ein. Öffne die angezeigte Anmeldeseite auf demselben Rechner.",
    download: "Anmeldeprogramm herunterladen", guide: "Einrichtungsanleitung", code: "Verbindungscode (10 Minuten gültig)",
    welcome: "Du verwendest deinen ChatGPT-Tarif. Berechtigte Anfragen nutzen dessen Kontingent. Prüfe vor der ersten Erkennung das Credit-Limit in deinen ChatGPT-Einstellungen.",
    revoke: "Lokal getrennt. Die externe Abmeldung konnte nicht bestätigt werden. Trenne die App zusätzlich in deinen ChatGPT-Einstellungen.",
    image: "Rezeptfoto", photoAlt: "Ausgewähltes Rezeptfoto", model: "Modell für die Erkennung", modelHint: "Wähle ein Modell mit Bildeingabe. Die verfügbaren Modelle stammen aus deinem ChatGPT-Konto.", loadModels: "Modelle laden", choose: "Modell auswählen", keep: "Foto zusätzlich als Rezeptbild speichern",
    consent: "Ich möchte dieses Foto zur Erkennung an OpenAI senden und dafür meinen ChatGPT-Tarif verwenden.",
    submit: "Foto erkennen und Vorschau öffnen", recognizing: "Rezept wird gelesen …", failed: "Der Fotoimport ist fehlgeschlagen.", fileError: "Bitte JPEG, PNG oder WebP mit höchstens 8 MiB auswählen.",
  },
  en: {
    title: "Recipe from photo", hint: "Import printed or handwritten recipes from a photo. Review and edit the result before saving.",
    connection: "ChatGPT connection", loading: "Checking connection …", refresh: "Refresh connection status",
    disabled: "Photo recognition has not been enabled by the operator.", https: "Connecting ChatGPT requires an HTTPS address for this app.",
    operator: "Recognition stays locked until the operator enables usage without additional credits.",
    credits: "In ChatGPT → Settings → Usage, set this app's credit limit to 0. This app cannot check or change that setting. If this is not possible, leave recognition locked.",
    confirm: "I have set this app's credit limit to 0 for this ChatGPT account.", confirmAction: "Confirm setting", manage: "Manage usage in ChatGPT",
    start: "Continue with ChatGPT", reconnect: "Reconnect", another: "Connect another ChatGPT account", select: "Use this account", disconnect: "Disconnect",
    active: "Active account", disconnected: "Disconnected", paused: "Usage paused", resume: "Usage reviewed – resume",
    steps: "Download the sign-in helper and run it on your computer with Node.js 22 or newer: node chatgpt-connect.mjs. Enter this app's address and the connection code below. Open the displayed sign-in page on the same computer.",
    download: "Download sign-in helper", guide: "Setup guide", code: "Connection code (valid for 10 minutes)",
    welcome: "You're using your ChatGPT plan. Eligible requests use its allowance. Check the credit limit in ChatGPT settings before your first recognition request.",
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
  const [working, setWorking] = useState(false), [loading, setLoading] = useState(false), [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [credits, setCredits] = useState(false), [file, setFile] = useState<File | null>(null), [imageUrl, setImageUrl] = useState("");
  const [models, setModels] = useState<ChatgptModel[]>([]), [model, setModel] = useState(""), [consent, setConsent] = useState(false), [keep, setKeep] = useState(false);
  const active = status?.accounts.find(a => a.active && a.connected);
  const locked = busy || working || loading;
  const ready = !!(status?.enabled && status.secureOrigin && status.creditsDisabledConfirmed && active?.creditsConfirmed && !active.blocked);
  async function refresh() {
    const next = await api<ChatgptStatus>("/chatgpt");
    if (mounted.current) {
      setStatus(next);
      setCredits(false);
      setModels([]);
      setModel("");
      if (pairing && Date.parse(pairing.expiresAt) < Date.now()) setPairing(null);
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
    const next = await api<{ code: string; expiresAt: string }>("/chatgpt/pairing", { accountId });
    if (mounted.current) setPairing(next);
  }
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
      <details className="photo-connection" open={!active || !active.creditsConfirmed || !!active.blocked}>
        <summary>{t.connection}{active ? ` · ${active.email || active.label}` : ""}</summary>
        <div className="photo-connection-content">
          <p className="small">{t.credits} <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer">{t.manage}</a></p>
          {!status.creditsDisabledConfirmed && <p className="small error-box">{t.operator}</p>}
          {status.accounts.map(a => <div key={a.id} className="photo-account">
            <strong>{a.email || a.label} · {a.label}</strong>
            <span className="small muted">{a.active ? t.active : !a.connected ? t.disconnected : ""}{a.blocked ? ` · ${t.paused}` : ""}</span>
            <div className="actions wrap">
              {!a.connected && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(() => start(a.id))}>{t.reconnect}</button>}
              {a.connected && !a.active && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(async () => { await api(`/chatgpt/accounts/${a.id}/select`, {}, "POST"); await refresh(); })}>{t.select}</button>}
              {a.connected && <button type="button" className="text-button" disabled={locked} onClick={() => void action(async () => {
                const result = await api<{ revoked: boolean }>(`/chatgpt/accounts/${a.id}`, undefined, "DELETE");
                await refresh(); setPairing(null); if (!result.revoked) setNotice(t.revoke);
              })}>{t.disconnect}</button>}
              {a.blocked && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(async () => { await api(`/chatgpt/accounts/${a.id}/resume`, { reviewedUsage: true }); await refresh(); })}>{t.resume}</button>}
            </div>
          </div>)}
          {active && !active.creditsConfirmed && <div>
            <label className="checkbox-line"><input type="checkbox" checked={credits} disabled={locked} onChange={e => setCredits(e.target.checked)} />{t.confirm}</label>
            <button type="button" className="button secondary" disabled={locked || !credits} onClick={() => void action(async () => { await api(`/chatgpt/accounts/${active.id}/credits`, { confirmedZeroCredits: true }); await refresh(); })}>{t.confirmAction}</button>
          </div>}
          <div className="actions wrap">
            {status.accounts.length < 5 && <button type="button" className="button secondary" disabled={locked} onClick={() => void action(() => start(null))}>{status.accounts.length ? t.another : t.start}</button>}
            <button type="button" className="text-button" disabled={locked} onClick={() => void action(async () => {
              const next = await refresh();
              if (pairing && next.accounts.some(a => a.active && a.connected)) { setPairing(null); setNotice(t.welcome); }
            })}><RefreshCw size={15} /> {t.refresh}</button>
          </div>
          {pairing && <div className="photo-pairing">
            <p className="small">{t.steps}</p>
            <p className="small"><a href="/tools/chatgpt-connect.mjs" download="chatgpt-connect.mjs">{t.download}</a> · <a href="https://github.com/phillipunzen/rezept-datenbank/blob/main/docs/PHOTO_IMPORT.md" target="_blank" rel="noopener noreferrer">{t.guide}</a></p>
            <label>{t.code}<input readOnly value={pairing.code} autoComplete="off" spellCheck={false} onFocus={e => e.target.select()} /></label>
          </div>}
        </div>
      </details>
      {active && <form onSubmit={recognize} className="photo-import-form">
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
        <label className="checkbox-line"><input type="checkbox" checked={consent} disabled={locked || !ready} onChange={e => setConsent(e.target.checked)} />{t.consent}</label>
        <button type="submit" className="button" disabled={locked || !ready || !file || !model || !consent}><Camera size={17} />{loading ? t.recognizing : t.submit}</button>
      </form>}
    </>}
    {loading && <p role="status" className="small muted">{t.recognizing}</p>}
    {notice && <p role="status" className="small">{notice}</p>}
    {error && <div role="alert" className="error-box">{error}</div>}
  </section>;
}
