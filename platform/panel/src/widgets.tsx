import { useState, type ReactNode } from 'react';
import { Check, Plus } from '@phosphor-icons/react';
import { useRows } from './conn.ts';
import { date, digits, errorText, latin, num, t, type StrKey } from './i18n.ts';
import { run, trText, useLanguages, useSession, type Tr } from './app.ts';
import { Dialog, ErrBox, Field, TrInputs, trMissingDefault } from './ui.tsx';
import { TagDialog } from './dialogs.tsx';

export type Ts = { toDate(): Date; microsSinceUnixEpoch: bigint };

export function when(ts: Ts | undefined | null, withTime = true) {
  return ts ? date(ts.toDate(), withTime) : '—';
}

export function useTagsOf(keyType: string) {
  const all = useRows('tag');
  return all.filter(x => x.keyType === keyType).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

export function TagChip(props: { title: Tr[] | undefined; tkey: string; color?: string; onClick?: () => void; on?: boolean; testId?: string }) {
  const { def } = useLanguages();
  const label = trText(props.title, def) || props.tkey;
  const content = (
    <>
      {props.color ? <span className="swatch" style={{ background: props.color, width: 10, height: 10 }} /> : null}
      {label}
      {props.on && <Check className="ic" />}
    </>
  );
  if (!props.onClick) return <span className="chip">{content}</span>;
  return (
    <button type="button" className="chip chip-btn" aria-pressed={!!props.on} onClick={props.onClick} data-testid={props.testId}>
      {content}
    </button>
  );
}

export function TagPicker(props: { keyType: string; value: bigint[]; onChange: (v: bigint[]) => void; disabled?: boolean; testId?: string }) {
  const tags = useTagsOf(props.keyType);
  const { can } = useSession();
  const [quick, setQuick] = useState(false);
  const has = (id: bigint) => props.value.some(x => x === id);
  const toggle = (id: bigint) => props.onChange(has(id) ? props.value.filter(x => x !== id) : [...props.value, id]);
  return (
    <div className="chips" data-testid={props.testId}>
      {tags.length === 0 && <span className="small muted">{t('noTags')}</span>}
      {tags.map(x => (
        <TagChip
          key={String(x.id)}
          title={x.title}
          tkey={x.key}
          color={x.color}
          on={has(x.id)}
          onClick={props.disabled ? undefined : () => toggle(x.id)}
          testId={props.testId ? `${props.testId}-${x.key}` : undefined}
        />
      ))}
      {can('admin') && !props.disabled && (
        <button type="button" className="chip chip-btn chip-add" onClick={() => setQuick(true)} aria-label={t('tgAdd')} title={t('tgAdd')} data-testid={props.testId ? `${props.testId}-plus` : undefined}>
          <Plus className="ic" />
        </button>
      )}
      {quick && <TagDialog keyType={props.keyType} onClose={() => setQuick(false)} onSaved={id => props.onChange([...props.value, id])} />}
    </div>
  );
}

export function TagList(props: { tags: { id: bigint; key: string; title: Tr[] }[] }) {
  const all = useRows('tag');
  if (!props.tags.length) return <span className="muted small">—</span>;
  return (
    <span className="chips">
      {props.tags.map(x => (
        <TagChip key={String(x.id)} title={x.title} tkey={x.key} color={all.find(a => a.id === x.id)?.color} />
      ))}
    </span>
  );
}

export const DURATIONS: [number, StrKey][] = [
  [60, 'rs1h'],
  [1440, 'rs1d'],
  [4320, 'rs3d'],
  [10080, 'rs7d'],
  [43200, 'rs30d'],
];

export type Dur = { minutes: number; endsAt: bigint };

export function DurationPicker(props: { value: Dur; onChange: (v: Dur) => void; testId?: string }) {
  const [custom, setCustom] = useState(props.value.endsAt > 0n);
  const [text, setText] = useState('');
  return (
    <div className="stack stack-sm" data-testid={props.testId}>
      <div className="chips">
        {DURATIONS.map(([m, k]) => (
          <button
            type="button"
            key={m}
            className="chip chip-btn"
            aria-pressed={!custom && props.value.minutes === m}
            onClick={() => {
              setCustom(false);
              props.onChange({ minutes: m, endsAt: 0n });
            }}
            data-testid={props.testId ? `${props.testId}-${m}` : undefined}
          >
            {t(k)}
          </button>
        ))}
        <button type="button" className="chip chip-btn" aria-pressed={custom} onClick={() => setCustom(true)} data-testid={props.testId ? `${props.testId}-date` : undefined}>
          {t('rsDate')}
        </button>
      </div>
      {custom && (
        <input
          type="datetime-local"
          className="input ltr"
          value={text}
          aria-label={t('rsDate')}
          onChange={e => {
            setText(e.target.value);
            const ms = new Date(e.target.value).getTime();
            props.onChange({ minutes: 0, endsAt: Number.isFinite(ms) ? BigInt(ms) * 1000n : 0n });
          }}
        />
      )}
    </div>
  );
}

export function microsFromInput(v: string): bigint {
  if (!v) return 0n;
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? BigInt(ms) * 1000n : 0n;
}

export function inputFromTs(ts: Ts | undefined | null): string {
  if (!ts) return '';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function kindLabelR(kind: string) {
  return kind === 'suspend' ? t('kindSuspend') : kind === 'mute' ? t('kindMute') : kind === 'warn' ? t('kindWarn') : kind;
}

export function rStatusBadge(status: string) {
  const cls = status === 'active' ? 'b-bad' : status === 'lifted' ? 'b-info' : '';
  const label = status === 'active' ? t('rstActive') : status === 'lifted' ? t('rstLifted') : status === 'expired' ? t('rstExpired') : status;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function KindBadge(props: { kind: string }) {
  const cls = props.kind === 'suspend' ? 'b-bad' : props.kind === 'mute' ? 'b-warn' : 'b-info';
  return <span className={`badge ${cls}`}>{kindLabelR(props.kind)}</span>;
}

export function RestrictDialog(props: { accountId: bigint; name: string; kind: 'suspend' | 'mute' | 'warn'; onClose: () => void; onDone?: () => void }) {
  const [dur, setDur] = useState<Dur>({ minutes: 1440, endsAt: 0n });
  const [reason, setReason] = useState<Tr[]>([]);
  const { def } = useLanguages();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const title = props.kind === 'suspend' ? t('rsTitleSuspend', { name: props.name }) : props.kind === 'mute' ? t('rsTitleMute', { name: props.name }) : t('rsTitleWarn', { name: props.name });
  return (
    <Dialog
      title={title}
      width={540}
      onClose={props.onClose}
      testId="rs-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="rs-form" className={`btn ${props.kind === 'warn' ? 'btn-primary' : 'btn-danger'}`} disabled={busy} data-testid="rs-save">
            {props.kind === 'suspend' ? t('pdSuspend') : props.kind === 'mute' ? t('pdMute') : t('pdWarn')}
          </button>
        </>
      }
    >
      <form
        id="rs-form"
        className="stack"
        onSubmit={async e => {
          e.preventDefault();
          if (trMissingDefault(reason, def)) {
            setErr(t('trRequired', { lang: def }));
            return;
          }
          setBusy(true);
          setErr(null);
          const r = await run(
            c => c.reducers.adminRestrict({ accountId: props.accountId, kind: props.kind, minutes: props.kind === 'warn' ? 0 : dur.minutes, endsAt: props.kind === 'warn' ? 0n : dur.endsAt, reason, note }),
            t('rsDone')
          );
          setBusy(false);
          if (r.ok) {
            props.onDone?.();
            props.onClose();
          } else setErr(errorText(r.err));
        }}
      >
        {props.kind !== 'warn' && (
          <Field label={t('rsDuration')} required>
            <DurationPicker value={dur} onChange={setDur} testId="rs-dur" />
          </Field>
        )}
        <Field label={t('rsReason')} hint={t('rsReasonHint')} required>
          <TrInputs value={reason} onChange={setReason} name="reason" required />
        </Field>
        <Field label={t('rsNote')} hint={t('rsNoteHint')}>
          <textarea className="textarea" name="note" value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        <ErrBox text={err} />
      </form>
    </Dialog>
  );
}

export function LiftDialog(props: { id: bigint; onClose: () => void; onDone?: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={t('rsLiftTitle')}
      width={440}
      onClose={props.onClose}
      testId="lift-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            data-testid="lift-save"
            onClick={async () => {
              setBusy(true);
              const r = await run(c => c.reducers.adminLiftRestriction({ id: props.id, note }), t('rsLifted'));
              setBusy(false);
              if (r.ok) {
                props.onDone?.();
                props.onClose();
              } else setErr(errorText(r.err));
            }}
          >
            {t('pdLift')}
          </button>
        </>
      }
    >
      <Field label={t('rsLiftNote')} hint={t('optional')}>
        <textarea className="textarea" name="liftNote" value={note} onChange={e => setNote(e.target.value)} />
      </Field>
      <ErrBox text={err} />
    </Dialog>
  );
}

export function methodLabel(m: string) {
  const map: Record<string, StrKey> = { zarinpal: 'mZarinpal', zibal: 'mZibal', bazaar: 'mBazaar', myket: 'mMyket', in_app: 'mInApp' };
  return map[m] ? t(map[m]) : m;
}

export const METHODS = ['zarinpal', 'zibal', 'bazaar', 'myket', 'in_app'] as const;

export function payStatusBadge(status: string) {
  const cls = status === 'success' ? 'b-ok' : status === 'failed' ? 'b-bad' : status === 'pending' ? 'b-warn' : '';
  const label = status === 'success' ? t('pySuccess') : status === 'failed' ? t('pyFailed') : status === 'pending' ? t('pyPending') : status;
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function toman(n: bigint | number) {
  return t('amountToman', { n: num(n) });
}

export function bigFrom(s: string): bigint {
  const v = latin(s).replace(/[^0-9-]/g, '');
  try {
    return v && v !== '-' ? BigInt(v) : 0n;
  } catch {
    return 0n;
  }
}

export function BigInput(props: { value: bigint; onChange: (v: bigint) => void; name?: string; disabled?: boolean; min0?: boolean }) {
  const [text, setText] = useState(digits(props.value.toString()));
  return (
    <input
      className="input ltr"
      style={{ textAlign: 'start' }}
      inputMode="numeric"
      name={props.name}
      disabled={props.disabled}
      value={text}
      onChange={e => {
        setText(e.target.value);
        props.onChange(bigFrom(e.target.value));
      }}
      onBlur={() => setText(digits(props.value.toString()))}
    />
  );
}

export function FloatInput(props: { value: number; onChange: (v: number) => void; name?: string; disabled?: boolean }) {
  const [text, setText] = useState(digits(String(props.value)));
  return (
    <input
      className="input ltr"
      style={{ textAlign: 'start' }}
      inputMode="decimal"
      name={props.name}
      disabled={props.disabled}
      value={text}
      onChange={e => {
        setText(e.target.value);
        const n = Number(latin(e.target.value).replace('٫', '.'));
        if (Number.isFinite(n)) props.onChange(n);
      }}
      onBlur={() => setText(digits(String(props.value)))}
    />
  );
}

export function Section(props: { title: ReactNode; action?: ReactNode; children: ReactNode; testId?: string; pad?: boolean }) {
  return (
    <section className="card" data-testid={props.testId}>
      <div className="card-head">
        <span className="card-title grow">{props.title}</span>
        {props.action}
      </div>
      <div className={props.pad === false ? '' : 'card-pad'}>{props.children}</div>
    </section>
  );
}

export function fmtNum(v: number) {
  return digits(Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000));
}

export { when as tsWhen };
