import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, CaretRight, CheckCircle, Info, Warning, WarningCircle, X } from '@phosphor-icons/react';
import { digits, latin, t, useLocale } from './i18n.ts';
import { useLanguages, useToasts, type Tr } from './app.ts';

const escStack: (() => void)[] = [];
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && escStack.length) {
    e.preventDefault();
    e.stopPropagation();
    escStack[escStack.length - 1]();
  }
});

export function useEscape(fn: () => void, on = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on) return;
    const h = () => ref.current();
    escStack.push(h);
    return () => {
      const i = escStack.lastIndexOf(h);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, [on]);
}

export function Dialog(props: { title: ReactNode; onClose: () => void; width?: number; children: ReactNode; foot?: ReactNode; testId?: string }) {
  useEscape(props.onClose);
  const id = useId();
  return createPortal(
    <div className="layer" role="presentation">
      <div className="scrim" onClick={props.onClose} />
      <div className="dialog" onSubmit={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={id} style={{ ['--w' as string]: `${props.width ?? 480}px` }} data-testid={props.testId}>
        <div className="dialog-head">
          <h2 className="dialog-title" id={id}>
            {props.title}
          </h2>
          <button type="button" className="btn btn-icon" onClick={props.onClose} aria-label={t('close')}>
            <X className="ic" />
          </button>
        </div>
        <div className="dialog-body">{props.children}</div>
        {props.foot && <div className="dialog-foot">{props.foot}</div>}
      </div>
    </div>,
    document.body
  );
}

type Ask = { text: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void };
let ask: Ask | null = null;
const askListeners = new Set<() => void>();

export function confirmAsk(text: string, opts: { ok?: string; danger?: boolean } = {}) {
  return new Promise<boolean>(resolve => {
    ask = { text, ...opts, resolve };
    askListeners.forEach(f => f());
  });
}

function closeAsk(v: boolean) {
  ask?.resolve(v);
  ask = null;
  askListeners.forEach(f => f());
}

export function ConfirmHost() {
  const a = useSyncExternalStore(
    f => {
      askListeners.add(f);
      return () => askListeners.delete(f);
    },
    () => ask
  );
  if (!a) return null;
  return (
    <Dialog
      title={t('areYouSure')}
      onClose={() => closeAsk(false)}
      width={420}
      testId="confirm"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={() => closeAsk(false)}>
            {t('cancel')}
          </button>
          <button type="button" className={`btn ${a.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => closeAsk(true)} autoFocus data-testid="confirm-ok">
            {a.ok ?? t('confirm')}
          </button>
        </>
      }
    >
      <p className="sub">{a.text}</p>
    </Dialog>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {list.map(x => (
        <div key={x.id} className={`toast toast-${x.kind}`} role={x.kind === 'bad' ? 'alert' : 'status'}>
          {x.kind === 'ok' ? <CheckCircle className="ic" weight="fill" /> : <WarningCircle className="ic" weight="fill" />}
          <span className="grow">{x.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Field(props: { label: ReactNode; hint?: ReactNode; required?: boolean; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${props.className ?? ''}`}>
      <label className="label" htmlFor={props.htmlFor}>
        {props.label}
        {props.required && <span className="req">*</span>}
      </label>
      {props.children}
      {props.error ? <span className="field-err">{props.error}</span> : props.hint ? <span className="hint">{props.hint}</span> : null}
    </div>
  );
}

export function NumInput(props: { value: number; onChange: (v: number) => void; disabled?: boolean; id?: string; min?: number; max?: number; name?: string }) {
  const l = useLocale();
  const [text, setText] = useState(digits(props.value, l));
  useEffect(() => {
    if (Number(latin(text)) !== props.value || text === '') setText(digits(props.value, l));
  }, [props.value, l]);
  return (
    <input
      id={props.id}
      name={props.name}
      className="input ltr"
      style={{ textAlign: 'start' }}
      inputMode="numeric"
      value={text}
      disabled={props.disabled}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9۰-۹٠-٩-]/g, '');
        setText(raw);
        const n = Number(latin(raw));
        if (raw !== '' && Number.isFinite(n)) props.onChange(n);
      }}
      onBlur={() => setText(digits(props.value, l))}
    />
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      data-testid={props.testId}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

export function SwitchRow(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; testId?: string }) {
  return (
    <label className="check">
      <Switch checked={props.checked} onChange={props.onChange} disabled={props.disabled} label={props.label} testId={props.testId} />
      {props.label}
    </label>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map(o => (
        <button type="button" key={o.value} aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TrInputs(props: { value: Tr[]; onChange: (v: Tr[]) => void; required?: boolean; disabled?: boolean; multiline?: boolean; name?: string }) {
  const { active, def } = useLanguages();
  const langs = [...active].sort((a, b) => (a.code === def ? -1 : b.code === def ? 1 : 0));
  const get = (code: string) => props.value.find(x => x.lang === code)?.text ?? '';
  const set = (code: string, text: string) => {
    const rest = props.value.filter(x => x.lang !== code);
    props.onChange(text ? [...rest, { lang: code, text }] : rest);
  };
  return (
    <div className="stack stack-sm">
      {langs.map(l => (
        <div className="tr-row" key={l.code}>
          <span className="tr-lang" title={l.name}>
            {l.code}
            {props.required && l.code === def && <span style={{ color: 'var(--neg)' }}>*</span>}
          </span>
          {props.multiline ? (
            <textarea
              className="textarea"
              dir={l.dir}
              value={get(l.code)}
              disabled={props.disabled}
              placeholder={l.name}
              name={props.name ? `${props.name}-${l.code}` : undefined}
              onChange={e => set(l.code, e.target.value)}
            />
          ) : (
            <input
              className="input"
              dir={l.dir}
              value={get(l.code)}
              disabled={props.disabled}
              placeholder={l.name}
              name={props.name ? `${props.name}-${l.code}` : undefined}
              aria-label={`${l.name}`}
              onChange={e => set(l.code, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export function trMissingDefault(value: Tr[], def: string) {
  return !value.find(x => x.lang === def && x.text.trim());
}

export function Skel(props: { w?: number | string; h?: number; r?: number; style?: React.CSSProperties }) {
  return <span className="skel" style={{ width: props.w ?? '100%', height: props.h ?? 12, borderRadius: props.r, ...props.style }} />;
}

export function Empty(props: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ic">{props.icon}</div>
      <b>{props.title}</b>
      {props.text && <span className="small">{props.text}</span>}
      {props.action}
    </div>
  );
}

export function ErrBox(props: { text: string | null | undefined }) {
  if (!props.text) return null;
  return (
    <div className="err-box" role="alert">
      <WarningCircle className="ic" weight="fill" />
      <span>{props.text}</span>
    </div>
  );
}

export function OkBox(props: { text: string | null | undefined }) {
  if (!props.text) return null;
  return (
    <div className="ok-box" role="status">
      <CheckCircle className="ic" weight="fill" />
      <span>{props.text}</span>
    </div>
  );
}

export function Notice(props: { kind?: 'info' | 'warn' | 'plain'; title?: string; text: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`notice ${props.kind === 'warn' ? 'notice-warn' : props.kind === 'plain' ? 'notice-plain' : ''}`}>
      <div className="notice-ic">{props.icon ?? (props.kind === 'warn' ? <Warning className="ic" /> : <Info className="ic" />)}</div>
      <div className="grow stack stack-sm" style={{ gap: 2 }}>
        {props.title && <b>{props.title}</b>}
        <span className="small sub">{props.text}</span>
      </div>
      {props.action}
    </div>
  );
}

export function Pager(props: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const a = props.total ? (props.page - 1) * props.pageSize + 1 : 0;
  const b = Math.min(props.total, props.page * props.pageSize);
  const rtl = useLocale() === 'fa';
  return (
    <div className="pager">
      <span className="grow" data-testid="pager-range">
        {t('rangeOf', { a, b, n: props.total })}
      </span>
      <span>{t('pageOf', { p: props.page, n: pages })}</span>
      <button type="button" className="btn btn-outline btn-sm btn-icon" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)} aria-label={t('prevPage')} data-testid="pager-prev">
        {rtl ? <CaretRight className="ic" /> : <CaretLeft className="ic" />}
      </button>
      <button type="button" className="btn btn-outline btn-sm btn-icon" disabled={props.page >= pages} onClick={() => props.onPage(props.page + 1)} aria-label={t('nextPage')} data-testid="pager-next">
        {rtl ? <CaretLeft className="ic" /> : <CaretRight className="ic" />}
      </button>
    </div>
  );
}

export function Pop(props: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; align?: 'start' | 'end'; side?: 'below' | 'beside'; testId?: string; width?: number }) {
  useEscape(props.onClose);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });
  useLayoutEffect(() => {
    const a = props.anchor?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const rtl = document.documentElement.dir === 'rtl';
    let left: number;
    let top: number;
    if (props.side === 'beside') {
      left = rtl ? a.left - w - 8 : a.right + 8;
      top = Math.min(a.top, window.innerHeight - h - 8);
    } else {
      const alignEnd = props.align === 'end';
      left = rtl !== alignEnd ? a.right - w : a.left;
      top = a.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
    }
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ left, top: Math.max(8, top) });
  }, [props.anchor]);
  return createPortal(
    <>
      <div className="pop-click" onClick={props.onClose} />
      <div className="pop" ref={ref} style={{ ...pos, width: props.width }} role="menu" data-testid={props.testId}>
        {props.children}
      </div>
    </>,
    document.body
  );
}

export function Spinner() {
  return (
    <svg className="ic spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SaveButton(props: { busy: boolean; label?: string; onClick?: () => void; disabled?: boolean; testId?: string; type?: 'submit' | 'button' }) {
  return (
    <button type={props.type ?? 'submit'} className="btn btn-primary" disabled={props.busy || props.disabled} onClick={props.onClick} data-testid={props.testId}>
      {props.busy && <Spinner />}
      {props.label ?? t('save')}
    </button>
  );
}

export function TableSkeleton(props: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: props.rows ?? 6 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: props.cols }).map((__, j) => (
            <td key={j}>
              <Skel w={j === 0 ? '70%' : `${40 + ((i * 7 + j * 13) % 40)}%`} h={10} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function ListSkeleton(props: { rows?: number }) {
  return (
    <div className="list">
      {Array.from({ length: props.rows ?? 4 }).map((_, i) => (
        <div className="list-row" key={i}>
          <div className="list-main stack stack-sm" style={{ gap: 6 }}>
            <Skel w={`${30 + ((i * 17) % 30)}%`} h={11} />
            <Skel w={`${20 + ((i * 11) % 25)}%`} h={9} />
          </div>
          <Skel w={56} h={22} r={6} />
        </div>
      ))}
    </div>
  );
}
