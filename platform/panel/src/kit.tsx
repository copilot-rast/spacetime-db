import { useState, type ReactNode } from 'react';
import { PencilSimple, Plus, X } from '@phosphor-icons/react';
import { useRows } from './conn.ts';
import { digits, latin, t, type StrKey } from './i18n.ts';
import { trText, useLanguages, useSession, type Tr } from './app.ts';
import { Empty, Field, Seg, TableSkeleton } from './ui.tsx';
import { inputFromTs, microsFromInput } from './widgets.tsx';
import { RowActions } from './economy.tsx';

type Named = { key: string; name: Tr[] };

function NamedSelect(props: { list: { value: string; label: string }[]; value: string; onChange: (v: string) => void; none?: string; testId?: string; label?: string; name?: string; disabled?: boolean }) {
  return (
    <select className="select" value={props.value} onChange={e => props.onChange(e.target.value)} data-testid={props.testId} aria-label={props.label} name={props.name} disabled={props.disabled}>
      {props.none !== undefined && <option value="">{props.none}</option>}
      {!props.list.some(o => o.value === props.value) && props.value && props.none === undefined && <option value={props.value}>{props.value}</option>}
      {props.list.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function useNamed<T extends Named>(list: T[]) {
  const { def } = useLanguages();
  return list.map(x => ({ value: x.key, label: trText(x.name, def) || x.key }));
}

function useNamedId<T extends { id: bigint; key: string; name: Tr[] }>(list: T[]) {
  const { def } = useLanguages();
  return list.map(x => ({ value: String(x.id), label: trText(x.name, def) || x.key }));
}

export function KeyPick(props: { kind: 'event' | 'meta' | 'currency' | 'item' | 'itemType'; value: string; onChange: (v: string) => void; none?: string; testId?: string; label?: string; name?: string; clientOnly?: boolean }) {
  const events = useRows('eventType');
  const metas = useRows('meta');
  const currencies = useRows('currency');
  const items = useRows('item');
  const types = useRows('itemType');
  const list = props.kind === 'event' ? events : props.kind === 'meta' ? metas : props.kind === 'currency' ? currencies : props.kind === 'item' ? items : types;
  const opts = useNamed(list as Named[]).map(o => ({ ...o, label: o.label === o.value ? o.value : `${o.label} (${o.value})` }));
  return <NamedSelect list={opts} value={props.value} onChange={props.onChange} none={props.none} testId={props.testId} label={props.label} name={props.name} />;
}

export function IdPick(props: {
  kind: 'prize' | 'prizeGroup' | 'levelTable' | 'task' | 'group' | 'achievement' | 'sponsor' | 'placement' | 'tag' | 'offer';
  value: bigint;
  onChange: (v: bigint) => void;
  none?: string;
  testId?: string;
  label?: string;
  exclude?: bigint;
  filter?: (id: bigint) => boolean;
}) {
  const prizes = useRows('prize');
  const groups = useRows('prizeGroup');
  const tables = useRows('adminLevelTables');
  const tasks = useRows('adminTasks');
  const taskGroups = useRows('adminTaskGroups');
  const achievements = useRows('adminAchievements');
  const sponsors = useRows('adminSponsors');
  const placements = useRows('placement');
  const offers = useRows('adminOffers');
  const tags = useRows('tag').filter(x => x.keyType === 'user');
  const { def } = useLanguages();
  const base =
    props.kind === 'tag'
      ? tags.map(x => ({ id: x.id, key: x.key, name: x.title }))
      : (props.kind === 'prize'
          ? prizes
          : props.kind === 'prizeGroup'
            ? groups
            : props.kind === 'levelTable'
              ? tables
              : props.kind === 'task'
                ? tasks
                : props.kind === 'group'
                  ? taskGroups
                  : props.kind === 'achievement'
                    ? achievements
                    : props.kind === 'sponsor'
                      ? sponsors
                      : props.kind === 'offer'
                        ? offers
                        : placements) as { id: bigint; key: string; name: Tr[] }[];
  const list = base.filter(x => x.id !== props.exclude && (!props.filter || props.filter(x.id)));
  return (
    <select className="select" value={String(props.value)} onChange={e => props.onChange(BigInt(e.target.value))} data-testid={props.testId} aria-label={props.label}>
      <option value="0">{props.none ?? '—'}</option>
      {list.map(x => (
        <option key={String(x.id)} value={String(x.id)}>
          {trText(x.name, def) || x.key}
        </option>
      ))}
    </select>
  );
}

export function GrantMode(props: { value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <select className="select" value={props.value} onChange={e => props.onChange(e.target.value)} aria-label={t('gmMode')} data-testid={props.testId}>
      <option value="auto">{t('gmAuto')}</option>
      <option value="claim">{t('gmClaim')}</option>
    </select>
  );
}

export function Choice<T extends string>(props: { value: T; onChange: (v: T) => void; options: [T, StrKey][]; name?: string; testId?: string; label?: string }) {
  return (
    <select className="select" value={props.value} onChange={e => props.onChange(e.target.value as T)} name={props.name} data-testid={props.testId} aria-label={props.label}>
      {props.options.map(([v, k]) => (
        <option key={v} value={v}>
          {t(k)}
        </option>
      ))}
    </select>
  );
}

export function SegChoice<T extends string>(props: { value: T; onChange: (v: T) => void; options: [T, StrKey][] }) {
  return <Seg value={props.value} onChange={props.onChange} options={props.options.map(([v, k]) => ({ value: v, label: t(k) }))} />;
}

export function microsToInput(v: bigint) {
  if (!v) return '';
  return inputFromTs({ toDate: () => new Date(Number(v / 1000n)), microsSinceUnixEpoch: v });
}

export function WindowFields(props: { startsAt: bigint; endsAt: bigint; onChange: (startsAt: bigint, endsAt: bigint) => void }) {
  const [a, setA] = useState(microsToInput(props.startsAt));
  const [b, setB] = useState(microsToInput(props.endsAt));
  return (
    <>
      <Field label={t('winStart')} hint={t('optional')}>
        <input
          type="datetime-local"
          className="input ltr"
          name="startsAt"
          value={a}
          onChange={e => {
            setA(e.target.value);
            props.onChange(microsFromInput(e.target.value), microsFromInput(b));
          }}
        />
      </Field>
      <Field label={t('winEnd')} hint={t('optional')}>
        <input
          type="datetime-local"
          className="input ltr"
          name="endsAt"
          value={b}
          onChange={e => {
            setB(e.target.value);
            props.onChange(microsFromInput(a), microsFromInput(e.target.value));
          }}
        />
      </Field>
    </>
  );
}

export function OptNum(props: { value: number | undefined; onChange: (v: number | undefined) => void; name: string; placeholder?: string }) {
  const [text, setText] = useState(props.value === undefined ? '' : digits(String(props.value)));
  return (
    <input
      className="input ltr"
      inputMode="decimal"
      name={props.name}
      value={text}
      placeholder={props.placeholder ?? '—'}
      onChange={e => {
        setText(e.target.value);
        const raw = latin(e.target.value).trim();
        const n = Number(raw);
        props.onChange(raw === '' || !Number.isFinite(n) ? undefined : n);
      }}
    />
  );
}

export type Col<T> = { label: string; width: string; render: (row: T, set: (patch: Partial<T>) => void, i: number) => ReactNode };

export function Rows<T>(props: { rows: T[]; onChange: (v: T[]) => void; cols: Col<T>[]; make: () => T; max?: number; testId: string; addLabel: string; footer?: ReactNode }) {
  const grid = { display: 'grid', gridTemplateColumns: `${props.cols.map(c => c.width).join(' ')} 32px`, gap: 8, alignItems: 'center' } as const;
  return (
    <div className="stack stack-sm" data-testid={props.testId}>
      {props.rows.length > 0 && (
        <div className="small muted rows-head" style={grid}>
          {props.cols.map((c, i) => (
            <span key={i}>{c.label}</span>
          ))}
          <span />
        </div>
      )}
      {props.rows.map((r, i) => (
        <div className="rows-row" style={grid} key={i} data-testid={`${props.testId}-${i}`}>
          {props.cols.map((c, j) => (
            <div key={j} style={{ minWidth: 0 }}>
              {c.render(r, patch => props.onChange(props.rows.map((x, k) => (k === i ? { ...x, ...patch } : x))), i)}
            </div>
          ))}
          <button type="button" className="btn btn-icon btn-danger-ghost" aria-label={t('delete')} onClick={() => props.onChange(props.rows.filter((_, k) => k !== i))} data-testid={`${props.testId}-${i}-del`}>
            <X className="ic" />
          </button>
        </div>
      ))}
      <div className="row">
        {(!props.max || props.rows.length < props.max) && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onChange([...props.rows, props.make()])} data-testid={`${props.testId}-add`}>
            <Plus className="ic" />
            {props.addLabel}
          </button>
        )}
        <span className="grow" />
        {props.footer}
      </div>
    </div>
  );
}

export type TCol<T> = { label: string; render: (row: T) => ReactNode; className?: string };

export function CatalogTable<T>(props: {
  rows: T[];
  cols: TCol<T>[];
  keyOf: (row: T) => string;
  prefix: string;
  loaded: boolean;
  empty: { icon: ReactNode; title: string };
  onEdit?: (row: T) => void;
  onDelete?: (row: T) => void;
  extra?: (row: T, card: boolean) => ReactNode;
  cardTitle?: (row: T) => ReactNode;
  locked?: (row: T) => boolean;
}) {
  const { can } = useSession();
  const actions = (r: T, card = false) => (
    <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
      {props.extra?.(r, card)}
      {can('admin') && props.onEdit && props.onDelete && props.locked?.(r) && (
        <button type="button" className="btn btn-sm btn-icon" onClick={() => props.onEdit!(r)} aria-label={t('edit')} title={t('edit')} data-testid={`${card ? `${props.prefix}c` : props.prefix}-edit-${props.keyOf(r)}`}>
          <PencilSimple className="ic" />
        </button>
      )}
      {can('admin') && props.onEdit && props.onDelete && !props.locked?.(r) && (
        <RowActions prefix={card ? `${props.prefix}c` : props.prefix} k={props.keyOf(r)} onEdit={() => props.onEdit!(r)} onDelete={() => props.onDelete!(r)} />
      )}
    </span>
  );
  return (
    <div className="table-wrap responsive">
      <table className="table" data-testid={`${props.prefix}-table`}>
        <thead>
          <tr>
            {props.cols.map((c, i) => (
              <th key={i}>{c.label}</th>
            ))}
            <th className="end" aria-label={t('actions')} />
          </tr>
        </thead>
        <tbody>
          {!props.loaded ? (
            <TableSkeleton cols={props.cols.length + 1} rows={3} />
          ) : props.rows.length === 0 ? (
            <tr>
              <td colSpan={props.cols.length + 1}>
                <Empty icon={props.empty.icon} title={props.empty.title} />
              </td>
            </tr>
          ) : (
            props.rows.map(r => (
              <tr key={props.keyOf(r)} data-testid={`${props.prefix}-row-${props.keyOf(r)}`}>
                {props.cols.map((c, i) => (
                  <td key={i} className={c.className}>
                    {c.render(r)}
                  </td>
                ))}
                <td className="end">{actions(r)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="cards">
        {props.loaded && props.rows.length === 0 && <Empty icon={props.empty.icon} title={props.empty.title} />}
        {props.rows.map(r => (
          <div className="pcard" key={props.keyOf(r)}>
            <div className="row">
              <span className="grow">{props.cardTitle ? props.cardTitle(r) : props.cols[0].render(r)}</span>
            </div>
            <div className="pcard-meta">
              {props.cols.slice(1, 4).map((c, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  <span>{c.label}</span>
                  <span>{c.render(r)}</span>
                </span>
              ))}
            </div>
            {actions(r, true)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function idList<T extends { id: bigint }>(rows: T[]) {
  return new Map(rows.map(r => [r.id, r]));
}

export function useLoaded() {
  return useRows('language').length > 0;
}

export function usePrizeName() {
  const prizes = useRows('prize');
  const { def } = useLanguages();
  return (id: bigint) => {
    if (!id) return '—';
    const p = prizes.find(x => x.id === id);
    return p ? trText(p.name, def) || p.key : `#${digits(String(id))}`;
  };
}

export function useEventName() {
  const events = useRows('eventType');
  const { def } = useLanguages();
  return (key: string) => {
    const e = events.find(x => x.key === key);
    return e ? trText(e.name, def) || key : key;
  };
}

export function useMetaName() {
  const metas = useRows('meta');
  const { def } = useLanguages();
  return (key: string) => {
    const e = metas.find(x => x.key === key);
    return e ? trText(e.name, def) || key : key;
  };
}

export function Mono(props: { children: ReactNode }) {
  return <span className="mono">{props.children}</span>;
}
