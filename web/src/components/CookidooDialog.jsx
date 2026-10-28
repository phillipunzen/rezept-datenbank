// „Für Cookidoo kopieren“: bereitet ein Rezept für den Editor „Rezept erstellen“ in Cookidoo auf.
// Vorwerk bietet keine Schnittstelle – der Benutzer kopiert die Abschnitte und fügt sie dort ein.
import { useState } from 'react';
import { Copy, Check, ExternalLink, Minus, Plus } from 'lucide-react';
import { Modal, useToast } from './ui.jsx';
import { useT } from '../lib/i18n.js';
import { formatAmount, formatMinutes, TM_MODES } from '../lib/format.js';

/** Thermomix-Einstellung in Cookidoo-Schreibweise, z. B. „5 Min./100°C/Linkslauf/Stufe 1“. */
export function tmNotation(tm, t) {
  if (!tm) return '';
  const parts = [];
  if (tm.time) {
    const m = Math.floor(tm.time / 60);
    const s = tm.time % 60;
    parts.push([m ? `${m} ${t('Min.')}` : '', s ? `${s} ${t('Sek.')}` : ''].filter(Boolean).join(' '));
  }
  if (tm.temp) parts.push(/^\d+$/.test(String(tm.temp)) ? `${tm.temp}°C` : String(tm.temp));
  if (tm.reverse) parts.push(t('Linkslauf'));
  if (tm.speed) parts.push(/^\d+([.,]\d+)?$/.test(String(tm.speed)) ? `${t('Stufe')} ${tm.speed}` : String(tm.speed));
  const setting = parts.join('/');
  const mode = tm.mode ? t(TM_MODES[tm.mode] || tm.mode) : '';
  return [mode, setting].filter(Boolean).join(' ');
}

function ingredientLine(i, factor) {
  const amount = i.amount != null ? formatAmount(i.amount * factor, i.unit) : '';
  return [amount, i.unit, i.name].filter(Boolean).join(' ') + (i.note ? `, ${i.note}` : '');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback ohne Clipboard-API (z. B. ohne HTTPS)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function CopyBlock({ label, text, multiline }) {
  const t = useT();
  const toast = useToast();
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } else toast(t('Kopieren nicht möglich – bitte den Text markieren und kopieren.'), { type: 'error' });
  };
  return (
    <div className="card" style={{ padding: '10px 12px' }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 4 }}>{label}</div>
          <div className="small" style={{ whiteSpace: multiline ? 'pre-wrap' : 'normal', wordBreak: 'break-word', userSelect: 'text' }}>{text}</div>
        </div>
        <button className={`btn small ${done ? '' : 'primary'}`} onClick={copy} style={{ flexShrink: 0 }}>
          {done ? <Check size={15} /> : <Copy size={15} />}{done ? t('Kopiert') : t('Kopieren')}
        </button>
      </div>
    </div>
  );
}

export default function CookidooDialog({ recipe, onClose }) {
  const t = useT();
  const base = recipe.servings || 1;
  const [servings, setServings] = useState(base);
  const factor = servings / base;
  const ingredients = recipe.ingredients.flatMap((g) => g.items.map((i) => ingredientLine(i, factor)));
  const steps = recipe.steps.map((s) => {
    const tm = tmNotation(s.tm, t);
    const text = [s.title ? `${s.title}: ` : '', s.text].join('');
    return tm ? `${text} – ${tm}` : text;
  });
  const total = recipe.total_time;
  const hasGroups = recipe.ingredients.filter((g) => g.items.length).length > 1;
  return (
    <Modal title={t('Für Cookidoo kopieren')} onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>{t('Fertig')}</button>}>
      <ol className="small muted" style={{ paddingLeft: 18, margin: '0 0 14px', lineHeight: 1.6 }}>
        <li>{t('Cookidoo öffnen und „Meine Rezepte → Erstellte Rezepte → Rezept erstellen“ wählen.')}</li>
        <li>{t('Die Abschnitte unten nacheinander kopieren und in die passenden Felder einfügen.')}</li>
        <li>{t('Nach dem Speichern erscheint das Rezept nach der Synchronisation auf deinem Thermomix.')}</li>
      </ol>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <a className="btn small" href="https://cookidoo.de" target="_blank" rel="noreferrer"><ExternalLink size={15} />{t('Cookidoo öffnen')}</a>
        <span className="spacer" />
        <span className="small muted">{t('Portionen')}</span>
        <div className="servings-ctl">
          <button className="btn ghost icon small" onClick={() => setServings(Math.max(1, servings - 1))} aria-label="-"><Minus size={16} /></button>
          <b>{servings}</b>
          <button className="btn ghost icon small" onClick={() => setServings(servings + 1)} aria-label="+"><Plus size={16} /></button>
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <CopyBlock label={t('Titel')} text={recipe.title} />
        <div className="grid-3">
          <CopyBlock label={t('Portionen')} text={String(servings)} />
          {recipe.prep_time ? <CopyBlock label={t('Arbeitszeit')} text={formatMinutes(recipe.prep_time, t)} /> : null}
          {total ? <CopyBlock label={t('Gesamtzeit')} text={formatMinutes(total, t)} /> : null}
        </div>
        <CopyBlock label={t('Zutaten (eine pro Zeile)')} text={ingredients.join('\n')} multiline />
        {hasGroups && <p className="hint">{t('Hinweis: Cookidoo kennt keine Zutatengruppen – die Zutaten stehen deshalb in einer Liste.')}</p>}
        <div className="label" style={{ marginTop: 8 }}>{t('Zubereitungsschritte – einzeln kopieren')}</div>
        {steps.map((s, i) => <CopyBlock key={i} label={t('Schritt {n}', { n: i + 1 })} text={s} multiline />)}
        {steps.length > 1 && <CopyBlock label={t('Alle Schritte auf einmal')} text={steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n')} multiline />}
      </div>
      {!recipe.steps.some((s) => s.tm) && (
        <p className="hint mt">{t('Tipp: Über „Für Thermomix vorbereiten“ kannst du Zeit, Temperatur und Stufe pro Schritt ergänzen – sie werden dann hier in Cookidoo-Schreibweise mitkopiert.')}</p>
      )}
    </Modal>
  );
}
