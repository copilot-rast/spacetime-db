import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowCounterClockwise, ChartBar, ChatCircleDots, Gauge, GearSix, Gift, MagnifyingGlass, Package, Plus, ShieldCheck, Trash, UsersThree, X } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { actionLabel, codeText, date, digits, errorText, latin, num, t, useLocale, type StrKey } from './i18n.ts';
import { openSettings, pageQuery, run, runToast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession } from './app.ts';
import { Dialog, Empty, ErrBox, Field, Notice, NumInput, Pager, SaveButton, Seg, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk } from './ui.tsx';
import { BigInput, Section, TagList, toman, when } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, PageHead, del, save } from './economy.tsx';
import { CatalogTable, Choice, IdPick, KeyPick, OptNum, Rows, useLoaded } from './kit.tsx';
import { minutesToTime } from './pubnotify.tsx';
import './socialgifts.css';

const PAGE = 20;
const DAY_MS = 86_400_000;

type QuotaRow = RowOf<'adminQuotaSettings'>;
type QuotaRuleRow = RowOf<'adminQuotaRules'>;
type GiftRow = RowOf<'adminGiftSettings'>;
type GiftRuleRow = RowOf<'adminGiftRules'>;
type ProductRow = Awaited<ReturnType<ReturnType<typeof getConn>['procedures']['adminProducts']>>['rows'][number];
type GiftCur = { currencyKey: string; min: bigint; max: bigint };

function timeToMinutes(v: string) {
  const [h, m] = latin(v).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? Math.min(h * 60 + m, 1439) : 0;
}

function offsetText(m: number) {
  const a = Math.abs(m);
  return digits(`UTC${m < 0 ? '−' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`);
}

const OFFSETS = Array.from({ length: (840 + 720) / 15 + 1 }, (_, i) => -720 + i * 15);

function dayText(day: number) {
  return date(new Date(day * DAY_MS + DAY_MS / 2), false);
}

function usText(v: bigint) {
  return v ? date(new Date(Number(v / 1000n))) : '—';
}

function quotaToday(s: { utcOffsetMinutes: number; resetMinute: number }) {
  return Math.floor((Date.now() + (s.utcOffsetMinutes - s.resetMinute) * 60_000) / DAY_MS);
}

function tehranToday() {
  return Math.floor((Date.now() + 210 * 60_000) / DAY_MS);
}

function fillDays<T extends { day: number }>(list: T[], today: number, days: number, empty: (day: number) => T) {
  const m = new Map(list.map(x => [x.day, x]));
  return Array.from({ length: days }, (_, i) => today - days + 1 + i).map(d => m.get(d) ?? empty(d));
}

let productCache: ProductRow[] | null = null;

async function allProducts() {
  const out: ProductRow[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await getConn().procedures.adminProducts({ query: '', categoryId: 0n, isActive: '', page, pageSize: 100 });
    out.push(...r.rows);
    if (!r.rows.length || out.length >= r.total) break;
  }
  productCache = out;
  return out;
}

function useProducts() {
  const r = useFetch(() => allProducts(), []);
  return r.data ?? productCache ?? [];
}

function useNames() {
  const items = useRows('item');
  const types = useRows('itemType');
  const currencies = useRows('currency');
  const metas = useRows('meta');
  const { def } = useLanguages();
  return {
    item: (k: string) => trText(items.find(x => x.key === k)?.name, def) || k,
    type: (k: string) => trText(types.find(x => x.key === k)?.name, def) || k,
    currency: (k: string) => trText(currencies.find(x => x.key === k)?.name, def) || k,
    meta: (k: string) => trText(metas.find(x => x.key === k)?.name, def) || k,
  };
}

function Who(props: { id: bigint; name?: string; testId?: string }) {
  const { can } = useSession();
  if (!props.id) return <span className="muted">{t('qoSystem')}</span>;
  const label = (
    <>
      <bdi>{props.name || t('qoNoName')}</bdi> <bdi className="muted">#{digits(String(props.id))}</bdi>
    </>
  );
  return can('operator') ? (
    <a className="row-link" href={`#/player?id=${props.id}`} data-testid={props.testId}>
      {label}
    </a>
  ) : (
    <span>{label}</span>
  );
}

function KeyList(props: { value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; disabled?: boolean; testId: string; empty: string }) {
  const left = props.options.filter(o => !props.value.includes(o.value));
  const label = (k: string) => props.options.find(o => o.value === k)?.label ?? k;
  return (
    <div className="stack stack-sm" data-testid={props.testId}>
      <div className="chips">
        {props.value.length === 0 && <span className="small muted">{props.empty}</span>}
        {props.value.map(k => (
          <span className="chip" key={k} data-testid={`${props.testId}-${k}`}>
            {label(k)}
            {!props.disabled && (
              <button type="button" className="sg-chip-x" onClick={() => props.onChange(props.value.filter(x => x !== k))} aria-label={t('delete')} title={t('delete')}>
                <X className="ic" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!props.disabled && left.length > 0 && (
        <select className="select" value="" onChange={e => e.target.value && props.onChange([...props.value, e.target.value])} aria-label={t('qoAddOne')} data-testid={`${props.testId}-add`}>
          <option value="">{t('qoAddOne')}</option>
          {left.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function FormSkel(props: { n: number }) {
  return (
    <div className="form-grid">
      {Array.from({ length: props.n }).map((_, i) => (
        <div className="field" key={i}>
          <Skel w={90} h={10} />
          <Skel h={36} r={6} />
        </div>
      ))}
    </div>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(fn: () => Promise<unknown>) {
    setBusy(true);
    const r = await run(() => fn(), t('saved'));
    setBusy(false);
    setErr(r.ok ? null : errorText(r.err));
  }
  return { busy, err, go };
}

function SaveBar(props: { busy: boolean; err: string | null; testId: string }) {
  return (
    <>
      <ErrBox text={props.err} />
      <div className="form-actions">
        <SaveButton busy={props.busy} testId={props.testId} />
      </div>
    </>
  );
}

function SwitchField(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string; testId?: string }) {
  return (
    <div className="span-2 stack" style={{ gap: 2 }}>
      <SwitchRow checked={props.checked} onChange={props.onChange} disabled={props.disabled} label={props.label} testId={props.testId} />
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  );
}

function quotaArgs(s: QuotaRow) {
  return {
    enabled: s.enabled,
    countMode: s.countMode,
    dailyMessages: s.dailyMessages,
    dailyConversations: s.dailyConversations,
    conversationScope: s.conversationScope,
    resetMinute: s.resetMinute,
    utcOffsetMinutes: s.utcOffsetMinutes,
    countDirect: s.countDirect,
    countGroups: s.countGroups,
    countRooms: s.countRooms,
    replyFree: s.replyFree,
    friendPolicy: s.friendPolicy,
    friendDailyMessages: s.friendDailyMessages,
    friendDailyConversations: s.friendDailyConversations,
    packMeta: s.packMeta,
    packExpiryDays: s.packExpiryDays,
    order: s.order,
    packProducts: [...s.packProducts],
    bonusMeta: s.bonusMeta,
    matchPolicy: s.matchPolicy,
    unlimitedItems: [...s.unlimitedItems],
    unlimitedMeta: s.unlimitedMeta,
    unlimitedMetaMode: s.unlimitedMetaMode,
    message: [...s.message],
    notice: s.notice,
  };
}

type QuotaArgs = ReturnType<typeof quotaArgs>;

export function QuotaSettingsSection(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const ro = !!props.ro;
  const s = useRows('adminQuotaSettings')[0];
  const items = useRows('item');
  const products = useProducts();
  const { def } = useLanguages();
  const [v, setV] = useState<QuotaArgs | null>(null);
  const f = useSaver();
  useEffect(() => {
    if (s && !v) setV(quotaArgs(s));
  }, [s, v]);
  if (!v) return <FormSkel n={10} />;
  const up = (p: Partial<QuotaArgs>) => setV({ ...v, ...p });
  const n = (k: 'dailyMessages' | 'dailyConversations' | 'friendDailyMessages' | 'friendDailyConversations' | 'packExpiryDays', label: StrKey, hint?: StrKey) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <NumInput value={v[k]} onChange={x => up({ [k]: x })} disabled={ro} name={k} />
    </Field>
  );
  const msgs = v.countMode !== 'conversations';
  const convs = v.countMode !== 'messages';
  return (
    <form
      className="stack stack-lg"
      data-testid="qs-form"
      onSubmit={e => {
        e.preventDefault();
        f.go(() => Promise.resolve().then(() => getConn().reducers.adminSaveQuotaSettings(v)));
      }}
    >
      <Section title={t('qoGeneral')}>
        <div className="form-grid">
          <SwitchField checked={v.enabled} onChange={x => up({ enabled: x })} disabled={ro} label={t('qoEnabled')} hint={t('qoEnabledHint')} testId="qs-enabled" />
          <Field label={t('qoCountMode')} hint={t(v.countMode === 'both' ? 'qoModeBothHint' : v.countMode === 'conversations' ? 'qoModeConvHint' : 'qoModeMsgHint')} className="span-2">
            <Seg
              value={v.countMode}
              onChange={x => !ro && up({ countMode: x })}
              label={t('qoCountMode')}
              options={[
                { value: 'messages', label: t('qoModeMsg') },
                { value: 'conversations', label: t('qoModeConv') },
                { value: 'both', label: t('qoModeBoth') },
              ]}
            />
          </Field>
          {msgs && n('dailyMessages', 'qoDailyMessages', 'qoDailyHint')}
          {convs && n('dailyConversations', 'qoDailyConversations', 'qoDailyHint')}
          {convs && (
            <Field label={t('qoScope')} hint={t('qoScopeHint')}>
              <Choice
                value={v.conversationScope}
                onChange={x => up({ conversationScope: x })}
                name="conversationScope"
                options={[
                  ['day', 'qoScopeDay'],
                  ['ever', 'qoScopeEver'],
                ]}
              />
            </Field>
          )}
        </div>
      </Section>
      <Section title={t('qoDay')}>
        <div className="form-grid">
          <Field label={t('qoReset')} hint={t('qoResetHint')}>
            <input type="time" className="input ltr" name="resetMinute" value={minutesToTime(v.resetMinute)} onChange={e => up({ resetMinute: timeToMinutes(e.target.value) })} disabled={ro} data-testid="qs-reset" />
          </Field>
          <Field label={t('qoZone')} hint={t('qoZoneHint')}>
            <select className="select" name="utcOffsetMinutes" value={String(v.utcOffsetMinutes)} onChange={e => up({ utcOffsetMinutes: Number(e.target.value) })} disabled={ro} data-testid="qs-zone">
              {OFFSETS.map(m => (
                <option key={m} value={String(m)}>
                  {offsetText(m)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>
      <Section title={t('qoCounts')}>
        <div className="form-grid">
          <div className="span-2 stack stack-sm">
            <SwitchRow checked={v.countDirect} onChange={x => up({ countDirect: x })} disabled={ro} label={t('qoCountDirect')} testId="qs-direct" />
            <SwitchRow checked={v.countGroups} onChange={x => up({ countGroups: x })} disabled={ro} label={t('qoCountGroups')} />
            <SwitchRow checked={v.countRooms} onChange={x => up({ countRooms: x })} disabled={ro} label={t('qoCountRooms')} />
          </div>
          <Field label={t('qoReplyFree')} hint={t(v.replyFree === 'started' ? 'qoReplyStartedHint' : v.replyFree === 'reply' ? 'qoReplyReplyHint' : 'qoReplyOffHint')}>
            <Choice
              value={v.replyFree}
              onChange={x => up({ replyFree: x })}
              name="replyFree"
              options={[
                ['off', 'qoReplyOff'],
                ['started', 'qoReplyStarted'],
                ['reply', 'qoReplyReply'],
              ]}
            />
          </Field>
          <Field label={t('qoFriendPolicy')} hint={t(v.friendPolicy === 'separate' ? 'qoFriendSeparateHint' : v.friendPolicy === 'free' ? 'qoFriendFreeHint' : 'qoFriendSameHint')}>
            <Choice
              value={v.friendPolicy}
              onChange={x => up({ friendPolicy: x })}
              name="friendPolicy"
              options={[
                ['same', 'qoFriendSame'],
                ['separate', 'qoFriendSeparate'],
                ['free', 'qoFriendFree'],
              ]}
            />
          </Field>
          {v.friendPolicy === 'separate' && msgs && n('friendDailyMessages', 'qoFriendMessages', 'qoDailyHint')}
          {v.friendPolicy === 'separate' && convs && n('friendDailyConversations', 'qoFriendConversations', 'qoDailyHint')}
        </div>
      </Section>
      <Section title={t('qoPacks')}>
        <div className="form-grid">
          <Field label={t('qoPackMeta')} hint={t('qoPackMetaHint')}>
            <KeyPick kind="meta" value={v.packMeta} onChange={x => up({ packMeta: x })} none={t('qoNone')} testId="qs-pack-meta" name="packMeta" />
          </Field>
          {v.packMeta ? n('packExpiryDays', 'qoPackExpiry', 'qoPackExpiryHint') : <span />}
          {v.packMeta && (
            <>
              <Field label={t('qoOrder')} hint={t('qoOrderHint')}>
                <Choice
                  value={v.order}
                  onChange={x => up({ order: x })}
                  name="order"
                  options={[
                    ['free_first', 'qoOrderFree'],
                    ['packs_first', 'qoOrderPacks'],
                  ]}
                />
              </Field>
              <span />
              <Field label={t('qoPackProducts')} hint={t('qoPackProductsHint')} className="span-2">
                <KeyList
                  value={v.packProducts}
                  onChange={x => up({ packProducts: x })}
                  disabled={ro}
                  testId="qs-products"
                  empty={t('qoProductsAuto')}
                  options={products.map(p => ({ value: p.key, label: trText(p.name, def) || p.key }))}
                />
              </Field>
            </>
          )}
        </div>
      </Section>
      <Section title={t('qoBonusTags')}>
        <div className="form-grid">
          <Field label={t('qoBonusMeta')} hint={t('qoBonusMetaHint')}>
            <KeyPick kind="meta" value={v.bonusMeta} onChange={x => up({ bonusMeta: x })} none={t('qoNone')} name="bonusMeta" />
          </Field>
          <Field label={t('qoMatch')} hint={t(v.matchPolicy === 'generous' ? 'qoMatchGenerousHint' : 'qoMatchPriorityHint')}>
            <Choice
              value={v.matchPolicy}
              onChange={x => up({ matchPolicy: x })}
              name="matchPolicy"
              options={[
                ['priority', 'qoMatchPriority'],
                ['generous', 'qoMatchGenerous'],
              ]}
            />
          </Field>
        </div>
      </Section>
      <Section title={t('qoUnlimited')}>
        <div className="form-grid">
          <Field label={t('qoUnlimitedItems')} hint={t('qoUnlimitedItemsHint')} className="span-2">
            <KeyList value={v.unlimitedItems} onChange={x => up({ unlimitedItems: x })} disabled={ro} testId="qs-items" empty={t('qoNone')} options={items.map(i => ({ value: i.key, label: trText(i.name, def) || i.key }))} />
          </Field>
          <Field label={t('qoUnlimitedMeta')} hint={t('qoUnlimitedMetaHint')}>
            <KeyPick kind="meta" value={v.unlimitedMeta} onChange={x => up({ unlimitedMeta: x })} none={t('qoNone')} name="unlimitedMeta" />
          </Field>
          {v.unlimitedMeta ? (
            <Field label={t('qoUnlimitedMode')} hint={t(v.unlimitedMetaMode === 'until' ? 'qoModeUntilHint' : 'qoModePositiveHint')}>
              <Choice
                value={v.unlimitedMetaMode}
                onChange={x => up({ unlimitedMetaMode: x })}
                name="unlimitedMetaMode"
                options={[
                  ['positive', 'qoModePositive'],
                  ['until', 'qoModeUntil'],
                ]}
              />
            </Field>
          ) : (
            <span />
          )}
        </div>
      </Section>
      <Section title={t('qoRefusal')}>
        <div className="form-grid">
          <Field label={t('qoMessage')} hint={`${t('qoMessageHint')} ${t('qoMessageBuiltIn')}`} className="span-2">
            <TrInputs value={v.message} onChange={x => up({ message: x })} disabled={ro} multiline name="message" />
          </Field>
          <Field label={t('qoNotice')} hint={t('qoNoticeHint')}>
            <Choice
              value={v.notice}
              onChange={x => up({ notice: x })}
              name="notice"
              options={[
                ['none', 'qoNoticeNone'],
                ['inbox', 'qoNoticeInbox'],
              ]}
            />
          </Field>
          <span />
        </div>
      </Section>
      {!ro && <SaveBar busy={f.busy} err={f.err} testId="qs-save" />}
    </form>
  );
}

function limitText(v: number | undefined) {
  return v === undefined ? '—' : v === 0 ? t('qoNoLimit') : num(v);
}

function useTagRows() {
  const tags = useRows('tag');
  return (ids: bigint[]) => ids.map(id => tags.find(x => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
}

function RuleBase(props: { name: string; setName: (v: string) => void; priority: number; setPriority: (v: number) => void; tagIds: bigint[]; setTags: (v: bigint[]) => void; prefix: string }) {
  return (
    <>
      <Field label={t('name')} required>
        <input className="input" name="name" value={props.name} onChange={e => props.setName(e.target.value)} autoFocus />
      </Field>
      <Field label={t('qoPriority')} hint={t('qoPriorityHint')}>
        <NumInput value={props.priority} onChange={props.setPriority} name="priority" />
      </Field>
      <Field label={t('tags')} hint={t('qoRuleTagsHint')} className="span-2">
        <TagPickerUser value={props.tagIds} onChange={props.setTags} testId={`${props.prefix}-tags`} />
      </Field>
    </>
  );
}

function TagPickerUser(props: { value: bigint[]; onChange: (v: bigint[]) => void; testId: string }) {
  const tags = useRows('tag')
    .filter(x => x.keyType === 'user')
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const { def } = useLanguages();
  const has = (id: bigint) => props.value.includes(id);
  return (
    <div className="chips" data-testid={props.testId}>
      {tags.length === 0 && <span className="small muted">{t('qoNoUserTags')}</span>}
      {tags.map(x => (
        <button
          type="button"
          key={String(x.id)}
          className="chip chip-btn"
          aria-pressed={has(x.id)}
          onClick={() => props.onChange(has(x.id) ? props.value.filter(y => y !== x.id) : [...props.value, x.id])}
          data-testid={`${props.testId}-${x.key}`}
        >
          {x.color ? <span className="swatch" style={{ background: x.color, width: 10, height: 10 }} /> : null}
          {trText(x.title, def) || x.key}
        </button>
      ))}
    </div>
  );
}

function QuotaRuleDialog(props: { row?: QuotaRuleRow; onClose: () => void }) {
  const r = props.row;
  const [name, setName] = useState(r?.name ?? '');
  const [priority, setPriority] = useState(r?.priority ?? 0);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [unlimited, setUnlimited] = useState(r?.unlimited ?? false);
  const [dm, setDm] = useState<number | undefined>(r?.dailyMessages);
  const [dc, setDc] = useState<number | undefined>(r?.dailyConversations);
  const [fm, setFm] = useState<number | undefined>(r?.friendDailyMessages);
  const [fc, setFc] = useState<number | undefined>(r?.friendDailyConversations);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  return (
    <FormDialog
      title={r ? t('qoRuleEdit') : t('qoRuleNew')}
      testId="qr-dialog"
      width={640}
      onClose={props.onClose}
      submit={() =>
        save(() =>
          getConn().reducers.adminSaveQuotaRule({
            id: r?.id ?? 0n,
            name,
            tagIds,
            priority,
            unlimited,
            dailyMessages: unlimited ? undefined : dm,
            dailyConversations: unlimited ? undefined : dc,
            friendDailyMessages: unlimited ? undefined : fm,
            friendDailyConversations: unlimited ? undefined : fc,
            isActive,
          })
        )
      }
    >
      <RuleBase name={name} setName={setName} priority={priority} setPriority={setPriority} tagIds={tagIds} setTags={setTags} prefix="qr" />
      <SwitchField checked={unlimited} onChange={setUnlimited} label={t('qoRuleUnlimited')} hint={t('qoRuleUnlimitedHint')} testId="qr-unlimited" />
      {!unlimited && (
        <>
          <div className="span-2 section-label">{t('qoRuleLimits')}</div>
          <Field label={t('qoDailyMessages')} hint={t('qoKeepHint')}>
            <OptNum value={dm} onChange={setDm} name="dailyMessages" placeholder={t('qoKeep')} />
          </Field>
          <Field label={t('qoDailyConversations')} hint={t('qoKeepHint')}>
            <OptNum value={dc} onChange={setDc} name="dailyConversations" placeholder={t('qoKeep')} />
          </Field>
          <Field label={t('qoFriendMessages')} hint={t('qoKeepHint')}>
            <OptNum value={fm} onChange={setFm} name="friendDailyMessages" placeholder={t('qoKeep')} />
          </Field>
          <Field label={t('qoFriendConversations')} hint={t('qoKeepHint')}>
            <OptNum value={fc} onChange={setFc} name="friendDailyConversations" placeholder={t('qoKeep')} />
          </Field>
        </>
      )}
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

function QuotaState() {
  const s = useRows('adminQuotaSettings')[0];
  if (!s) return <Skel h={56} r={8} />;
  const mode = s.countMode === 'conversations' ? t('qoSumConv', { n: num(s.dailyConversations) }) : t('qoSumMsg', { n: num(s.dailyMessages) });
  const action = (
    <button type="button" className="btn btn-outline btn-sm" onClick={() => openSettings('quota-settings')} data-testid="qo-open-settings">
      <GearSix className="ic" />
      {t('stQuotaSettings')}
    </button>
  );
  return s.enabled ? (
    <Notice icon={<Gauge className="ic" />} title={t('qoStateOn')} text={`${mode} · ${t('qoSumReset', { time: digits(minutesToTime(s.resetMinute)), zone: offsetText(s.utcOffsetMinutes) })}`} action={action} />
  ) : (
    <Notice kind="warn" title={t('qoStateOff')} text={t('qoStateOffHint')} action={action} />
  );
}

export function QuotaRules(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const list = useRows('adminQuotaRules');
  const loaded = useLoaded();
  const tagsOf = useTagRows();
  const [edit, setEdit] = useState<QuotaRuleRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  return (
    <main className="page" data-testid="page-quota-rules">
      <PageHead title={t('navQuotaRules')} sub={t('qoRulesSub')} action={props.ro ? undefined : <AddButton label={t('qoRuleNew')} onClick={() => setEdit('new')} testId="qr-add" />} />
      <QuotaState />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="qr"
        keyOf={r => String(r.id)}
        empty={{ icon: <ChatCircleDots className="ic" weight="duotone" />, title: t('qoRulesEmpty') }}
        cardTitle={r => <b>{r.name}</b>}
        cols={[
          { label: t('name'), render: r => <span className="primary">{r.name}</span> },
          { label: t('tags'), render: r => <TagList tags={tagsOf(r.tagIds)} /> },
          { label: t('qoPriority'), render: r => num(r.priority) },
          {
            label: t('qoRuleLimits'),
            render: r =>
              r.unlimited ? (
                <span className="badge b-info">{t('qoUnlimitedBadge')}</span>
              ) : (
                <span className="small">
                  {t('qoLimMsg')}: {limitText(r.dailyMessages)} · {t('qoLimConv')}: {limitText(r.dailyConversations)}
                  {(r.friendDailyMessages !== undefined || r.friendDailyConversations !== undefined) && (
                    <span className="muted">
                      {' '}
                      · {t('qoLimFriends')}: {limitText(r.friendDailyMessages)} / {limitText(r.friendDailyConversations)}
                    </span>
                  )}
                </span>
              ),
          },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.name }), () => getConn().reducers.adminDeleteQuotaRule({ id: r.id }))}
      />
      {edit && <QuotaRuleDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

const DAY_OPTS = ['7', '30', '90'] as const;

function DaysSeg(props: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="seg" role="group" aria-label={t('qoRange')} data-testid="sg-days">
      {DAY_OPTS.map(d => (
        <button type="button" key={d} aria-pressed={Number(d) === props.value} onClick={() => props.onChange(Number(d))} data-testid={`sg-days-${d}`}>
          {t('qoLastDays', { n: Number(d) })}
        </button>
      ))}
    </div>
  );
}

function Tiles(props: { list: [string, string, string?][] | null; n: number; prefix: string }) {
  return (
    <div className="tiles">
      {!props.list
        ? Array.from({ length: props.n }).map((_, i) => (
            <div className="tile" key={i} style={{ cursor: 'default', gridTemplateColumns: 'minmax(0, 1fr)' }}>
              <Skel w="55%" h={10} />
              <Skel w="35%" h={18} style={{ marginTop: 6 }} />
            </div>
          ))
        : props.list.map(([label, value, sub], i) => (
            <div className="tile" key={i} style={{ cursor: 'default', gridTemplateColumns: 'minmax(0, 1fr)', alignContent: 'start' }} data-testid={`${props.prefix}-tile-${i}`}>
              <span className="tile-label">{label}</span>
              <span className="tile-value">{value}</span>
              {sub ? <span className="small muted">{sub}</span> : null}
            </div>
          ))}
    </div>
  );
}

function BarChart(props: { days: { day: number; value: number; title: string }[]; label: string; tone?: 'bad' }) {
  const max = Math.max(1, ...props.days.map(d => d.value));
  return (
    <>
      <div className="chart" role="img" aria-label={props.label}>
        {props.days.map(d => (
          <span key={d.day} className={`bar ${d.value ? (props.tone === 'bad' ? 'sg-bar-bad' : '') : 'zero'}`} style={{ height: `${Math.max(d.value ? 3 : 1, (d.value / max) * 100)}%` }} title={`${dayText(d.day)}: ${d.title}`} />
        ))}
      </div>
      <div className="chart-axis">
        <span>{props.days[0] ? dayText(props.days[0].day) : ''}</span>
        <span>{props.days.length ? dayText(props.days[props.days.length - 1].day) : ''}</span>
      </div>
    </>
  );
}

function TopTable(props: { rows: { accountId: bigint; displayName: string; count: number }[]; label: string; testId: string }) {
  if (!props.rows.length) return <Empty icon={<UsersThree className="ic" weight="duotone" />} title={t('qoNoData')} />;
  return (
    <div className="scroll-x" data-testid={props.testId}>
      <table className="mini-table">
        <thead>
          <tr>
            <th>{t('pyColPlayer')}</th>
            <th>{props.label}</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map(r => (
            <tr key={String(r.accountId)}>
              <td>
                <Who id={r.accountId} name={r.displayName} />
              </td>
              <td>{num(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useDaysQuery(page: string) {
  const route = useRoute();
  const days = Number(route.query.get('days') ?? '30');
  return [DAY_OPTS.includes(String(days) as never) ? days : 30, (d: number) => pageQuery(page, { days: d === 30 ? '' : String(d) })] as const;
}

export function QuotaReport(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const [days, setDays] = useDaysQuery('quota-report');
  const s = useRows('adminQuotaSettings')[0];
  const { data, error } = useFetch(() => getConn().procedures.adminQuotaReport({ days }), [days]);
  const series = data && s ? fillDays(data.daily, quotaToday(s), days, day => ({ day, sent: 0, blocked: 0, fromPacks: 0 })) : null;
  return (
    <main className="page" data-testid="page-quota-report">
      <PageHead title={t('navQuotaReport')} sub={t('qoReportSub')} action={<DaysSeg value={days} onChange={setDays} />} />
      {s && !s.enabled && !props.ro && <Notice kind="warn" text={t('qoStateOffHint')} />}
      <ErrBox text={error ? errorText(error) : null} />
      <Tiles
        prefix="qrp"
        n={8}
        list={
          data
            ? [
                [t('qoTSent'), num(data.sent)],
                [t('qoTBlocked'), num(data.blocked)],
                [t('qoTBlockedPlayersT'), num(data.blockedPlayers)],
                [t('qoTFree'), num(data.free)],
                [t('qoTPacks'), num(data.fromPacks)],
                [t('qoTUnlimited'), num(data.unlimited)],
                [t('qoTPacksMeta'), num(data.packsFromMeta), t('qoTAllTime')],
                [t('qoTPacksAdmin'), num(data.packsFromAdmin), t('qoTAllTime')],
              ]
            : null
        }
      />
      <Section title={t('qoDailySent')} testId="qrp-chart">
        {!series ? (
          <Skel h={160} r={6} />
        ) : series.every(d => !d.sent && !d.blocked) ? (
          <Empty icon={<ChartBar className="ic" weight="duotone" />} title={t('qoNoData')} />
        ) : (
          <BarChart label={t('qoDailySent')} days={series.map(d => ({ day: d.day, value: d.sent, title: t('qoBarTitle', { s: num(d.sent), p: num(d.fromPacks), b: num(d.blocked) }) }))} />
        )}
      </Section>
      <Section title={t('qoDailyBlocked')} testId="qrp-chart-blocked">
        {!series ? (
          <Skel h={160} r={6} />
        ) : series.every(d => !d.blocked) ? (
          <Empty icon={<ShieldCheck className="ic" weight="duotone" />} title={t('qoNoBlocked')} />
        ) : (
          <BarChart tone="bad" label={t('qoDailyBlocked')} days={series.map(d => ({ day: d.day, value: d.blocked, title: num(d.blocked) }))} />
        )}
      </Section>
      <Section title={t('qoTopBlocked')} pad={false} testId="qrp-top">
        {!data ? (
          <div className="card-pad">
            <Skel h={60} r={6} />
          </div>
        ) : (
          <TopTable rows={data.top.map(x => ({ accountId: x.accountId, displayName: x.displayName, count: x.blocked }))} label={t('qoTBlocked')} testId="qrp-top-table" />
        )}
      </Section>
    </main>
  );
}

function GrantDialog(props: { accountId: bigint; onClose: () => void }) {
  const s = useRows('adminQuotaSettings')[0];
  const [amount, setAmount] = useState(10);
  const [mode, setMode] = useState<'default' | 'never' | 'days'>('default');
  const [days, setDays] = useState(7);
  const [note, setNote] = useState('');
  return (
    <FormDialog
      title={t('qoGrantTitle')}
      testId="pq-grant-dialog"
      width={520}
      onClose={props.onClose}
      submit={() => save(() => getConn().reducers.adminQuotaGrant({ accountId: props.accountId, amount, expiresInDays: mode === 'default' ? -1 : mode === 'never' ? 0 : days, note }))}
    >
      <Field label={t('qoGrantAmount')} hint={t('qoGrantAmountHint')} required>
        <NumInput value={amount} onChange={setAmount} name="amount" />
      </Field>
      <span />
      <Field label={t('qoGrantExpiry')} hint={mode === 'default' ? (s?.packExpiryDays ? t('qoDefaultDays', { n: num(s.packExpiryDays) }) : t('qoDefaultNever')) : undefined} className="span-2">
        <Seg
          value={mode}
          onChange={setMode}
          label={t('qoGrantExpiry')}
          options={[
            { value: 'default', label: t('qoExpDefault') },
            { value: 'never', label: t('qoExpNever') },
            { value: 'days', label: t('qoExpDays') },
          ]}
        />
      </Field>
      {mode === 'days' && (
        <Field label={t('qoExpDaysN')}>
          <NumInput value={days} onChange={setDays} name="expiresInDays" />
        </Field>
      )}
      <Field label={t('note')} className="span-2">
        <input className="input" name="note" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
      </Field>
    </FormDialog>
  );
}

function unlimitedByText(k: string) {
  const m: Record<string, StrKey> = { rule: 'qoByRule', item: 'qoByItem', meta: 'qoByMeta' };
  return m[k] ? t(m[k]) : k;
}

export function PlayerQuotaCard(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const id = props.accountId ?? 0n;
  const { can } = useSession();
  const [grant, setGrant] = useState(false);
  const { data, error } = useFetch(() => getConn().procedures.adminPlayerQuota({ accountId: id }), [String(id)]);
  const st = data?.status;
  const now = BigInt(Date.now()) * 1000n;
  return (
    <Section
      title={t('qoCardTitle')}
      pad={false}
      testId="pq-card"
      action={
        can('admin') && (
          <div className="row" style={{ gap: 4 }}>
            <button
              type="button"
              className="btn btn-sm btn-icon"
              data-testid="pq-reset"
              aria-label={t('qoResetToday')}
              title={t('qoResetToday')}
              onClick={async () => {
                if (await confirmAsk(t('qoResetConfirm'), { ok: t('qoResetToday') })) await runToast(c => c.reducers.adminQuotaReset({ accountId: id }), t('qoResetDone'));
              }}
            >
              <ArrowCounterClockwise className="ic" />
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setGrant(true)} data-testid="pq-grant">
              <Plus className="ic" />
              {t('qoGrant')}
            </button>
          </div>
        )
      }
    >
      <ErrBox text={error ? errorText(error) : null} />
      {!data || !st ? (
        <div className="card-pad stack">
          <Skel h={56} r={6} />
          <Skel h={40} r={6} />
        </div>
      ) : (
        <div className="card-pad stack">
          {!st.enabled && <Notice kind="warn" text={t('qoStateOffHint')} />}
          <dl className="stat-row" style={{ margin: 0 }}>
            <div className="stat">
              <dt>{t('qoFreeLeft')}</dt>
              <dd data-testid="pq-free">{st.unlimited ? t('qoUnlimitedBadge') : num(st.freeLeft)}</dd>
            </div>
            <div className="stat">
              <dt>{t('qoPacksLeft')}</dt>
              <dd data-testid="pq-packs">{num(st.packsLeft)}</dd>
            </div>
            <div className="stat">
              <dt>{t('qoSentToday')}</dt>
              <dd data-testid="pq-sent">{num(st.today.sent)}</dd>
            </div>
          </dl>
          <dl className="kv">
            <dt>{t('qoState')}</dt>
            <dd>
              <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className={`badge ${st.enabled ? 'b-ok' : ''}`}>{st.enabled ? t('qoOn') : t('qoOff')}</span>
                {st.unlimited && <span className="badge b-info">{t('qoUnlimitedBy', { by: unlimitedByText(st.unlimitedBy) })}</span>}
                {st.rule && <span className="badge">{t('qoRuleName', { name: st.rule.name })}</span>}
              </span>
            </dd>
            <dt>{t('qoLimMsg')}</dt>
            <dd data-testid="pq-messages">{t('qoUsedOf', { u: num(st.messages.used), l: num(st.messages.limit) })}</dd>
            <dt>{t('qoLimConv')}</dt>
            <dd>{t('qoUsedOf', { u: num(st.conversations.used), l: num(st.conversations.limit) })}</dd>
            {st.friends && (
              <>
                <dt>{t('qoLimFriends')}</dt>
                <dd>
                  {t('qoUsedOf', { u: num(st.friends.messages.used), l: num(st.friends.messages.limit) })} · {t('qoUsedOf', { u: num(st.friends.conversations.used), l: num(st.friends.conversations.limit) })}
                </dd>
              </>
            )}
            {st.bonus > 0 && (
              <>
                <dt>{t('qoBonus')}</dt>
                <dd>{num(st.bonus)}</dd>
              </>
            )}
            <dt>{t('qoTodayParts')}</dt>
            <dd>{t('qoTodayText', { f: num(st.today.free), p: num(st.today.fromPacks), u: num(st.today.unlimited), b: num(st.today.blocked) })}</dd>
            <dt>{t('qoResetsAt')}</dt>
            <dd>{when(st.resetsAt)}</dd>
          </dl>
          <div className="stack stack-sm">
            <span className="section-label">{t('qoLots')}</span>
            {data.lots.length === 0 ? (
              <span className="small muted">{t('qoNoLots')}</span>
            ) : (
              <div className="scroll-x">
                <table className="mini-table" data-testid="pq-lots">
                  <thead>
                    <tr>
                      <th>{t('qoLotLeft')}</th>
                      <th>{t('qoLotSource')}</th>
                      <th>{t('qoLotExpires')}</th>
                      <th>{t('note')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.lots.map(l => {
                      const dead = l.remaining === 0 || (!!l.expiresAt && l.expiresAt <= now);
                      return (
                        <tr key={String(l.id)} data-testid={`pq-lot-${l.id}`} className={dead ? 'muted' : undefined}>
                          <td className="nowrap">{t('qoLotOf', { r: num(l.remaining), a: num(l.amount) })}</td>
                          <td className="nowrap">{l.source === 'admin' ? t('qoSrcAdmin') : t('qoSrcMeta')}</td>
                          <td className="nowrap">{l.expiresAt ? usText(l.expiresAt) : t('qoExpNever')}</td>
                          <td className="small">{l.note || '—'}</td>
                          <td className="end">
                            {can('admin') && l.remaining > 0 && (
                              <button
                                type="button"
                                className="btn btn-sm btn-icon btn-danger-ghost"
                                aria-label={t('qoRevoke')}
                                title={t('qoRevoke')}
                                data-testid={`pq-revoke-${l.id}`}
                                onClick={async () => {
                                  if (await confirmAsk(t('qoRevokeConfirm', { n: num(l.remaining) }), { danger: true, ok: t('qoRevoke') })) await runToast(c => c.reducers.adminQuotaRevokeLot({ id: l.id }), t('qoRevoked'));
                                }}
                              >
                                <Trash className="ic" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="stack stack-sm">
            <span className="section-label">{t('qoHistory')}</span>
            {data.days.length === 0 ? (
              <span className="small muted">{t('qoNoHistory')}</span>
            ) : (
              <div className="scroll-x">
                <table className="mini-table" data-testid="pq-days">
                  <thead>
                    <tr>
                      <th>{t('qoDayCol')}</th>
                      <th>{t('qoTSent')}</th>
                      <th>{t('qoTPacks')}</th>
                      <th>{t('qoTBlocked')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map(d => (
                      <tr key={d.key}>
                        <td className="nowrap">{dayText(d.day)}</td>
                        <td>{num(d.total)}</td>
                        <td>{num(d.packUsed)}</td>
                        <td className={d.blocked ? 'neg' : undefined}>{num(d.blocked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {grant && <GrantDialog accountId={id} onClose={() => setGrant(false)} />}
    </Section>
  );
}

function giftArgs(s: GiftRow) {
  const { id: _id, updatedAt: _u, ...rest } = s;
  return { ...rest, currencies: s.currencies.map(c => ({ ...c })), methods: [...s.methods] };
}

type GiftArgs = ReturnType<typeof giftArgs>;

const METHOD_KEYS: [string, StrKey][] = [
  ['in_app', 'fgMInApp'],
  ['gateway', 'fgMGateway'],
  ['store', 'fgMStore'],
];

export function GiftSettingsSection(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const ro = !!props.ro;
  const s = useRows('adminGiftSettings')[0];
  const [v, setV] = useState<GiftArgs | null>(null);
  const f = useSaver();
  useEffect(() => {
    if (s && !v) setV(giftArgs(s));
  }, [s, v]);
  if (!v) return <FormSkel n={10} />;
  const up = (p: Partial<GiftArgs>) => setV({ ...v, ...p });
  type NumKey = 'minFriendDays' | 'minMutualFriends' | 'minSenderAccountDays' | 'minRecipientAccountDays' | 'minSenderLevel' | 'perSenderDaily' | 'perRecipientDaily' | 'perPairDaily' | 'expiryHours' | 'messageMaxLength';
  const n = (k: NumKey, label: StrKey, hint?: StrKey) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <NumInput value={v[k]} onChange={x => up({ [k]: x })} disabled={ro} name={k} />
    </Field>
  );
  const friends = v.recipients === 'friends';
  return (
    <form
      className="stack stack-lg"
      data-testid="gs-form"
      onSubmit={e => {
        e.preventDefault();
        f.go(() => Promise.resolve().then(() => getConn().reducers.adminSaveGiftSettings(v)));
      }}
    >
      <Section title={t('fgWho')}>
        <div className="form-grid">
          <SwitchField checked={v.enabled} onChange={x => up({ enabled: x })} disabled={ro} label={t('fgEnabled')} hint={t('fgEnabledHint')} testId="gs-enabled" />
          <Field label={t('fgRecipients')}>
            <Choice
              value={v.recipients}
              onChange={x => up({ recipients: x })}
              name="recipients"
              options={[
                ['friends', 'fgRecFriends'],
                ['any', 'fgRecAny'],
              ]}
            />
          </Field>
          {friends ? n('minFriendDays', 'fgMinFriendDays', 'fgZeroNone') : <span />}
          {friends && n('minMutualFriends', 'fgMinMutual', 'fgZeroNone')}
          {friends && <span />}
          {n('minSenderAccountDays', 'fgMinSenderDays', 'fgZeroNone')}
          {n('minRecipientAccountDays', 'fgMinRecipientDays', 'fgZeroNone')}
          {n('minSenderLevel', 'fgMinLevel', 'fgZeroNone')}
          {v.minSenderLevel > 0 ? (
            <Field label={t('fgLevelTable')} hint={t('fgLevelTableHint')}>
              <IdPick kind="levelTable" value={v.levelTableId} onChange={x => up({ levelTableId: x })} none={t('fgDefaultTable')} testId="gs-level-table" />
            </Field>
          ) : (
            <span />
          )}
        </div>
      </Section>
      <Section title={t('fgInventory')}>
        <div className="form-grid">
          <SwitchField checked={v.inventoryEnabled} onChange={x => up({ inventoryEnabled: x })} disabled={ro} label={t('fgInventoryOn')} testId="gs-inventory" />
          {v.inventoryEnabled && (
            <>
              <SwitchField checked={v.itemsDefault} onChange={x => up({ itemsDefault: x })} disabled={ro} label={t('fgItemsDefault')} hint={t('fgItemsDefaultHint')} />
              <Field label={t('fgEquipped')}>
                <Choice
                  value={v.equipped}
                  onChange={x => up({ equipped: x })}
                  name="equipped"
                  options={[
                    ['block', 'fgEquippedBlock'],
                    ['unequip', 'fgEquippedUnequip'],
                  ]}
                />
              </Field>
              <Field label={t('fgUpgrade')}>
                <Choice
                  value={v.upgradeLevel}
                  onChange={x => up({ upgradeLevel: x })}
                  name="upgradeLevel"
                  options={[
                    ['keep', 'fgUpgradeKeep'],
                    ['reset', 'fgUpgradeReset'],
                  ]}
                />
              </Field>
              <Field label={t('fgRegift')}>
                <Choice
                  value={v.regift}
                  onChange={x => up({ regift: x })}
                  name="regift"
                  options={[
                    ['block', 'fgRegiftBlock'],
                    ['allow', 'fgRegiftAllow'],
                  ]}
                />
              </Field>
              <Field label={t('fgReq')} hint={t('fgReqHint')}>
                <Choice
                  value={v.itemRequirements}
                  onChange={x => up({ itemRequirements: x })}
                  name="itemRequirements"
                  options={[
                    ['check', 'fgReqCheck'],
                    ['ignore', 'fgReqIgnore'],
                  ]}
                />
              </Field>
            </>
          )}
        </div>
      </Section>
      <Section title={t('fgCurrency')}>
        <div className="form-grid">
          <SwitchField checked={v.currencyEnabled} onChange={x => up({ currencyEnabled: x })} disabled={ro} label={t('fgCurrencyOn')} hint={t('fgCurrencyHint')} testId="gs-currency" />
          {v.currencyEnabled && (
            <div className="span-2">
              {ro ? (
                <CurrencyRowsRo list={v.currencies} />
              ) : (
                <Rows<GiftCur>
                  rows={v.currencies}
                  onChange={x => up({ currencies: x })}
                  testId="gs-cur"
                  addLabel={t('fgAddCurrency')}
                  make={() => ({ currencyKey: '', min: 1n, max: 0n })}
                  max={20}
                  cols={[
                    { label: t('fgCurKey'), width: 'minmax(0, 2fr)', render: (r, set, i) => <KeyPick kind="currency" value={r.currencyKey} onChange={x => set({ currencyKey: x })} none="—" testId={`gs-cur-${i}-key`} label={t('fgCurKey')} /> },
                    { label: t('fgCurMin'), width: 'minmax(0, 1fr)', render: (r, set) => <BigInput value={r.min} onChange={x => set({ min: x })} name="curMin" min0 /> },
                    { label: t('fgCurMax'), width: 'minmax(0, 1fr)', render: (r, set) => <BigInput value={r.max} onChange={x => set({ max: x })} name="curMax" min0 /> },
                  ]}
                  footer={<span className="small muted">{t('fgCurMaxHint')}</span>}
                />
              )}
            </div>
          )}
        </div>
      </Section>
      <Section title={t('fgShop')}>
        <div className="form-grid">
          <SwitchField checked={v.shopEnabled} onChange={x => up({ shopEnabled: x })} disabled={ro} label={t('fgShopOn')} testId="gs-shop" />
          {v.shopEnabled && (
            <>
              <SwitchField checked={v.productsDefault} onChange={x => up({ productsDefault: x })} disabled={ro} label={t('fgProductsDefault')} hint={t('fgProductsDefaultHint')} />
              <Field label={t('fgMethods')} hint={t('fgMethodsHint')} className="span-2">
                <div className="chips" data-testid="gs-methods">
                  {METHOD_KEYS.map(([m, k]) => (
                    <button
                      type="button"
                      key={m}
                      className="chip chip-btn"
                      disabled={ro}
                      aria-pressed={v.methods.includes(m)}
                      onClick={() => up({ methods: v.methods.includes(m) ? v.methods.filter(x => x !== m) : [...v.methods, m] })}
                      data-testid={`gs-method-${m}`}
                    >
                      {t(k)}
                    </button>
                  ))}
                </div>
              </Field>
              <SwitchField checked={v.discountCodes} onChange={x => up({ discountCodes: x })} disabled={ro} label={t('fgDiscount')} />
            </>
          )}
        </div>
      </Section>
      <Section title={t('fgLimits')}>
        <div className="form-grid">
          {n('perSenderDaily', 'fgPerSender', 'zeroNoLimit')}
          {n('perRecipientDaily', 'fgPerRecipient', 'zeroNoLimit')}
          {n('perPairDaily', 'fgPerPair', 'zeroNoLimit')}
          <Field label={t('qoMatch')} hint={t(v.matchPolicy === 'generous' ? 'qoMatchGenerousHint' : 'qoMatchPriorityHint')}>
            <Choice
              value={v.matchPolicy}
              onChange={x => up({ matchPolicy: x })}
              name="matchPolicy"
              options={[
                ['priority', 'qoMatchPriority'],
                ['generous', 'qoMatchGenerous'],
              ]}
            />
          </Field>
          <Field label={t('fgSendBonus')} hint={t('fgBonusHint')}>
            <KeyPick kind="meta" value={v.sendBonusMeta} onChange={x => up({ sendBonusMeta: x })} none={t('qoNone')} name="sendBonusMeta" />
          </Field>
          <Field label={t('fgReceiveBonus')} hint={t('fgBonusHint')}>
            <KeyPick kind="meta" value={v.receiveBonusMeta} onChange={x => up({ receiveBonusMeta: x })} none={t('qoNone')} name="receiveBonusMeta" />
          </Field>
        </div>
      </Section>
      <Section title={t('fgDelivery')}>
        <div className="form-grid">
          <Field label={t('fgDeliveryMode')} hint={t(v.delivery === 'accept' ? 'fgDeliveryAcceptHint' : 'fgDeliveryInstantHint')} className="span-2">
            <Seg
              value={v.delivery}
              onChange={x => !ro && up({ delivery: x })}
              label={t('fgDeliveryMode')}
              options={[
                { value: 'instant', label: t('fgDeliveryInstant') },
                { value: 'accept', label: t('fgDeliveryAccept') },
              ]}
            />
          </Field>
          {v.delivery === 'accept' && (
            <>
              {n('expiryHours', 'fgExpiryHours', 'fgExpiryHoursHint')}
              <Field label={t('fgOnExpiry')}>
                <Choice
                  value={v.onExpiry}
                  onChange={x => up({ onExpiry: x })}
                  name="onExpiry"
                  options={[
                    ['return', 'fgOnExpiryReturn'],
                    ['accept', 'fgOnExpiryAccept'],
                  ]}
                />
              </Field>
              <SwitchField checked={v.senderCancel} onChange={x => up({ senderCancel: x })} disabled={ro} label={t('fgSenderCancel')} />
            </>
          )}
          <Field label={t('fgCoinReturn')} hint={t('fgReturnHint')}>
            <Choice
              value={v.coinReturn}
              onChange={x => up({ coinReturn: x })}
              name="coinReturn"
              options={[
                ['refund', 'fgRetRefund'],
                ['sender', 'fgRetSender'],
                ['none', 'fgRetNone'],
              ]}
            />
          </Field>
          <Field label={t('fgMoneyReturn')} hint={t('fgReturnHint')}>
            <Choice
              value={v.moneyReturn}
              onChange={x => up({ moneyReturn: x })}
              name="moneyReturn"
              options={[
                ['sender', 'fgRetSender'],
                ['refund_due', 'fgRetRefundDue'],
                ['none', 'fgRetNone'],
              ]}
            />
          </Field>
        </div>
      </Section>
      <Section title={t('fgMessages')}>
        <div className="form-grid">
          <SwitchField checked={v.messageEnabled} onChange={x => up({ messageEnabled: x })} disabled={ro} label={t('fgMessageOn')} testId="gs-message" />
          {v.messageEnabled && (
            <>
              {n('messageMaxLength', 'fgMessageMax', 'fgMessageMaxHint')}
              <Field label={t('fgMessageFilter')} hint={t('fgMessageFilterHint')}>
                <Choice
                  value={v.messageFilter}
                  onChange={x => up({ messageFilter: x })}
                  name="messageFilter"
                  options={[
                    ['rules', 'fgFilterRules'],
                    ['block', 'fgFilterBlock'],
                    ['off', 'fgFilterOff'],
                  ]}
                />
              </Field>
            </>
          )}
          <Field label={t('fgNotify')}>
            <Choice
              value={v.notify}
              onChange={x => up({ notify: x })}
              name="notify"
              options={[
                ['in_app', 'fgNotifyInApp'],
                ['push_in_app', 'fgNotifyPush'],
                ['none', 'fgNotifyNone'],
              ]}
            />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <SwitchRow checked={v.notifySender} onChange={x => up({ notifySender: x })} disabled={ro || v.notify === 'none'} label={t('fgNotifySender')} />
          </div>
        </div>
      </Section>
      {!ro && <SaveBar busy={f.busy} err={f.err} testId="gs-save" />}
    </form>
  );
}

function CurrencyRowsRo(props: { list: GiftCur[] }) {
  const names = useNames();
  if (!props.list.length) return <span className="small muted">{t('fgNoCurrencies')}</span>;
  return (
    <div className="chips">
      {props.list.map(c => (
        <span className="chip" key={c.currencyKey}>
          {names.currency(c.currencyKey)} · {num(c.min)}–{c.max ? num(c.max) : '∞'}
        </span>
      ))}
    </div>
  );
}

function GiftRuleDialog(props: { row?: GiftRuleRow; onClose: () => void }) {
  const r = props.row;
  const [name, setName] = useState(r?.name ?? '');
  const [priority, setPriority] = useState(r?.priority ?? 0);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [ps, setPs] = useState<number | undefined>(r?.perSenderDaily);
  const [pr, setPr] = useState<number | undefined>(r?.perRecipientDaily);
  const [pp, setPp] = useState<number | undefined>(r?.perPairDaily);
  const [canSend, setCanSend] = useState(r?.canSend ?? true);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  return (
    <FormDialog
      title={r ? t('fgRuleEdit') : t('fgRuleNew')}
      testId="gr-dialog"
      width={640}
      onClose={props.onClose}
      submit={() => save(() => getConn().reducers.adminSaveGiftRule({ id: r?.id ?? 0n, name, tagIds, priority, perSenderDaily: ps, perRecipientDaily: pr, perPairDaily: pp, canSend, isActive }))}
    >
      <RuleBase name={name} setName={setName} priority={priority} setPriority={setPriority} tagIds={tagIds} setTags={setTags} prefix="gr" />
      <SwitchField checked={canSend} onChange={setCanSend} label={t('fgCanSend')} hint={t('fgCanSendHint')} testId="gr-can-send" />
      <div className="span-2 section-label">{t('qoRuleLimits')}</div>
      <Field label={t('fgPerSender')} hint={t('qoKeepHint')}>
        <OptNum value={ps} onChange={setPs} name="perSenderDaily" placeholder={t('qoKeep')} />
      </Field>
      <Field label={t('fgPerRecipient')} hint={t('qoKeepHint')}>
        <OptNum value={pr} onChange={setPr} name="perRecipientDaily" placeholder={t('qoKeep')} />
      </Field>
      <Field label={t('fgPerPair')} hint={t('qoKeepHint')}>
        <OptNum value={pp} onChange={setPp} name="perPairDaily" placeholder={t('qoKeep')} />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function GiftRules(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const list = useRows('adminGiftRules');
  const loaded = useLoaded();
  const tagsOf = useTagRows();
  const [edit, setEdit] = useState<GiftRuleRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  return (
    <main className="page" data-testid="page-gift-rules">
      <PageHead
        title={t('navGiftRules')}
        sub={t('fgRulesSub')}
        action={
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-outline" onClick={() => openSettings('gift-settings')} data-testid="gr-settings">
              <GearSix className="ic" />
              {t('stGiftSettings')}
            </button>
            {!props.ro && <AddButton label={t('fgRuleNew')} onClick={() => setEdit('new')} testId="gr-add" />}
          </div>
        }
      />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="gr"
        keyOf={r => String(r.id)}
        empty={{ icon: <Gift className="ic" weight="duotone" />, title: t('fgRulesEmpty') }}
        cardTitle={r => <b>{r.name}</b>}
        cols={[
          { label: t('name'), render: r => <span className="primary">{r.name}</span> },
          { label: t('tags'), render: r => <TagList tags={tagsOf(r.tagIds)} /> },
          { label: t('qoPriority'), render: r => num(r.priority) },
          {
            label: t('qoRuleLimits'),
            render: r =>
              !r.canSend ? (
                <span className="badge b-bad">{t('fgCantSend')}</span>
              ) : (
                <span className="small">
                  {t('fgLimSender')}: {limitText(r.perSenderDaily)} · {t('fgLimRecipient')}: {limitText(r.perRecipientDaily)} · {t('fgLimPair')}: {limitText(r.perPairDaily)}
                </span>
              ),
          },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.name }), () => getConn().reducers.adminDeleteGiftRule({ id: r.id }))}
      />
      {edit && <GiftRuleDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type GKind = 'item' | 'item_type' | 'product';
type GEntry = { kind: GKind; key: string; name: string; sub: string; flag: boolean | undefined; effective: boolean; from: StrKey };

const KIND_LABEL: Record<GKind, StrKey> = { item: 'fgKindItem', item_type: 'fgKindType', product: 'fgKindProduct' };

function FlagSeg(props: { value: boolean | undefined; onChange: (v: boolean | undefined) => void; prefix: string; disabled: boolean }) {
  const opts: [string, boolean | undefined, StrKey][] = [
    ['default', undefined, 'fgFlagDefault'],
    ['yes', true, 'fgFlagYes'],
    ['no', false, 'fgFlagNo'],
  ];
  return (
    <div className="seg" role="group" aria-label={t('fgFlag')}>
      {opts.map(([k, val, label]) => (
        <button type="button" key={k} disabled={props.disabled} aria-pressed={props.value === val} onClick={() => props.value !== val && props.onChange(val)} data-testid={`${props.prefix}-${k}`}>
          {t(label)}
        </button>
      ))}
    </div>
  );
}

function EffBadge(props: { on: boolean }) {
  return <span className={`badge ${props.on ? 'b-ok' : 'b-bad'}`}>{props.on ? t('fgGiftable') : t('fgNotGiftable')}</span>;
}

export function Giftables(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const { can } = useSession();
  const ro = !!props.ro || !can('admin');
  const route = useRoute();
  const kind = (route.query.get('kind') ?? '') as GKind | '';
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const dq = useDebounced(q, 200);
  const flags = useRows('adminGiftables');
  const s = useRows('adminGiftSettings')[0];
  const items = useRows('item');
  const types = useRows('itemType');
  const productsFetch = useFetch(() => allProducts(), []);
  const products = productsFetch.data ?? [];
  const { def } = useLanguages();
  const loaded = useLoaded() && !!s && !!productsFetch.data;
  const flag = (k: GKind, key: string) => flags.find(f => f.kind === k && f.refKey === key)?.giftable;
  const itemsDefault = s?.itemsDefault ?? true;
  const productsDefault = s?.productsDefault ?? true;
  const all: GEntry[] = [
    ...types.map(x => {
      const f = flag('item_type', x.key);
      return { kind: 'item_type' as const, key: x.key, name: trText(x.name, def) || x.key, sub: x.key, flag: f, effective: f ?? itemsDefault, from: (f === undefined ? 'fgFromDefault' : 'fgFromHere') as StrKey };
    }),
    ...items.map(x => {
      const f = flag('item', x.key);
      const tf = flag('item_type', x.typeKey);
      return {
        kind: 'item' as const,
        key: x.key,
        name: trText(x.name, def) || x.key,
        sub: `${x.key} · ${trText(types.find(y => y.key === x.typeKey)?.name, def) || x.typeKey}`,
        flag: f,
        effective: f ?? tf ?? itemsDefault,
        from: (f !== undefined ? 'fgFromHere' : tf !== undefined ? 'fgFromType' : 'fgFromDefault') as StrKey,
      };
    }),
    ...products.map(x => {
      const f = flag('product', x.key);
      return { kind: 'product' as const, key: x.key, name: trText(x.name, def) || x.key, sub: x.key, flag: f, effective: f ?? productsDefault, from: (f === undefined ? 'fgFromDefault' : 'fgFromHere') as StrKey };
    }),
  ];
  const needle = latin(dq).trim().toLowerCase();
  const rows = all.filter(x => (!kind || x.kind === kind) && (!needle || x.key.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle)));
  const set = (x: GEntry, v: boolean | undefined) => runToast(c => c.reducers.adminSetGiftable({ kind: x.kind, key: x.key, giftable: v }), t('saved'));
  const id = (x: GEntry) => `${x.kind}-${x.key}`;
  return (
    <main className="page" data-testid="page-giftables">
      <PageHead
        title={t('navGiftables')}
        sub={s ? t('fgGiftablesSub', { i: itemsDefault ? t('fgGiftable') : t('fgNotGiftable'), p: productsDefault ? t('fgGiftable') : t('fgNotGiftable') }) : <Skel w={160} h={10} />}
        action={
          <button type="button" className="btn btn-outline" onClick={() => openSettings('gift-settings')} data-testid="gb-settings">
            <GearSix className="ic" />
            {t('stGiftSettings')}
          </button>
        }
      />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input
            className="input"
            value={q}
            onChange={e => {
              setQ(e.target.value);
              pageQuery('giftables', { kind, q: e.target.value });
            }}
            placeholder={t('fgSearch')}
            aria-label={t('fgSearch')}
            data-testid="gb-search"
          />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 160 }} value={kind} onChange={e => pageQuery('giftables', { kind: e.target.value, q })} aria-label={t('fgKind')} data-testid="gb-kind">
          <option value="">{t('fgAllKinds')}</option>
          {(Object.keys(KIND_LABEL) as GKind[]).map(k => (
            <option key={k} value={k}>
              {t(KIND_LABEL[k])}
            </option>
          ))}
        </select>
        <span className="grow" />
        {loaded && <span className="small muted">{t('fgCount', { n: num(rows.length) })}</span>}
      </div>
      <ErrBox text={productsFetch.error ? errorText(productsFetch.error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="gb-table">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('fgKind')}</th>
              <th>{t('fgEffective')}</th>
              <th className="end">{t('fgFlag')}</th>
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <TableSkeleton cols={4} rows={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <Empty icon={<Package className="ic" weight="duotone" />} title={t('emptyList')} />
                </td>
              </tr>
            ) : (
              rows.map(x => (
                <tr key={id(x)} data-testid={`gb-row-${id(x)}`}>
                  <td>
                    <span className="primary">{x.name}</span>
                    <div className="mono muted">{x.sub}</div>
                  </td>
                  <td>{t(KIND_LABEL[x.kind])}</td>
                  <td>
                    <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <EffBadge on={x.effective} />
                      <span className="small muted">{t(x.from)}</span>
                    </span>
                  </td>
                  <td className="end">
                    <FlagSeg value={x.flag} onChange={v => set(x, v)} prefix={`gb-${id(x)}`} disabled={ro} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {loaded && rows.length === 0 && <Empty icon={<Package className="ic" weight="duotone" />} title={t('emptyList')} />}
          {loaded &&
            rows.map(x => (
              <div className="pcard" key={id(x)}>
                <div className="row">
                  <b className="grow">{x.name}</b>
                  <EffBadge on={x.effective} />
                </div>
                <div className="pcard-meta">
                  <span>{t('fgKind')}</span>
                  <span>{t(KIND_LABEL[x.kind])}</span>
                  <span>{t('key')}</span>
                  <span className="mono">{x.key}</span>
                  <span>{t('fgEffective')}</span>
                  <span>{t(x.from)}</span>
                </div>
                <FlagSeg value={x.flag} onChange={v => set(x, v)} prefix={`gbc-${id(x)}`} disabled={ro} />
              </div>
            ))}
        </div>
      </div>
    </main>
  );
}

const STATUSES: [string, StrKey][] = [
  ['sending', 'fgStSending'],
  ['paying', 'fgStPaying'],
  ['pending', 'fgStPending'],
  ['delivered', 'fgStDelivered'],
  ['declined', 'fgStDeclined'],
  ['expired', 'fgStExpired'],
  ['cancelled', 'fgStCancelled'],
  ['reversed', 'fgStReversed'],
  ['failed', 'fgStFailed'],
];

const OUTCOMES: Record<string, StrKey> = {
  delivered: 'fgOutDelivered',
  returned: 'fgOutReturned',
  refunded: 'fgOutRefunded',
  sender_got: 'fgOutSenderGot',
  refund_due: 'fgOutRefundDue',
  kept: 'fgOutKept',
};

const KINDS: [string, StrKey][] = [
  ['item', 'fgGkItem'],
  ['currency', 'fgGkCurrency'],
  ['product', 'fgGkProduct'],
];

function statusText(s: string) {
  const k = STATUSES.find(x => x[0] === s)?.[1];
  return k ? t(k) : s;
}

function kindText(k: string) {
  const v = KINDS.find(x => x[0] === k)?.[1];
  return v ? t(v) : k;
}

function StatusBadge(props: { status: string; testId?: string }) {
  const s = props.status;
  const cls = s === 'delivered' ? 'b-ok' : s === 'failed' ? 'b-bad' : s === 'pending' || s === 'paying' || s === 'sending' ? 'b-warn' : s === 'reversed' ? 'b-info' : '';
  return (
    <span className={`badge ${cls}`} data-testid={props.testId}>
      {statusText(s)}
    </span>
  );
}

function OutcomeText(props: { outcome: string }) {
  if (!props.outcome || props.outcome === 'delivered') return null;
  return <span className="small muted">{OUTCOMES[props.outcome] ? t(OUTCOMES[props.outcome]) : props.outcome}</span>;
}

type GiftLike = Awaited<ReturnType<ReturnType<typeof getConn>['procedures']['adminFriendGift']>>['row']['gift'];

function useWhat() {
  const names = useNames();
  const products = useProducts();
  const { def } = useLanguages();
  return (g: GiftLike) => {
    if (g.kind === 'item') return `${names.item(g.itemKey)}${g.quantity > 1 ? ` × ${num(g.quantity)}` : ''}`;
    if (g.kind === 'currency') return `${num(g.amount)} ${names.currency(g.currencyKey)}`;
    const p = products.find(x => x.id === g.productId);
    return p ? trText(p.name, def) || p.key : `#${digits(String(g.productId))}`;
  };
}

function priceText(g: GiftLike, names: ReturnType<typeof useNames>) {
  if (g.kind !== 'product') return '';
  if (g.method === 'in_app' && g.coinAmount) return `${num(g.coinAmount)} ${names.currency(g.coinCurrency)}`;
  return g.method ? methodText(g.method) : '';
}

function methodText(m: string) {
  const map: Record<string, StrKey> = { in_app: 'fgMInApp', zarinpal: 'fgMZarinpal', zibal: 'fgMZibal', bazaar: 'fgMBazaar', myket: 'fgMMyket' };
  return map[m] ? t(map[m]) : m;
}

export function FriendGifts(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const route = useRoute();
  const status = route.query.get('status') ?? '';
  const kind = route.query.get('kind') ?? '';
  const flagged = route.query.get('flagged') === '1';
  const [player, setPlayer] = useState(route.query.get('player') ?? '');
  const [page, setPage] = useState(1);
  const p = useDebounced(player, 300);
  const pid = /^\d+$/.test(latin(p).trim().replace(/^#/, '')) ? BigInt(latin(p).trim().replace(/^#/, '')) : 0n;
  const what = useWhat();
  const names = useNames();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminFriendGifts({ status, kind, userId: pid, flagged, page, pageSize: PAGE }), [status, kind, String(pid), flagged, page]);
  const rows = data?.rows ?? [];
  const setQ = (patch: Record<string, string>) => {
    setPage(1);
    pageQuery('friend-gifts', { status, kind, flagged: flagged ? '1' : '', player, ...patch });
  };
  const open = (id: bigint) => (location.hash = `#/friend-gift?id=${id}`);
  return (
    <main className="page" data-testid="page-friend-gifts">
      <PageHead
        title={t('navFriendGifts')}
        sub={data ? t('fgTotal', { n: num(data.total) }) : <Skel w={60} h={10} />}
        action={
          <a className="btn btn-outline" href="#/gift-report" data-testid="fg-report">
            <ChartBar className="ic" />
            {t('navGiftReport')}
          </a>
        }
      />
      <div className="toolbar">
        <div className="input-affix search" style={{ width: 200 }}>
          <MagnifyingGlass className="ic" />
          <input
            className="input"
            value={player}
            onChange={e => {
              setPlayer(e.target.value);
              setQ({ player: e.target.value });
            }}
            placeholder={t('fgPlayerId')}
            aria-label={t('fgPlayerId')}
            inputMode="numeric"
            data-testid="fg-player"
          />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 150 }} value={status} onChange={e => setQ({ status: e.target.value })} aria-label={t('status')} data-testid="fg-status">
          <option value="">{t('fgAllStatuses')}</option>
          {STATUSES.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 140 }} value={kind} onChange={e => setQ({ kind: e.target.value })} aria-label={t('fgKind')} data-testid="fg-kind">
          <option value="">{t('fgAllKinds')}</option>
          {KINDS.map(([v, k]) => (
            <option key={v} value={v}>
              {t(k)}
            </option>
          ))}
        </select>
        <SwitchRow checked={flagged} onChange={x => setQ({ flagged: x ? '1' : '' })} label={t('fgFlaggedOnly')} testId="fg-flagged" />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="fg-table">
          <thead>
            <tr>
              <th>{t('fgGift')}</th>
              <th>{t('fgSender')}</th>
              <th>{t('fgRecipient')}</th>
              <th>{t('fgWhat')}</th>
              <th>{t('status')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <Empty icon={<Gift className="ic" weight="duotone" />} title={t('fgEmpty')} text={t('fgEmptyHint')} />
                </td>
              </tr>
            ) : (
              rows.map(({ gift: g, senderName, recipientName }) => (
                <tr key={String(g.id)} data-testid={`fg-row-${g.id}`} className="sg-click" onClick={e => !(e.target as HTMLElement).closest('a') && open(g.id)}>
                  <td className="nowrap">
                    <a className="row-link" href={`#/friend-gift?id=${g.id}`} data-testid={`fg-open-${g.id}`}>
                      #{digits(String(g.id))}
                    </a>
                    <div className="small muted">{when(g.createdAt)}</div>
                  </td>
                  <td>
                    <Who id={g.senderId} name={senderName} />
                  </td>
                  <td>
                    <Who id={g.recipientId} name={recipientName} />
                  </td>
                  <td>
                    <span className="primary">{what(g)}</span>
                    <div className="small muted">
                      {kindText(g.kind)}
                      {priceText(g, names) ? ` · ${priceText(g, names)}` : ''}
                      {g.messageFlagged && <span className="badge b-warn sg-inline-badge">{t('fgFlagged')}</span>}
                    </div>
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
                      <StatusBadge status={g.status} />
                      <OutcomeText outcome={g.outcome} />
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="fg-cards">
          {rows.map(({ gift: g, senderName, recipientName }) => (
            <a className="pcard sg-pcard-link" key={String(g.id)} href={`#/friend-gift?id=${g.id}`}>
              <div className="row">
                <b className="grow">{what(g)}</b>
                <StatusBadge status={g.status} />
              </div>
              <div className="pcard-meta">
                <span>{t('fgSender')}</span>
                <span>{senderName || `#${digits(String(g.senderId))}`}</span>
                <span>{t('fgRecipient')}</span>
                <span>{recipientName || `#${digits(String(g.recipientId))}`}</span>
                <span>{t('fgSentAt')}</span>
                <span>{when(g.createdAt)}</span>
              </div>
            </a>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

function ReverseDialog(props: { g: GiftLike; onClose: () => void }) {
  const g = props.g;
  const refundable = g.kind === 'product' && g.method === 'in_app' && g.coinAmount > 0n;
  const [returnTo, setReturnTo] = useState<'sender' | 'refund' | 'none'>('sender');
  const [note, setNote] = useState('');
  const pending = g.status === 'pending';
  return (
    <FormDialog
      title={t('fgReverseTitle', { id: digits(String(g.id)) })}
      testId="fgd-reverse-dialog"
      width={560}
      onClose={props.onClose}
      submit={() => save(() => getConn().reducers.adminReverseFriendGift({ id: g.id, returnTo: pending ? 'sender' : returnTo, note }))}
    >
      <div className="span-2">
        <Notice kind="warn" text={pending ? t('fgReversePendingHint') : t('fgReverseDeliveredHint')} />
      </div>
      {!pending && (
        <Field label={t('fgReturnTo')} className="span-2" hint={t(returnTo === 'refund' ? 'fgRetRefundHint' : returnTo === 'none' ? 'fgRetNoneHint' : 'fgRetSenderHint')}>
          <div className="seg" role="group" aria-label={t('fgReturnTo')}>
            {(
              [
                ['sender', 'fgRevSender'],
                ['refund', 'fgRevRefund'],
                ['none', 'fgRevNone'],
              ] as const
            ).map(([v, k]) => (
              <button type="button" key={v} aria-pressed={returnTo === v} disabled={v === 'refund' && !refundable} onClick={() => setReturnTo(v)} data-testid={`fgd-return-${v}`}>
                {t(k)}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label={t('note')} className="span-2">
        <textarea className="textarea" name="note" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={300} />
      </Field>
    </FormDialog>
  );
}

function Kv(props: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </>
  );
}

export function FriendGiftPage(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const route = useRoute();
  const raw = route.query.get('id') ?? '';
  const id = /^\d+$/.test(raw) ? BigInt(raw) : 0n;
  const { can } = useSession();
  const [rev, setRev] = useState(false);
  const what = useWhat();
  const names = useNames();
  const { data, error } = useFetch(() => getConn().procedures.adminFriendGift({ id }), [String(id)]);
  const g = data?.row.gift;
  const rtl = useLocale() === 'fa';
  return (
    <main className="page" data-testid="page-friend-gift">
      <a href="#/friend-gifts" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} data-testid="fgd-back">
        <ArrowRight className="ic" style={{ transform: rtl ? undefined : 'scaleX(-1)' }} />
        {t('navFriendGifts')}
      </a>
      <PageHead
        title={t('fgGiftNo', { id: digits(String(id)) })}
        sub={g ? what(g) : error ? undefined : <Skel w={120} h={10} />}
        action={
          g &&
          can('admin') &&
          (g.status === 'pending' || g.status === 'delivered') && (
            <button type="button" className="btn btn-danger-ghost" onClick={() => setRev(true)} data-testid="fgd-reverse">
              <ArrowCounterClockwise className="ic" />
              {t('fgReverse')}
            </button>
          )
        }
      />
      <ErrBox text={error ? errorText(error) : null} />
      {!data || !g ? (
        !error && (
          <div className="sg-detail">
            <Skel h={260} r={8} />
            <Skel h={260} r={8} />
          </div>
        )
      ) : (
        <div className="sg-detail">
          <Section title={t('fgDetails')} testId="fgd-details">
            <dl className="kv">
              <Kv label={t('status')}>
                <span className="row" style={{ gap: 6 }}>
                  <StatusBadge status={g.status} testId="fgd-status" />
                  <OutcomeText outcome={g.outcome} />
                </span>
              </Kv>
              <Kv label={t('fgSender')}>
                <Who id={g.senderId} name={data.row.senderName} />
              </Kv>
              <Kv label={t('fgRecipient')}>
                <Who id={g.recipientId} name={data.row.recipientName} />
              </Kv>
              <Kv label={t('fgKind')}>{kindText(g.kind)}</Kv>
              <Kv label={t('fgWhat')}>{what(g)}</Kv>
              {g.kind === 'item' && g.itemLevel > 0 && <Kv label={t('fgItemLevel')}>{num(g.itemLevel)}</Kv>}
              {g.kind === 'product' && (
                <>
                  <Kv label={t('fgMethod')}>{methodText(g.method) || '—'}</Kv>
                  {g.coinAmount > 0n && <Kv label={t('fgPrice')}>{priceText(g, names)}</Kv>}
                  {g.paymentId > 0n && <Kv label={t('fgPayment')}>#{digits(String(g.paymentId))}</Kv>}
                </>
              )}
              <Kv label={t('fgDeliveryMode')}>{g.delivery === 'accept' ? t('fgDeliveryAccept') : t('fgDeliveryInstant')}</Kv>
              <Kv label={t('fgMessage')}>
                {g.message ? <span className={g.messageFlagged ? 'neg' : undefined}>{g.message}</span> : '—'}
                {g.messageFlagged && <span className="badge b-warn sg-inline-badge">{t('fgFlagged')}</span>}
              </Kv>
              <Kv label={t('fgSentAt')}>{when(g.createdAt)}</Kv>
              {g.expiresAt > 0n && <Kv label={t('fgExpiresAt')}>{usText(g.expiresAt)}</Kv>}
              {g.deliveredAt > 0n && <Kv label={t('fgDeliveredAt')}>{usText(g.deliveredAt)}</Kv>}
              {g.respondedAt > 0n && <Kv label={t('fgRespondedAt')}>{usText(g.respondedAt)}</Kv>}
              {g.reversedAt > 0n && (
                <>
                  <Kv label={t('fgReversedAt')}>{usText(g.reversedAt)}</Kv>
                  <Kv label={t('fgReversedBy')}>#{digits(String(g.reversedBy))}</Kv>
                  {g.reverseNote && <Kv label={t('note')}>{g.reverseNote}</Kv>}
                </>
              )}
              {g.error && (
                <Kv label={t('fgError')}>
                  <span className="neg">{codeText(g.error)}</span>
                </Kv>
              )}
              {g.requestId && (
                <Kv label={t('fgRequestId')}>
                  <span className="mono">{g.requestId}</span>
                </Kv>
              )}
            </dl>
          </Section>
          <Section title={t('fgTrail')} pad={false} testId="fgd-trail">
            {data.trail.length === 0 ? (
              <Empty icon={<ShieldCheck className="ic" weight="duotone" />} title={t('fgNoTrail')} />
            ) : (
              <div className="list">
                {data.trail.map((r, i) => (
                  <div className="list-row" key={i} data-testid={`fgd-trail-${i}`}>
                    <div className="list-main">
                      <span className="list-title">{actionLabel(r.action)}</span>
                      <span className="list-sub">
                        {r.accountId === g.senderId ? t('fgSender') : r.accountId === g.recipientId ? t('fgRecipient') : t('fgStaff')} #{digits(String(r.accountId))} · {when(r.at)}
                      </span>
                      {r.detail && <span className="list-sub mono ltr sg-detail-text">{r.detail}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
      {rev && g && <ReverseDialog g={g} onClose={() => setRev(false)} />}
    </main>
  );
}

function CountList(props: { list: { key: string; count: number }[]; label: (k: string) => ReactNode; testId: string }) {
  const total = props.list.reduce((a, b) => a + b.count, 0);
  if (!props.list.length) return <Empty icon={<Gift className="ic" weight="duotone" />} title={t('qoNoData')} />;
  return (
    <div className="stack stack-sm" data-testid={props.testId}>
      {[...props.list]
        .sort((a, b) => b.count - a.count)
        .map(x => (
          <div className="sg-meter" key={x.key} data-testid={`${props.testId}-${x.key}`}>
            <span className="sg-meter-label">{props.label(x.key)}</span>
            <span className="sg-meter-track">
              <span style={{ width: `${Math.max(2, (x.count / Math.max(total, 1)) * 100)}%` }} />
            </span>
            <span className="sg-meter-value">{num(x.count)}</span>
          </div>
        ))}
    </div>
  );
}

export function GiftReport(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const [days, setDays] = useDaysQuery('gift-report');
  const { data, error } = useFetch(() => getConn().procedures.adminFriendGiftReport({ days }), [days]);
  const series = data ? fillDays(data.daily, tehranToday(), days, day => ({ day, count: 0 })) : null;
  return (
    <main className="page" data-testid="page-gift-report">
      <PageHead title={t('navGiftReport')} sub={t('fgReportSub')} action={<DaysSeg value={days} onChange={setDays} />} />
      <ErrBox text={error ? errorText(error) : null} />
      <Tiles
        prefix="grp"
        n={6}
        list={
          data
            ? [
                [t('fgTTotal'), num(data.total)],
                [t('fgTSenders'), num(data.senders)],
                [t('fgTRecipients'), num(data.recipients)],
                [t('fgTCurrency'), num(data.currencyMoved), t('fgTCurrencyHint')],
                [t('fgTCoins'), num(data.coinsSpent)],
                [t('fgTMoney'), toman(data.moneyToman)],
              ]
            : null
        }
      />
      <Section title={t('fgDaily')} testId="grp-chart">
        {!series ? (
          <Skel h={160} r={6} />
        ) : series.every(d => !d.count) ? (
          <Empty icon={<ChartBar className="ic" weight="duotone" />} title={t('qoNoData')} />
        ) : (
          <BarChart label={t('fgDaily')} days={series.map(d => ({ day: d.day, value: d.count, title: num(d.count) }))} />
        )}
      </Section>
      <div className="sg-grid">
        <Section title={t('fgByStatus')} testId="grp-status">
          {!data ? <Skel h={120} r={6} /> : <CountList list={data.byStatus} label={k => <StatusBadge status={k} />} testId="grp-status-list" />}
        </Section>
        <Section title={t('fgByKind')} testId="grp-kind">
          {!data ? <Skel h={120} r={6} /> : <CountList list={data.byKind} label={k => kindText(k)} testId="grp-kind-list" />}
        </Section>
        <Section title={t('fgTopSenders')} pad={false} testId="grp-senders">
          {!data ? (
            <div className="card-pad">
              <Skel h={60} r={6} />
            </div>
          ) : (
            <TopTable rows={data.topSenders} label={t('fgGiftsCol')} testId="grp-senders-table" />
          )}
        </Section>
        <Section title={t('fgTopRecipients')} pad={false} testId="grp-recipients">
          {!data ? (
            <div className="card-pad">
              <Skel h={60} r={6} />
            </div>
          ) : (
            <TopTable rows={data.topRecipients} label={t('fgGiftsCol')} testId="grp-recipients-table" />
          )}
        </Section>
      </div>
    </main>
  );
}

