import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Star, ImageOff, AlertTriangle, Info, CheckCircle2, XCircle } from 'lucide-react';
import { useT } from '../lib/i18n.js';
import { api } from '../lib/api.js';

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.duration || 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type || ''}`}>
            <span>{t.msg}</span>
            {t.action && <button onClick={() => { t.action.fn(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3 style={{ fontSize: '1.15rem' }}>{title}</h3>
          <button className="btn ghost icon small" onClick={onClose} aria-label="Schließen"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel, danger, onConfirm, onClose }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{t('Abbrechen')}</button>
      <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>
        {confirmLabel || t('Bestätigen')}
      </button>
    </>}>
      <p className="muted">{text}</p>
    </Modal>
  );
}

// ---------- Menü ----------
export function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className="menu-pop" style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------- Kleinteile ----------
export function Stars({ value, onChange, size = 18 }) {
  const [hover, setHover] = useState(0);
  const v = hover || Math.round(value || 0);
  return (
    <span className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => onChange ? (
        <button key={i} type="button" aria-label={`${i}`} onMouseEnter={() => setHover(i)} onClick={() => onChange(i === value ? 0 : i)}>
          <Star size={size} fill={i <= v ? 'currentColor' : 'none'} className={i <= v ? '' : 'off'} />
        </button>
      ) : (
        <Star key={i} size={size} fill={i <= v ? 'currentColor' : 'none'} className={i <= v ? '' : 'off'} />
      ))}
    </span>
  );
}

export function Loading() {
  return <div className="loading"><div className="spinner" /></div>;
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={48} strokeWidth={1.4} />}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className="mt" style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>{children}</div>}
    </div>
  );
}

export function Alert({ type = 'info', children }) {
  const Icon = { info: Info, warn: AlertTriangle, error: XCircle, success: CheckCircle2 }[type];
  return <div className={`alert ${type}`}><Icon size={18} /><div>{children}</div></div>;
}

export function Img({ src, alt = '', className, iconSize = 36 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <div className={`placeholder ${className || ''}`}><ImageOff size={iconSize} strokeWidth={1.3} /></div>;
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setErr(true)} />;
}

export function Avatar({ user, size }) {
  const name = user?.display_name || user?.name || '?';
  return (
    <span className={`avatar ${size || ''}`}>
      {user?.avatar ? <img src={user.avatar} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------- Daten laden ----------
export function useApi(url, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!url) return setState({ data: null, error: null, loading: false });
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(url);
      setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

export function ErrorBox({ error, onRetry }) {
  const t = useT();
  if (!error) return null;
  return (
    <div className="mt">
      <Alert type="error">
        {error.message}
        {onRetry && <> · <span className="link" onClick={onRetry}>{t('Erneut versuchen')}</span></>}
      </Alert>
    </div>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
