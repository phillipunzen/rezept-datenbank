import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { X, ChevronLeft, ChevronRight, Play, Pause, RotateCcw, Timer, Thermometer, Gauge, Sun, Check, ListChecks, Minus, Plus, BellRing } from 'lucide-react';
import { api } from '../lib/api.js';
import { useT } from '../lib/i18n.js';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { CookedDialog } from '../components/dialogs.jsx';
import { formatAmount, formatSeconds, tmTemp, TM_MODES } from '../lib/format.js';
import { applyVariant, ingredientsForStep } from '../lib/recipe.js';

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7].forEach((t0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + 0.3);
      o.start(ctx.currentTime + t0);
      o.stop(ctx.currentTime + t0 + 0.32);
    });
  } catch { /* kein Audio */ }
  navigator.vibrate?.([300, 150, 300, 150, 300]);
}

/** Bildschirm eingeschaltet lassen (Screen Wake Lock API). */
function useWakeLock() {
  const [active, setActive] = useState(false);
  const lock = useRef(null);
  const request = useCallback(async () => {
    try {
      if (!('wakeLock' in navigator)) return;
      lock.current = await navigator.wakeLock.request('screen');
      setActive(true);
      lock.current.addEventListener('release', () => setActive(false));
    } catch { setActive(false); }
  }, []);
  useEffect(() => {
    request();
    const onVis = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock.current?.release().catch(() => {}); };
  }, [request]);
  return { active, supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator, request };
}

export default function CookMode() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const [recipe, setRecipe] = useState(null);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(-1);
  const [servings, setServings] = useState(null);
  const [timers, setTimers] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [doneIngs, setDoneIngs] = useState(new Set());
  const [finish, setFinish] = useState(false);
  const wake = useWakeLock();
  const touch = useRef(null);

  useEffect(() => {
    api.get(`/api/recipes/${id}`).then((r) => {
      setRecipe(r);
      const s = Number(params.get('servings'));
      setServings(s > 0 ? s : null);
    }).catch(setError);
  }, [id, params]);

  // Timer-Ticks
  useEffect(() => {
    const iv = setInterval(() => {
      setTimers((ts) => ts.map((tm) => {
        if (!tm.running) return tm;
        const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000));
        if (left === 0 && !tm.done) {
          beep();
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(t('Timer abgelaufen'), { body: tm.label }); } catch { /* ignore */ }
          }
          return { ...tm, left: 0, running: false, done: true };
        }
        return { ...tm, left };
      }));
    }, 500);
    return () => clearInterval(iv);
  }, [t]);

  const view = useMemo(() => (recipe ? applyVariant(recipe, params.get('variant') === '1') : null), [recipe, params]);
  const steps = view?.steps || [];
  const total = steps.length;

  const go = useCallback((d) => setStep((s) => Math.max(-1, Math.min(total - 1, s + d))), [total]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'Escape') navigate(`/recipes/${id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, id, navigate]);

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!recipe) return <Loading />;

  const base = view.servings || 1;
  const current = servings || base;
  const factor = current / base;
  const cur = step >= 0 ? steps[step] : null;
  const stepIngs = cur ? ingredientsForStep(cur, view.ingredients) : [];
  const timerSeconds = cur ? cur.tm?.time || cur.timer : null;

  const startTimer = (seconds, label) => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    setTimers((ts) => [...ts, { id: Math.random(), label, total: seconds, left: seconds, endsAt: Date.now() + seconds * 1000, running: true, done: false }]);
  };
  const toggleTimer = (tid) => setTimers((ts) => ts.map((tm) => (tm.id !== tid ? tm : tm.running ? { ...tm, running: false } : { ...tm, running: true, endsAt: Date.now() + tm.left * 1000 })));
  const removeTimer = (tid) => setTimers((ts) => ts.filter((tm) => tm.id !== tid));
  const stepTimer = timers.find((tm) => tm.step === step);

  const ingList = (items, highlight) => (
    <ul className={`cook-ings ${highlight ? 'highlight' : ''}`}>
      {items.map((i, idx) => {
        const k = `${i.name}-${idx}`;
        return (
          <li key={k} className={doneIngs.has(i.name) ? 'done' : ''} onClick={() => {
            const n = new Set(doneIngs);
            if (n.has(i.name)) n.delete(i.name); else n.add(i.name);
            setDoneIngs(n);
          }}>
            <b>{formatAmount(i.amount != null ? i.amount * factor : null, i.unit)} {i.unit}</b>
            <span>{i.name}{i.note ? <span className="faint">, {i.note}</span> : ''}</span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="cook" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 80) go(dx < 0 ? 1 : -1);
        touch.current = null;
      }}>
      <div className="cook-top">
        <button className="btn ghost icon" onClick={() => navigate(`/recipes/${id}`)} aria-label={t('Schließen')}><X size={24} /></button>
        <h2>{recipe.title}</h2>
        {wake.supported && (
          <span className={`badge ${wake.active ? 'green' : ''}`} title={t('Bildschirm bleibt eingeschaltet')} onClick={wake.request} style={{ cursor: 'pointer' }}>
            <Sun size={13} /><span className="wake-label">{wake.active ? t('Bildschirm bleibt an') : t('Bildschirm-Sperre aktiv')}</span>
          </span>
        )}
        <span className="badge">{step < 0 ? t('Übersicht') : `${step + 1} / ${total}`}</span>
      </div>
      <div className="cook-progress"><div style={{ width: `${total ? ((step + 1) / total) * 100 : 0}%` }} /></div>

      <div className="cook-body">
        <div className="cook-step">
          {step < 0 ? (
            <>
              <div className="step-label">{t('Bereitlegen')}</div>
              <div className="row wrap" style={{ gap: 14 }}>
                <span className="step-sub">{t('Portionen')}</span>
                <div className="servings-ctl">
                  <button className="btn ghost icon" onClick={() => setServings(Math.max(1, current - 1))}><Minus size={20} /></button>
                  <b style={{ fontSize: '1.2rem' }}>{current}</b>
                  <button className="btn ghost icon" onClick={() => setServings(current + 1)}><Plus size={20} /></button>
                </div>
              </div>
              {view.ingredients.map((g, gi) => (
                <div key={gi}>
                  {g.name && <div className="step-sub" style={{ marginBottom: 4 }}>{g.name}</div>}
                  {ingList(g.items)}
                </div>
              ))}
              {!total && <p className="muted">{t('Dieses Rezept hat keine Schritte.')}</p>}
            </>
          ) : (
            <>
              <div className="step-label">{t('Schritt {n}', { n: step + 1 })}{cur.title ? ` · ${cur.title}` : ''}</div>
              <div className="step-text">{cur.text}</div>
              {cur.tm && (
                <div className="tm-big">
                  {cur.tm.time ? <div><span><Timer size={13} /> {t('Zeit')}</span><b>{formatSeconds(cur.tm.time)}</b></div> : null}
                  {cur.tm.temp ? <div><span><Thermometer size={13} /> {t('Temperatur')}</span><b>{tmTemp(cur.tm.temp)}</b></div> : null}
                  {cur.tm.speed ? <div><span><Gauge size={13} /> {t('Stufe')}</span><b>{cur.tm.reverse ? '⟲ ' : ''}{cur.tm.speed}</b></div> : null}
                  {cur.tm.reverse && !cur.tm.speed ? <div><span>{t('Linkslauf')}</span><b>⟲</b></div> : null}
                  {cur.tm.mode ? <div><span>{t('Modus')}</span><b>{t(TM_MODES[cur.tm.mode] || cur.tm.mode)}</b></div> : null}
                </div>
              )}
              {timerSeconds ? (
                stepTimer ? (
                  <div className={`timer-card ${stepTimer.done ? 'done' : stepTimer.running ? 'running' : ''}`}>
                    {stepTimer.done ? <BellRing size={30} /> : <Timer size={30} />}
                    <span className="time">{formatSeconds(stepTimer.left)}</span>
                    <span className="spacer" />
                    {!stepTimer.done && <button className="btn large" onClick={() => toggleTimer(stepTimer.id)}>{stepTimer.running ? <Pause size={22} /> : <Play size={22} />}</button>}
                    <button className="btn large" onClick={() => removeTimer(stepTimer.id)}>{stepTimer.done ? <Check size={22} /> : <RotateCcw size={22} />}</button>
                  </div>
                ) : (
                  <button className="btn large" style={{ alignSelf: 'flex-start' }} onClick={() => setTimers((ts) => [...ts, {
                    id: Math.random(), step, label: `${t('Schritt {n}', { n: step + 1 })}: ${cur.text.slice(0, 40)}`, total: timerSeconds, left: timerSeconds, endsAt: Date.now() + timerSeconds * 1000, running: true, done: false,
                  }])}>
                    <Timer size={22} />{t('Timer starten')} · {formatSeconds(timerSeconds)}
                  </button>
                )
              ) : (
                <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => {
                  const m = Number(prompt(t('Minuten für den Timer:'), '10'));
                  if (m > 0) startTimer(Math.round(m * 60), `${t('Schritt {n}', { n: step + 1 })}`);
                }}><Timer size={16} />{t('Eigenen Timer stellen')}</button>
              )}
            </>
          )}
        </div>

        <aside className="cook-side">
          {timers.filter((tm) => tm.step !== step).length > 0 && (
            <div className="timers-floating" style={{ marginBottom: 20 }}>
              <div className="label">{t('Laufende Timer')}</div>
              {timers.filter((tm) => tm.step !== step).map((tm) => (
                <div key={tm.id} className={`timer-chip ${tm.done ? 'done' : ''}`}>
                  <Timer size={16} /><span style={{ flex: 1, fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tm.label}</span>
                  <span>{formatSeconds(tm.left)}</span>
                  {!tm.done && <button className="btn ghost icon small" onClick={() => toggleTimer(tm.id)}>{tm.running ? <Pause size={14} /> : <Play size={14} />}</button>}
                  <button className="btn ghost icon small" onClick={() => removeTimer(tm.id)}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
          {step >= 0 && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <div className="label" style={{ flex: 1 }}>{showAll || !stepIngs.length ? t('Alle Zutaten') : t('Zutaten für diesen Schritt')}</div>
                {stepIngs.length > 0 && <button className="btn ghost small" onClick={() => setShowAll(!showAll)}><ListChecks size={16} />{showAll ? t('Nur Schritt') : t('Alle')}</button>}
              </div>
              {showAll || !stepIngs.length
                ? view.ingredients.map((g, gi) => <div key={gi}>{g.name && <div className="tiny faint" style={{ fontWeight: 700, marginTop: 8 }}>{g.name}</div>}{ingList(g.items)}</div>)
                : ingList(stepIngs, true)}
            </>
          )}
          {step < 0 && <p className="muted small">{t('Tipp: Wische nach links oder rechts, um zwischen den Schritten zu wechseln. Tippe Zutaten an, um sie abzuhaken.')}</p>}
        </aside>
      </div>

      <div className="cook-nav">
        <button className="btn" disabled={step < 0} onClick={() => go(-1)}><ChevronLeft size={26} />{t('Zurück')}</button>
        {step < total - 1
          ? <button className="btn primary" onClick={() => go(1)}>{step < 0 ? t('Los geht\'s') : t('Weiter')}<ChevronRight size={26} /></button>
          : <button className="btn primary" onClick={() => setFinish(true)}><Check size={24} />{t('Fertig!')}</button>}
      </div>
      {finish && <CookedDialog recipe={recipe} servings={current} onClose={() => { setFinish(false); navigate(`/recipes/${id}`); }} />}
    </div>
  );
}
