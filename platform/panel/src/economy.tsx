import { useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowsClockwise,
  ChartBar,
  CurrencyCircleDollar,
  Gift,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Receipt,
  SlidersHorizontal,
  Stack,
  Storefront,
  Ticket,
  Trash,
  Warning,
  X,
} from '@phosphor-icons/react';
import { getConn, useRows } from './conn.ts';
import { codeText, date, digits, errorText, num, parseError, phone as fmtPhone, t, useLocale, type ErrInfo } from './i18n.ts';
import { go, pageQuery, run, runToast, toast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, OkBox, Pager, Seg, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk, trMissingDefault } from './ui.tsx';
import { CategoryPicker } from './dialogs.tsx';
import { BigInput, FloatInput, METHODS, Section, TagPicker, fmtNum, inputFromTs, methodLabel, microsFromInput, payStatusBadge, toman, when } from './widgets.tsx';

const PAGE = 20;

function useCatName() {
  const cats = useRows('category');
  const { def } = useLanguages();
  return (id: bigint) => {
    if (!id) return '—';
    const c = cats.find(x => x.id === id);
    return c ? trText(c.title, def) || c.key : '—';
  };
}

function FormDialog(props: {
  title: string;
  testId: string;
  width?: number;
  onClose: () => void;
  submit: () => Promise<{ ok: true } | { ok: false; err: ErrInfo } | { ok: false; msg: string }>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = `${props.testId}-form`;
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await props.submit();
    setBusy(false);
    if (r.ok) props.onClose();
    else setErr('msg' in r ? r.msg : errorText(r.err));
  }
  return (
    <Dialog
      title={props.title}
      width={props.width ?? 560}
      onClose={props.onClose}
      testId={props.testId}
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={id} className="btn btn-primary" disabled={busy} data-testid="dialog-save">
            {t('save')}
          </button>
        </>
      }
    >
      <form id={id} className="form-grid" onSubmit={onSubmit}>
        {props.children}
        <div className="span-2">
          <ErrBox text={err} />
        </div>
      </form>
    </Dialog>
  );
}

async function save(fn: () => Promise<unknown>) {
  const r = await run(() => fn(), t('saved'));
  return r.ok ? ({ ok: true } as const) : ({ ok: false, err: r.err } as const);
}

function needTitle(name: Tr[], def: string) {
  return trMissingDefault(name, def) ? ({ ok: false, msg: t('trRequired', { lang: def }) } as const) : null;
}

function PageHead(props: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <div className="page-title">{props.title}</div>
        {props.sub !== undefined && <div className="page-sub">{props.sub}</div>}
      </div>
      {props.action}
    </div>
  );
}

function AddButton(props: { label: string; onClick: () => void; testId: string }) {
  const { can } = useSession();
  if (!can('admin')) return null;
  return (
    <button type="button" className="btn btn-primary" onClick={props.onClick} data-testid={props.testId}>
      <Plus className="ic" />
      {props.label}
    </button>
  );
}

function RowActions(props: { onEdit: () => void; onDelete: () => void; prefix: string; k: string }) {
  const { can } = useSession();
  if (!can('admin')) return null;
  return (
    <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
      <button type="button" className="btn btn-sm btn-icon" onClick={props.onEdit} aria-label={t('edit')} title={t('edit')} data-testid={`${props.prefix}-edit-${props.k}`}>
        <PencilSimple className="ic" />
      </button>
      <button type="button" className="btn btn-sm btn-icon btn-danger-ghost" onClick={props.onDelete} aria-label={t('delete')} title={t('delete')} data-testid={`${props.prefix}-del-${props.k}`}>
        <Trash className="ic" />
      </button>
    </span>
  );
}

function ActiveBadge(props: { on: boolean }) {
  return <span className={`badge ${props.on ? 'b-ok' : ''}`}>{props.on ? t('active') : t('inactive')}</span>;
}

function NameCell(props: { name: Tr[]; k: string }) {
  const { def } = useLanguages();
  return (
    <>
      <span className="primary">{trText(props.name, def) || props.k}</span>
      <div className="mono muted">{props.k}</div>
    </>
  );
}

async function del(text: string, fn: () => Promise<unknown>) {
  if (!(await confirmAsk(text, { danger: true, ok: t('delete') }))) return;
  await runToast(() => fn(), t('deleted'));
}

export function EconomyOverview() {
  useLocale();
  const { data, error } = useFetch(() => getConn().procedures.adminEconomySummary({}), []);
  const tiles = data
    ? [
        { k: 'revenue', label: t('ecRevenue30'), value: toman(data.revenueToman30), icon: <ChartBar className="ic" weight="duotone" />, tint: 'b-ok', to: 'payments?status=success' },
        { k: 'paymentsDay', label: t('ecPaymentsDay'), value: num(data.paymentsDay), icon: <Receipt className="ic" weight="duotone" />, tint: 'b-info', to: 'payments' },
        { k: 'pending', label: t('ecPending'), value: num(data.pending), icon: <ArrowsClockwise className="ic" weight="duotone" />, tint: 'b-warn', to: 'payments?status=pending' },
        { k: 'grantErrors', label: t('ecGrantErrors'), value: num(data.grantErrors), icon: <Warning className="ic" weight="duotone" />, tint: data.grantErrors ? 'b-bad' : '', to: 'payments?status=success' },
        { k: 'products', label: t('ecProducts'), value: t('ecProductsOf', { a: data.activeProducts, b: data.products }), icon: <Storefront className="ic" weight="duotone" />, tint: 'b-teal', to: 'products' },
        { k: 'gifts', label: t('ecGifts'), value: t('ecProductsOf', { a: data.activeGifts, b: data.gifts }), icon: <Ticket className="ic" weight="duotone" />, tint: 'b-violet', to: 'gifts' },
        { k: 'currencies', label: t('ecCurrencies'), value: num(data.currencies), icon: <CurrencyCircleDollar className="ic" weight="duotone" />, tint: 'b-warn', to: 'currencies' },
        { k: 'metas', label: t('ecMetas'), value: num(data.metas), icon: <SlidersHorizontal className="ic" weight="duotone" />, tint: '', to: 'metas' },
        { k: 'prizes', label: t('ecPrizes'), value: num(data.prizes), icon: <Gift className="ic" weight="duotone" />, tint: 'b-info', to: 'prizes' },
      ]
    : [];
  const days = data?.revenueDaily ?? [];
  const max = days.reduce((m, d) => (d.toman > m ? d.toman : m), 0n);
  const dayLabel = (s: string) => date(new Date(`${s}T12:00:00`), false);
  return (
    <main className="page" data-testid="page-economy">
      <PageHead title={t('ecTitle')} />
      <ErrBox text={error ? errorText(error) : null} />
      {data && (data.pending > 0 || data.grantErrors > 0) && (
        <div className="notice notice-warn" data-testid="eco-attention">
          <div className="notice-ic">
            <Warning className="ic" />
          </div>
          <div className="grow stack" style={{ gap: 2 }}>
            <b>{t('ecAttention')}</b>
            <span className="small sub">
              {t('ecPending')}: {num(data.pending)} · {t('ecGrantErrors')}: {num(data.grantErrors)}
            </span>
          </div>
          <button type="button" className="btn btn-outline" onClick={() => go('payments')}>
            {t('navPayments')}
          </button>
        </div>
      )}
      <div className="tiles">
        {!data
          ? Array.from({ length: 9 }).map((_, i) => (
              <div className="tile" key={i} style={{ cursor: 'default' }}>
                <Skel w={40} h={40} r={8} style={{ gridRow: '1 / span 2' }} />
                <Skel w="55%" h={10} />
                <Skel w="35%" h={18} style={{ marginTop: 6 }} />
              </div>
            ))
          : tiles.map(x => (
              <button type="button" key={x.k} className="tile" onClick={() => go(x.to)} data-testid={`eco-tile-${x.k}`}>
                <span className={`tile-ic badge ${x.tint}`} style={{ height: 40, padding: 0, justifyContent: 'center' }}>
                  {x.icon}
                </span>
                <span className="tile-label">{x.label}</span>
                <span className={`tile-value ${x.k === 'revenue' ? 'tile-value-text' : ''}`}>{x.value}</span>
              </button>
            ))}
      </div>
      <Section title={t('ecChart')} testId="eco-chart">
        {!data ? (
          <Skel h={160} r={6} />
        ) : max === 0n ? (
          <Empty icon={<ChartBar className="ic" weight="duotone" />} title={t('ecNoRevenue')} />
        ) : (
          <>
            <div className="chart" role="img" aria-label={t('ecChart')}>
              {days.map(d => {
                const h = Number((d.toman * 1000n) / max) / 10;
                return (
                  <span
                    key={d.day}
                    className={`bar ${d.toman === 0n ? 'zero' : ''}`}
                    style={{ height: `${Math.max(d.toman === 0n ? 1 : 3, h)}%` }}
                    title={t('ecChartDay', { d: dayLabel(d.day), n: num(d.toman), s: num(d.success) })}
                  />
                );
              })}
            </div>
            <div className="chart-axis">
              <span>{days[0] ? dayLabel(days[0].day) : ''}</span>
              <span>{days.length ? dayLabel(days[days.length - 1].day) : ''}</span>
            </div>
          </>
        )}
      </Section>
    </main>
  );
}

type CurrencyRow = ReturnType<typeof useRows<'currency'>>[number];

function CurrencyDialog(props: { row?: CurrencyRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [type, setType] = useState(r?.type ?? 'soft');
  const [defaultValue, setDefault] = useState<bigint>(r?.defaultValue ?? 0n);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  return (
    <FormDialog
      title={r ? t('cuEdit') : t('cuAdd')}
      testId="cu-dialog"
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() => getConn().reducers.adminSaveCurrency({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, type, defaultValue, iconUrl: iconUrl.trim(), categoryId, tagIds, sort, isActive }))
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('cuType')}>
        <select className="select" name="type" value={type} onChange={e => setType(e.target.value)}>
          <option value="soft">{t('cuSoft')}</option>
          <option value="hard">{t('cuHard')}</option>
        </select>
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('cuDefault')}>
        <BigInput value={defaultValue} onChange={setDefault} name="defaultValue" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} />
      </Field>
      <Field label={t('category')} className="span-2">
        <CategoryPicker keyType="currency" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} testId="cu-cat" />
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="currency" value={tagIds} onChange={setTags} testId="cu-tags" />
      </Field>
      <Field label={t('icon')} hint={t('brUrlHint')} className="span-2">
        <input className="input ltr" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function Currencies() {
  useLocale();
  const list = useRows('currency');
  const snapLoaded = useRows('language').length > 0;
  const cat = useCatName();
  const [edit, setEdit] = useState<CurrencyRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-currencies">
      <PageHead title={t('navCurrencies')} sub={num(rows.length)} action={<AddButton label={t('cuAdd')} onClick={() => setEdit('new')} testId="cu-add" />} />
      <div className="table-wrap">
        <div className="scroll-x">
          <table className="table" data-testid="cu-table">
            <thead>
              <tr>
                <th>{t('name')}</th>
                <th>{t('cuType')}</th>
                <th>{t('cuDefault')}</th>
                <th>{t('category')}</th>
                <th>{t('status')}</th>
                <th className="end" aria-label={t('actions')} />
              </tr>
            </thead>
            <tbody>
              {!snapLoaded ? (
                <TableSkeleton cols={6} rows={3} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <Empty icon={<CurrencyCircleDollar className="ic" weight="duotone" />} title={t('cuEmpty')} />
                  </td>
                </tr>
              ) : (
                rows.map(c => (
                  <tr key={String(c.id)} data-testid={`cu-row-${c.key}`}>
                    <td>
                      <NameCell name={c.name} k={c.key} />
                    </td>
                    <td>
                      <span className={`badge ${c.type === 'hard' ? 'b-violet' : 'b-teal'}`}>{c.type === 'hard' ? t('cuHard') : t('cuSoft')}</span>
                    </td>
                    <td>{num(c.defaultValue)}</td>
                    <td>{cat(c.categoryId)}</td>
                    <td>
                      <ActiveBadge on={c.isActive} />
                    </td>
                    <td className="end">
                      <RowActions prefix="cu" k={c.key} onEdit={() => setEdit(c)} onDelete={() => del(t('cuDeleteConfirm', { name: c.key }), () => getConn().reducers.adminDeleteCurrency({ id: c.id }))} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {edit && <CurrencyDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type MetaRow = ReturnType<typeof useRows<'meta'>>[number];

function MetaDialog(props: { row?: MetaRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [defaultValue, setDefault] = useState(r?.defaultValue ?? 0);
  const [serverOnly, setServerOnly] = useState(r?.serverOnly ?? false);
  return (
    <FormDialog
      title={r ? t('mtEdit') : t('mtAdd')}
      testId="mt-dialog"
      onClose={props.onClose}
      submit={async () => needTitle(name, def) ?? save(() => getConn().reducers.adminSaveMeta({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, defaultValue, serverOnly }))}
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('mtDefault')}>
        <FloatInput value={defaultValue} onChange={setDefault} name="defaultValue" />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <div className="span-2 stack stack-sm" style={{ gap: 0 }}>
        <SwitchRow checked={serverOnly} onChange={setServerOnly} label={t('mtServerOnly')} testId="mt-server" />
        <span className="hint">{t('mtServerOnlyHint')}</span>
      </div>
    </FormDialog>
  );
}

export function Metas() {
  useLocale();
  const list = useRows('meta');
  const loaded = useRows('language').length > 0;
  const [edit, setEdit] = useState<MetaRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-metas">
      <PageHead title={t('navMetas')} sub={num(rows.length)} action={<AddButton label={t('mtAdd')} onClick={() => setEdit('new')} testId="mt-add" />} />
      <div className="table-wrap">
        <table className="table" data-testid="mt-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('mtDefault')}</th>
              <th>{t('mtServerOnly')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <TableSkeleton cols={4} rows={3} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <Empty icon={<SlidersHorizontal className="ic" weight="duotone" />} title={t('mtEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(m => (
                <tr key={String(m.id)} data-testid={`mt-row-${m.key}`}>
                  <td>
                    <NameCell name={m.name} k={m.key} />
                  </td>
                  <td>{fmtNum(m.defaultValue)}</td>
                  <td>{m.serverOnly ? <span className="badge b-warn">{t('mtServerOnly')}</span> : '—'}</td>
                  <td className="end">
                    <RowActions prefix="mt" k={m.key} onEdit={() => setEdit(m)} onDelete={() => del(t('mtDeleteConfirm', { name: m.key }), () => getConn().reducers.adminDeleteMeta({ id: m.id }))} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {edit && <MetaDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type Item = { type: string; key: string; action: string; value: number };

const ACTIONS: Record<string, string[]> = { currency: ['add'], meta: ['add', 'set'], prize_group: ['give'] };

function actionLabelI(a: string) {
  return a === 'add' ? t('acAdd') : a === 'set' ? t('acSet') : a === 'give' ? t('acGive') : a;
}

function typeLabelI(x: string) {
  return x === 'currency' ? t('itCurrency') : x === 'meta' ? t('itMeta') : x === 'prize_group' ? t('itPrizeGroup') : x;
}

function ItemsEditor(props: { value: Item[]; onChange: (v: Item[]) => void }) {
  const currencies = useRows('currency');
  const metas = useRows('meta');
  const groups = useRows('prizeGroup');
  const { def } = useLanguages();
  const keys = (type: string) =>
    type === 'currency'
      ? currencies.map(c => ({ key: c.key, name: trText(c.name, def) }))
      : type === 'meta'
        ? metas.map(c => ({ key: c.key, name: trText(c.name, def) }))
        : groups.map(c => ({ key: c.key, name: trText(c.name, def) }));
  const up = (i: number, p: Partial<Item>) => props.onChange(props.value.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="stack stack-sm" data-testid="items">
      {props.value.length > 0 && (
        <div className="item-row small muted">
          <span>{t('pzItemType')}</span>
          <span>{t('pzItemKey')}</span>
          <span>{t('pzItemAction')}</span>
          <span>{t('pzItemValue')}</span>
          <span />
        </div>
      )}
      {props.value.map((it, i) => (
        <div className="item-row" key={i} data-testid={`item-${i}`}>
          <select className="select" value={it.type} aria-label={t('pzItemType')} onChange={e => up(i, { type: e.target.value, key: '', action: ACTIONS[e.target.value][0], value: e.target.value === 'prize_group' ? 1 : it.value })}>
            {Object.keys(ACTIONS).map(x => (
              <option key={x} value={x}>
                {typeLabelI(x)}
              </option>
            ))}
          </select>
          <select className="select" value={it.key} aria-label={t('pzItemKey')} onChange={e => up(i, { key: e.target.value })} data-testid={`item-${i}-key`}>
            <option value="">—</option>
            {keys(it.type).map(k => (
              <option key={k.key} value={k.key}>
                {k.name || k.key}
              </option>
            ))}
          </select>
          <select className="select" value={it.action} aria-label={t('pzItemAction')} onChange={e => up(i, { action: e.target.value })}>
            {ACTIONS[it.type].map(a => (
              <option key={a} value={a}>
                {actionLabelI(a)}
              </option>
            ))}
          </select>
          <FloatInput value={it.value} onChange={v => up(i, { value: v })} name={`item-${i}-value`} />
          <button type="button" className="btn btn-icon btn-danger-ghost" aria-label={t('pzRemoveItem')} onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}>
            <X className="ic" />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onChange([...props.value, { type: 'currency', key: '', action: 'add', value: 1 }])} data-testid="item-add">
          <Plus className="ic" />
          {t('pzAddItem')}
        </button>
      </div>
    </div>
  );
}

type PrizeRow = ReturnType<typeof useRows<'prize'>>[number];

function PrizeDialog(props: { row?: PrizeRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [message, setMessage] = useState<Tr[]>(r?.message ?? []);
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [isRepeatable, setRep] = useState(r?.isRepeatable ?? true);
  const [items, setItems] = useState<Item[]>(r?.items.map(x => ({ ...x })) ?? [{ type: 'currency', key: '', action: 'add', value: 1 }]);
  return (
    <FormDialog
      title={r ? t('pzEdit') : t('pzAdd')}
      testId="pz-dialog"
      width={680}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() => getConn().reducers.adminSavePrize({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, message, categoryId, tagIds, isRepeatable, items }))
      }
    >
      <Field label={t('key')} hint={t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus={!r} />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isRepeatable} onChange={setRep} label={isRepeatable ? t('pzRepeatable') : t('pzOnce')} testId="pz-rep" />
      </div>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('pzItems')} required className="span-2">
        <ItemsEditor value={items} onChange={setItems} />
      </Field>
      <Field label={t('pzMessage')} className="span-2" hint={t('optional')}>
        <TrInputs value={message} onChange={setMessage} name="message" />
      </Field>
      <Field label={t('category')}>
        <CategoryPicker keyType="prize" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <Field label={t('tags')}>
        <TagPicker keyType="prize" value={tagIds} onChange={setTags} />
      </Field>
    </FormDialog>
  );
}

function itemsText(items: Item[], names: (type: string, key: string) => string) {
  return items.map(i => `${names(i.type, i.key)} ${i.action === 'set' ? '=' : i.action === 'give' ? '×' : i.value < 0 ? '' : '+'}${fmtNum(i.value)}`).join('، ');
}

function useItemNames() {
  const currencies = useRows('currency');
  const metas = useRows('meta');
  const groups = useRows('prizeGroup');
  const { def } = useLanguages();
  return (type: string, key: string) => {
    const list = type === 'currency' ? currencies : type === 'meta' ? metas : groups;
    const x = list.find(r => r.key === key);
    return x ? trText(x.name, def) || key : key;
  };
}

export function Prizes() {
  useLocale();
  const list = useRows('prize');
  const loaded = useRows('language').length > 0;
  const names = useItemNames();
  const [edit, setEdit] = useState<PrizeRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-prizes">
      <PageHead title={t('navPrizes')} sub={num(rows.length)} action={<AddButton label={t('pzAdd')} onClick={() => setEdit('new')} testId="pz-add" />} />
      <div className="table-wrap">
        <table className="table" data-testid="pz-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('pzItems')}</th>
              <th>{t('pzRepeatable')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <TableSkeleton cols={4} rows={3} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <Empty icon={<Gift className="ic" weight="duotone" />} title={t('pzEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(p => (
                <tr key={String(p.id)} data-testid={`pz-row-${p.key}`}>
                  <td>
                    <NameCell name={p.name} k={p.key} />
                  </td>
                  <td className="cell-detail" title={itemsText(p.items, names)}>
                    {itemsText(p.items, names)}
                  </td>
                  <td>{p.isRepeatable ? <span className="badge b-teal">{t('pzRepeatable')}</span> : <span className="badge">{t('pzOnce')}</span>}</td>
                  <td className="end">
                    <RowActions prefix="pz" k={p.key} onEdit={() => setEdit(p)} onDelete={() => del(t('pzDeleteConfirm', { name: p.key }), () => getConn().reducers.adminDeletePrize({ id: p.id }))} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {edit && <PrizeDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type GroupRow = ReturnType<typeof useRows<'prizeGroup'>>[number];

function GroupDialog(props: { row?: GroupRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const prizes = useRows('prize');
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [entries, setEntries] = useState<{ prizeId: bigint; weight: number }[]>(r?.entries.map(x => ({ ...x })) ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const total = entries.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0), 0);
  const up = (i: number, p: Partial<{ prizeId: bigint; weight: number }>) => setEntries(entries.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <FormDialog
      title={r ? t('pgEdit') : t('pgAdd')}
      testId="pg-dialog"
      width={620}
      onClose={props.onClose}
      submit={async () => needTitle(name, def) ?? save(() => getConn().reducers.adminSavePrizeGroup({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, entries, isActive }))}
    >
      <Field label={t('key')} hint={t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus={!r} />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('pgEntries')} required className="span-2">
        <div className="stack stack-sm" data-testid="pg-entries">
          {entries.length > 0 && (
            <div className="entry-row small muted">
              <span>{t('gfPrize')}</span>
              <span>{t('pgWeight')}</span>
              <span className="chance">{t('pgChance')}</span>
              <span />
            </div>
          )}
          {entries.map((e, i) => (
            <div className="entry-row" key={i}>
              <select className="select" value={String(e.prizeId)} aria-label={t('gfPrize')} onChange={x => up(i, { prizeId: BigInt(x.target.value) })} data-testid={`pg-entry-${i}-prize`}>
                <option value="0">—</option>
                {prizes.map(p => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {trText(p.name, def) || p.key}
                  </option>
                ))}
              </select>
              <NumInput value={e.weight} onChange={v => up(i, { weight: v })} name={`pg-entry-${i}-weight`} />
              <span className="chance small" data-testid={`pg-entry-${i}-chance`}>
                {total > 0 && e.weight > 0 ? `${digits((Math.round((e.weight / total) * 1000) / 10).toString())}٪` : '—'}
              </span>
              <button type="button" className="btn btn-icon btn-danger-ghost" aria-label={t('delete')} onClick={() => setEntries(entries.filter((_, j) => j !== i))}>
                <X className="ic" />
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEntries([...entries, { prizeId: 0n, weight: 1 }])} data-testid="pg-entry-add">
              <Plus className="ic" />
              {t('pgAddEntry')}
            </button>
          </div>
        </div>
      </Field>
    </FormDialog>
  );
}

export function PrizeGroups() {
  useLocale();
  const list = useRows('prizeGroup');
  const prizes = useRows('prize');
  const loaded = useRows('language').length > 0;
  const { def } = useLanguages();
  const [edit, setEdit] = useState<GroupRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.key.localeCompare(b.key));
  const summary = (g: GroupRow) => {
    const total = g.entries.reduce((s, e) => s + e.weight, 0);
    return g.entries
      .map(e => {
        const p = prizes.find(x => x.id === e.prizeId);
        return `${p ? trText(p.name, def) || p.key : '?'} ${digits((total ? Math.round((e.weight / total) * 1000) / 10 : 0).toString())}٪`;
      })
      .join('، ');
  };
  return (
    <main className="page" data-testid="page-prize-groups">
      <PageHead title={t('navPrizeGroups')} sub={num(rows.length)} action={<AddButton label={t('pgAdd')} onClick={() => setEdit('new')} testId="pg-add" />} />
      <div className="table-wrap">
        <table className="table" data-testid="pg-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('pgEntries')}</th>
              <th>{t('status')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <TableSkeleton cols={4} rows={3} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <Empty icon={<Stack className="ic" weight="duotone" />} title={t('pgEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(g => (
                <tr key={String(g.id)} data-testid={`pg-row-${g.key}`}>
                  <td>
                    <NameCell name={g.name} k={g.key} />
                  </td>
                  <td className="cell-detail" title={summary(g)}>
                    {summary(g)}
                  </td>
                  <td>
                    <ActiveBadge on={g.isActive} />
                  </td>
                  <td className="end">
                    <RowActions prefix="pg" k={g.key} onEdit={() => setEdit(g)} onDelete={() => del(t('pgDeleteConfirm', { name: g.key }), () => getConn().reducers.adminDeletePrizeGroup({ id: g.id }))} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {edit && <GroupDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type ProductRow = Awaited<ReturnType<ReturnType<typeof getConn>['procedures']['adminProducts']>>['rows'][number];

function ProductDialog(props: { row?: ProductRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const prizes = useRows('prize');
  const currencies = useRows('currency');
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [methods, setMethods] = useState<string[]>(r?.paymentMethods ?? ['zarinpal']);
  const [priceToman, setPrice] = useState<bigint>(r?.priceToman ?? 0n);
  const [coinCurrency, setCoinCur] = useState(r?.coinCurrency ?? '');
  const [coinAmount, setCoinAmount] = useState<bigint>(r?.coinAmount ?? 0n);
  const [discountPercent, setDiscount] = useState(r?.discountPercent ?? 0);
  const [skuBazaar, setSkuB] = useState(r?.skuBazaar ?? '');
  const [skuMyket, setSkuM] = useState(r?.skuMyket ?? '');
  const [prizeId, setPrize] = useState<bigint>(r?.prizeId ?? 0n);
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [coverUrl, setCover] = useState(r?.coverUrl ?? '');
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const has = (m: string) => methods.includes(m);
  const money = has('zarinpal') || has('zibal') || has('bazaar') || has('myket');
  const gateway = has('zarinpal') || has('zibal');
  return (
    <FormDialog
      title={r ? t('prEdit') : t('prAdd')}
      testId="pr-dialog"
      width={720}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        (has('in_app') && (!coinCurrency || coinAmount <= 0n) ? ({ ok: false, msg: codeText('COIN_PRICE_REQUIRED') } as const) : null) ??
        save(() =>
          getConn().reducers.adminSaveProduct({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name,
            description,
            isActive,
            categoryId,
            tagIds,
            audienceTagIds,
            priceToman: money ? priceToman : 0n,
            coinCurrency: has('in_app') ? coinCurrency : '',
            coinAmount: has('in_app') ? coinAmount : 0n,
            discountPercent: gateway ? discountPercent : 0,
            paymentMethods: methods,
            skuBazaar: has('bazaar') ? skuBazaar.trim() : '',
            skuMyket: has('myket') ? skuMyket.trim() : '',
            prizeId,
            iconUrl: iconUrl.trim(),
            coverUrl: coverUrl.trim(),
            sort,
          })
        )
      }
    >
      <Field label={t('key')} hint={t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus={!r} />
      </Field>
      <Field label={t('prPrize')} required>
        <select className="select" value={String(prizeId)} onChange={e => setPrize(BigInt(e.target.value))} data-testid="pr-prize">
          <option value="0">—</option>
          {prizes.map(p => (
            <option key={String(p.id)} value={String(p.id)}>
              {trText(p.name, def) || p.key}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('prMethods')} required className="span-2">
        <div className="chips" data-testid="pr-methods">
          {METHODS.map(m => (
            <button
              type="button"
              key={m}
              className="chip chip-btn"
              aria-pressed={has(m)}
              onClick={() => setMethods(has(m) ? methods.filter(x => x !== m) : [...methods, m])}
              data-testid={`pr-method-${m}`}
            >
              {methodLabel(m)}
            </button>
          ))}
        </div>
      </Field>
      {money && (
        <Field label={t('prPrice')} required={gateway}>
          <BigInput value={priceToman} onChange={setPrice} name="priceToman" />
        </Field>
      )}
      {gateway && (
        <Field label={t('prDiscount')}>
          <NumInput value={discountPercent} onChange={setDiscount} name="discountPercent" />
        </Field>
      )}
      {has('in_app') && (
        <>
          <Field label={t('prCoinCurrency')} required>
            <select className="select" name="coinCurrency" value={coinCurrency} onChange={e => setCoinCur(e.target.value)} data-testid="pr-coin">
              <option value="">—</option>
              {currencies.map(c => (
                <option key={c.key} value={c.key}>
                  {trText(c.name, def) || c.key}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('prCoinAmount')} required>
            <BigInput value={coinAmount} onChange={setCoinAmount} name="coinAmount" />
          </Field>
        </>
      )}
      {has('bazaar') && (
        <Field label={t('prSkuBazaar')} required>
          <input className="input ltr" name="skuBazaar" value={skuBazaar} onChange={e => setSkuB(e.target.value)} />
        </Field>
      )}
      {has('myket') && (
        <Field label={t('prSkuMyket')} required>
          <input className="input ltr" name="skuMyket" value={skuMyket} onChange={e => setSkuM(e.target.value)} />
        </Field>
      )}
      <Field label={t('prAudience')} hint={t('prAudienceHint')} className="span-2">
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} testId="pr-audience" />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" multiline />
      </Field>
      <Field label={t('category')}>
        <CategoryPicker keyType="product" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} />
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="product" value={tagIds} onChange={setTags} />
      </Field>
      <Field label={t('icon')} hint={t('brUrlHint')}>
        <input className="input ltr" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('prCover')} hint={t('brUrlHint')}>
        <input className="input ltr" value={coverUrl} onChange={e => setCover(e.target.value)} placeholder="https://" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

function priceText(p: ProductRow, cur: (k: string) => string) {
  const parts: string[] = [];
  if (p.paymentMethods.some(m => m !== 'in_app')) parts.push(toman(p.priceToman));
  if (p.paymentMethods.includes('in_app')) parts.push(`${num(p.coinAmount)} ${cur(p.coinCurrency)}`);
  return parts.join(' · ');
}

function useCurName() {
  const currencies = useRows('currency');
  const { def } = useLanguages();
  return (k: string) => trText(currencies.find(c => c.key === k)?.name, def) || k;
}

export function Products() {
  const route = useRoute();
  useLocale();
  const isActive = route.query.get('active') ?? '';
  const [query, setQuery] = useState('');
  const [categoryId, setCat] = useState<bigint>(0n);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<ProductRow | 'new' | null>(null);
  const q = useDebounced(query, 300);
  const prizes = useRows('prize');
  const cur = useCurName();
  const { def } = useLanguages();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminProducts({ query: q, categoryId, isActive, page, pageSize: PAGE }), [q, String(categoryId), isActive, page]);
  const rows = data?.rows ?? [];
  const prizeName = (id: bigint) => {
    const p = prizes.find(x => x.id === id);
    return p ? trText(p.name, def) || p.key : '—';
  };
  return (
    <main className="page" data-testid="page-products">
      <PageHead title={t('navProducts')} sub={data ? num(data.total) : <Skel w={40} h={10} />} action={<AddButton label={t('prAdd')} onClick={() => setEdit('new')} testId="pr-add" />} />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('prSearch')} aria-label={t('prSearch')} data-testid="pr-search" />
        </div>
        <div style={{ width: 220 }}>
          <CategoryPicker keyType="product" value={categoryId} onChange={v => { setCat(v); setPage(1); }} none={t('all')} label={t('category')} />
        </div>
        <Seg
          value={isActive}
          onChange={v => {
            setPage(1);
            pageQuery('products', { active: v });
          }}
          options={[
            { value: '', label: t('prAllActive') },
            { value: 'true', label: t('prOnlyActive') },
            { value: 'false', label: t('prOnlyInactive') },
          ]}
        />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="pr-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('prPriceCol')}</th>
              <th>{t('prMethods')}</th>
              <th>{t('prPrize')}</th>
              <th>{t('status')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<Storefront className="ic" weight="duotone" />} title={t('prEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(p => (
                <tr key={String(p.id)} data-testid={`pr-row-${p.key}`}>
                  <td>
                    <NameCell name={p.name} k={p.key} />
                  </td>
                  <td className="nowrap">
                    {priceText(p, cur)}
                    {p.discountPercent > 0 && <span className="badge b-warn" style={{ marginInlineStart: 6 }}>{digits(p.discountPercent)}٪</span>}
                  </td>
                  <td>
                    <span className="chips">
                      {p.paymentMethods.map(m => (
                        <span className="chip" key={m}>
                          {methodLabel(m)}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>{prizeName(p.prizeId)}</td>
                  <td>
                    <span className="chips">
                      <ActiveBadge on={p.isActive} />
                      {p.audienceTagIds.length > 0 && <span className="badge b-violet">{t('prExclusive')}</span>}
                    </span>
                  </td>
                  <td className="end">
                    <RowActions prefix="pr" k={p.key} onEdit={() => setEdit(p)} onDelete={() => del(t('prDeleteConfirm', { name: p.key }), () => getConn().reducers.adminDeleteProduct({ id: p.id }))} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(p => (
            <div className="pcard" key={String(p.id)}>
              <div className="row">
                <span className="grow">
                  <NameCell name={p.name} k={p.key} />
                </span>
                <ActiveBadge on={p.isActive} />
              </div>
              <div className="pcard-meta">
                <span>{t('prPriceCol')}</span>
                <span>{priceText(p, cur)}</span>
                <span>{t('prMethods')}</span>
                <span>{p.paymentMethods.map(methodLabel).join('، ')}</span>
              </div>
              <RowActions prefix="prc" k={p.key} onEdit={() => setEdit(p)} onDelete={() => del(t('prDeleteConfirm', { name: p.key }), () => getConn().reducers.adminDeleteProduct({ id: p.id }))} />
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {edit && <ProductDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type GiftRow = Awaited<ReturnType<ReturnType<typeof getConn>['procedures']['adminGifts']>>['rows'][number];

function GiftDialog(props: { row?: GiftRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const prizes = useRows('prize');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [type, setType] = useState<'reward' | 'discount'>((r?.type as 'reward' | 'discount') ?? 'reward');
  const [code, setCode] = useState(r?.code ?? '');
  const [prizeId, setPrize] = useState<bigint>(r?.prizeId ?? 0n);
  const [discountPercent, setDiscount] = useState(r?.discountPercent ?? 10);
  const [perUserLimit, setPerUser] = useState(r?.perUserLimit ?? 1);
  const [maxTotalUses, setMax] = useState(r?.maxTotalUses ?? 0);
  const [from, setFrom] = useState(inputFromTs(r?.validFrom ?? undefined));
  const [to, setTo] = useState(inputFromTs(r?.expireAt ?? undefined));
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  return (
    <FormDialog
      title={r ? t('gfEdit') : t('gfAdd')}
      testId="gf-dialog"
      width={620}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveGift({
            id: r?.id ?? 0n,
            name,
            type,
            code: code.trim().toUpperCase(),
            prizeId: type === 'reward' ? prizeId : 0n,
            discountPercent: type === 'discount' ? discountPercent : 0,
            perUserLimit,
            maxTotalUses,
            validFrom: microsFromInput(from),
            expireAt: microsFromInput(to),
            isActive,
            categoryId,
            tagIds,
          })
        )
      }
    >
      <div className="span-2">
        <Seg
          value={type}
          onChange={setType}
          options={[
            { value: 'reward', label: t('gfReward') },
            { value: 'discount', label: t('gfDiscount') },
          ]}
        />
      </div>
      <Field label={t('gfCode')} hint={t('gfCodeHint')} required>
        <input className="input ltr" name="code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} autoFocus={!r} style={{ textTransform: 'uppercase' }} />
      </Field>
      {type === 'reward' ? (
        <Field label={t('gfPrize')} required>
          <select className="select" value={String(prizeId)} onChange={e => setPrize(BigInt(e.target.value))} data-testid="gf-prize">
            <option value="0">—</option>
            {prizes.map(p => (
              <option key={String(p.id)} value={String(p.id)}>
                {trText(p.name, def) || p.key}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label={t('gfPercent')} required>
          <NumInput value={discountPercent} onChange={setDiscount} name="discountPercent" />
        </Field>
      )}
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('gfPerUser')}>
        <NumInput value={perUserLimit} onChange={setPerUser} name="perUserLimit" />
      </Field>
      <Field label={t('gfMaxTotal')} hint={t('gfMaxTotalHint')}>
        <NumInput value={maxTotalUses} onChange={setMax} name="maxTotalUses" />
      </Field>
      <Field label={t('gfFrom')} hint={t('optional')}>
        <input type="datetime-local" className="input ltr" value={from} onChange={e => setFrom(e.target.value)} name="validFrom" />
      </Field>
      <Field label={t('gfTo')} hint={t('optional')}>
        <input type="datetime-local" className="input ltr" value={to} onChange={e => setTo(e.target.value)} name="expireAt" />
      </Field>
      <Field label={t('category')}>
        <CategoryPicker keyType="gift" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="gift" value={tagIds} onChange={setTags} />
      </Field>
    </FormDialog>
  );
}

export function Gifts() {
  useLocale();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<GiftRow | 'new' | null>(null);
  const q = useDebounced(query, 300);
  const prizes = useRows('prize');
  const { def } = useLanguages();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminGifts({ query: q, type, page, pageSize: PAGE }), [q, type, page]);
  const rows = data?.rows ?? [];
  const what = (g: GiftRow) => {
    if (g.type === 'discount') return `${digits(g.discountPercent)}٪ ${t('gfDiscount')}`;
    const p = prizes.find(x => x.id === g.prizeId);
    return p ? trText(p.name, def) || p.key : '—';
  };
  const uses = (g: GiftRow) => (g.maxTotalUses ? t('gfUsed', { a: g.totalUsed, b: g.maxTotalUses }) : t('gfUsedNoCap', { a: g.totalUsed }));
  const windowText = (g: GiftRow) => (g.validFrom || g.expireAt ? `${g.validFrom ? when(g.validFrom, false) : '…'} – ${g.expireAt ? when(g.expireAt, false) : '…'}` : t('gfAlways'));
  return (
    <main className="page" data-testid="page-gifts">
      <PageHead title={t('navGifts')} sub={data ? num(data.total) : <Skel w={40} h={10} />} action={<AddButton label={t('gfAdd')} onClick={() => setEdit('new')} testId="gf-add" />} />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('gfSearch')} aria-label={t('gfSearch')} data-testid="gf-search" />
        </div>
        <Seg
          value={type}
          onChange={v => {
            setType(v);
            setPage(1);
          }}
          options={[
            { value: '', label: t('all') },
            { value: 'reward', label: t('gfReward') },
            { value: 'discount', label: t('gfDiscount') },
          ]}
        />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="gf-table">
          <thead>
            <tr>
              <th>{t('gfCode')}</th>
              <th>{t('gfType')}</th>
              <th>{t('gfPrize')}</th>
              <th>{t('gfUses')}</th>
              <th>{t('gfWindow')}</th>
              <th>{t('status')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Ticket className="ic" weight="duotone" />} title={t('gfEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(g => (
                <tr key={String(g.id)} data-testid={`gf-row-${g.code}`}>
                  <td>
                    <span className="primary mono" style={{ fontSize: 13 }}>
                      {g.code}
                    </span>
                    <div className="small muted">{trText(g.name, def)}</div>
                  </td>
                  <td>
                    <span className={`badge ${g.type === 'discount' ? 'b-warn' : 'b-info'}`}>{g.type === 'discount' ? t('gfDiscount') : t('gfReward')}</span>
                  </td>
                  <td>{what(g)}</td>
                  <td className="nowrap">{uses(g)}</td>
                  <td className="nowrap small">{windowText(g)}</td>
                  <td>
                    <ActiveBadge on={g.isActive} />
                  </td>
                  <td className="end">
                    <RowActions prefix="gf" k={g.code} onEdit={() => setEdit(g)} onDelete={() => del(t('gfDeleteConfirm', { name: g.code }), () => getConn().reducers.adminDeleteGift({ id: g.id }))} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(g => (
            <div className="pcard" key={String(g.id)}>
              <div className="row">
                <b className="grow mono">{g.code}</b>
                <ActiveBadge on={g.isActive} />
              </div>
              <div className="pcard-meta">
                <span>{t('gfPrize')}</span>
                <span>{what(g)}</span>
                <span>{t('gfUses')}</span>
                <span>{uses(g)}</span>
              </div>
              <RowActions prefix="gfc" k={g.code} onEdit={() => setEdit(g)} onDelete={() => del(t('gfDeleteConfirm', { name: g.code }), () => getConn().reducers.adminDeleteGift({ id: g.id }))} />
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {edit && <GiftDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

function payError(code: string) {
  return code ? errorText(parseError(code)) : '';
}

function amountText(p: { method: string; finalToman: bigint; coinAmount: bigint; coinCurrency: string }, cur?: (k: string) => string) {
  return p.method === 'in_app' ? `${num(p.coinAmount)} ${cur ? cur(p.coinCurrency) : p.coinCurrency}` : toman(p.finalToman);
}

export function Payments() {
  const route = useRoute();
  useLocale();
  const status = route.query.get('status') ?? '';
  const method = route.query.get('method') ?? '';
  const openId = route.query.get('id');
  const cur = useCurName();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(query, 300);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminPayments({ query: q, status, method, accountId: 0n, page, pageSize: PAGE }), [q, status, method, page]);
  const rows = data?.rows ?? [];
  const set = (p: Record<string, string>) => {
    setPage(1);
    pageQuery('payments', { status, method, ...p });
  };
  const open = (id: bigint) => pageQuery('payments', { status, method, id: String(id) });
  return (
    <main className="page" data-testid="page-payments">
      <PageHead title={t('pyTitle')} sub={data ? num(data.total) : <Skel w={40} h={10} />} />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('pySearch')} aria-label={t('pySearch')} data-testid="py-search" />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 150 }} value={status} onChange={e => set({ status: e.target.value })} aria-label={t('pyColStatus')} data-testid="py-status">
          <option value="">{t('pyAllStatus')}</option>
          <option value="pending">{t('pyPending')}</option>
          <option value="success">{t('pySuccess')}</option>
          <option value="failed">{t('pyFailed')}</option>
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 150 }} value={method} onChange={e => set({ method: e.target.value })} aria-label={t('pyColMethod')} data-testid="py-method">
          <option value="">{t('pyAllMethods')}</option>
          {METHODS.map(m => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="py-table">
          <thead>
            <tr>
              <th>{t('pyColId')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('pyColProduct')}</th>
              <th>{t('pyColMethod')}</th>
              <th>{t('pyColAmount')}</th>
              <th>{t('pyColStatus')}</th>
              <th>{t('pyColAt')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <Empty icon={<Receipt className="ic" weight="duotone" />} title={t('pyEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.payment.id)} data-testid={`py-row-${r.payment.id}`} style={{ cursor: 'pointer' }} onClick={() => open(r.payment.id)}>
                  <td className="primary">#{digits(String(r.payment.id))}</td>
                  <td className="nowrap">{fmtPhone(r.phone)}</td>
                  <td className="mono">{r.productKey}</td>
                  <td>
                    <span className="chips">
                      <span className="chip">{methodLabel(r.payment.method)}</span>
                      {r.payment.sandbox && <span className="badge b-warn">{t('pySandbox')}</span>}
                    </span>
                  </td>
                  <td className="nowrap">{amountText(r.payment, cur)}</td>
                  <td>
                    <span className="chips">
                      {payStatusBadge(r.payment.status)}
                      {r.payment.rewardError && <span className="badge b-bad">{t('pyRewardError')}</span>}
                    </span>
                  </td>
                  <td className="nowrap">{when(r.payment.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(r => (
            <button type="button" className="pcard" key={String(r.payment.id)} onClick={() => open(r.payment.id)} style={{ border: 0, background: 'transparent', textAlign: 'start', width: '100%', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
              <div className="row">
                <b className="grow">#{digits(String(r.payment.id))} · {r.productKey}</b>
                {payStatusBadge(r.payment.status)}
              </div>
              <div className="pcard-meta">
                <span>{t('pyColAmount')}</span>
                <span>{amountText(r.payment, cur)}</span>
                <span>{t('pyColPlayer')}</span>
                <span>{fmtPhone(r.phone)}</span>
              </div>
            </button>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
      {openId && <PaymentDialog id={BigInt(openId)} onClose={() => pageQuery('payments', { status, method })} />}
    </main>
  );
}

function rewardList(raw: string): Item[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(x => x && typeof x.type === 'string').map(x => ({ type: x.type, key: String(x.key), action: String(x.action), value: Number(x.value) })) : [];
  } catch {
    return [];
  }
}

function PaymentDialog(props: { id: bigint; onClose: () => void }) {
  const { can } = useSession();
  const names = useItemNames();
  const cur = useCurName();
  const { data, error } = useFetch(() => getConn().procedures.adminPayment({ id: props.id }), [String(props.id)]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = data?.row.payment;
  async function act(kind: 'inquire' | 'retry') {
    if (!p) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    const r = await run(c => (kind === 'inquire' ? c.procedures.adminInquirePayment({ id: p.id }) : c.procedures.adminRetryGrant({ id: p.id })));
    setBusy(false);
    if (r.ok) {
      const v = payError(String(r.value)) && /^[A-Z_]+$/.test(String(r.value)) ? payError(String(r.value)) : String(r.value);
      setMsg(kind === 'inquire' ? t('pyInquired', { r: v }) : t('pyRetried', { r: v }));
      toast('ok', t('done'));
    } else setErr(errorText(r.err));
  }
  return (
    <Dialog title={t('pyDetail', { id: digits(String(props.id)) })} width={760} onClose={props.onClose} testId="py-dialog">
      {error && <ErrBox text={errorText(error)} />}
      {!data || !p ? (
        <div className="stack">
          <Skel h={80} r={8} />
          <Skel h={120} r={8} />
        </div>
      ) : (
        <>
          <div className="row row-wrap">
            {payStatusBadge(p.status)}
            <span className="chip">{methodLabel(p.method)}</span>
            {p.sandbox && <span className="badge b-warn">{t('pySandbox')}</span>}
            <span className={`badge ${p.rewardGranted ? 'b-ok' : 'b-bad'}`} data-testid="py-reward">
              {p.rewardGranted ? t('pyRewardOk') : t('pyRewardNo')}
            </span>
            <span className="grow" />
            <span className="small muted">{when(p.createdAt)}</span>
          </div>
          <div className="review">
            <div className="review-item">
              <dl className="kv grow">
                <dt>{t('pyColPlayer')}</dt>
                <dd>
                  <a className="row-link" href={`#/player?id=${p.accountId}`}>
                    {fmtPhone(data.row.phone)}
                  </a>
                </dd>
                <dt>{t('pyColProduct')}</dt>
                <dd className="mono">{data.row.productKey}</dd>
                <dt>{t('pyFinal')}</dt>
                <dd data-testid="py-amount">{amountText(p, cur)}</dd>
                {p.method !== 'in_app' && p.originalToman !== p.finalToman && (
                  <>
                    <dt>{t('pyOriginal')}</dt>
                    <dd>{toman(p.originalToman)}</dd>
                  </>
                )}
                {p.discountPercent > 0 && (
                  <>
                    <dt>{t('pyGift')}</dt>
                    <dd>{digits(p.discountPercent)}٪</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="review-item">
              <dl className="kv grow">
                {p.refId && (
                  <>
                    <dt>{t('pyRef')}</dt>
                    <dd className="mono">{p.refId}</dd>
                  </>
                )}
                {p.cardMask && (
                  <>
                    <dt>{t('pyCard')}</dt>
                    <dd className="mono">{p.cardMask}</dd>
                  </>
                )}
                {p.authority && (
                  <>
                    <dt>{t('pyAuthority')}</dt>
                    <dd className="mono ellipsis">{p.authority}</dd>
                  </>
                )}
                <dt>{t('pyInquiries')}</dt>
                <dd>{num(p.inquiryCount)}</dd>
                {p.error && (
                  <>
                    <dt>{t('pyError')}</dt>
                    <dd className="neg">{payError(p.error)}</dd>
                  </>
                )}
                {p.rewardError && (
                  <>
                    <dt>{t('pyRewardError')}</dt>
                    <dd className="neg">{payError(p.rewardError)}</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
          {p.rewards && p.rewards !== '[]' && (
            <div className="stack stack-sm">
              <span className="section-label">{t('pyRewards')}</span>
              <span className="chips" data-testid="py-rewards">
                {rewardList(p.rewards).map((it, i) => (
                  <span className="chip" key={i}>
                    {itemsText([it], names)}
                  </span>
                ))}
              </span>
            </div>
          )}
          {can('admin') && (
            <div className="row row-wrap">
              {p.method !== 'in_app' && (
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act('inquire')} data-testid="py-inquire">
                  <ArrowsClockwise className="ic" />
                  {t('pyInquire')}
                </button>
              )}
              <button type="button" className="btn btn-outline" disabled={busy || (p.rewardGranted && !p.rewardError)} onClick={() => act('retry')} data-testid="py-retry">
                <Gift className="ic" />
                {t('pyRetry')}
              </button>
            </div>
          )}
          <OkBox text={msg} />
          <ErrBox text={err} />
          <div className="stack stack-sm">
            <span className="section-label">{t('pyLogs')}</span>
            {data.logs.length === 0 ? (
              <span className="small muted">{t('pyNoLogs')}</span>
            ) : (
              data.logs.map(l => (
                <details key={String(l.id)} className="note-item">
                  <summary className="row" style={{ cursor: 'pointer' }}>
                    <b className="mono">{l.action}</b>
                    <span className="badge">{digits(l.httpStatus)}</span>
                    <span className="grow" />
                    <span className="small muted">{when(l.at)}</span>
                  </summary>
                  <div className="stack stack-sm" style={{ marginTop: 8 }}>
                    <span className="small muted ltr ellipsis">{l.url}</span>
                    <span className="small">{t('pyRequest')}</span>
                    <pre className="pre">{l.request}</pre>
                    <span className="small">{t('pyResponse')}</span>
                    <pre className="pre">{l.response}</pre>
                  </div>
                </details>
              ))
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
