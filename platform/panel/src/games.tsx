import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowSquareOut, Clock, Code, Cube, GameController, HardDrives, Lightning, ListChecks, Robot, UsersThree, Wrench, X } from '@phosphor-icons/react';
import { Identity } from 'spacetimedb';
import { getConn, useRows, type RowOf } from './conn.ts';
import { codeText, digits, errorText, latin, num, t, useLocale, type ErrInfo, type StrKey } from './i18n.ts';
import { go, pageQuery, run, toast, trText, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Empty, ErrBox, Field, Notice, NumInput, SaveButton, Seg, Skel, Switch, SwitchRow, TrInputs } from './ui.tsx';
import { BigInput, FloatInput, Section, TagPicker, when } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, PageHead, del, needTitle, save } from './economy.tsx';
import { CatalogTable, Choice, IdPick, KeyPick, Rows, useLoaded } from './kit.tsx';
import { CategoryPicker } from './dialogs.tsx';
import { TestClock } from './settings3.tsx';
import './games.css';

type GameRow = RowOf<'adminGames'>;
type RoomRow = RowOf<'adminGameRooms'>;
type ServerRow = RowOf<'adminGameServers'>;
type Req = GameRow['requirements'];
type GameArgs = Parameters<ReturnType<typeof getConn>['reducers']['adminSaveGame']>[0];
type RoomArgs = Parameters<ReturnType<typeof getConn>['reducers']['adminSaveGameRoom']>[0];
type ProductRow = Awaited<ReturnType<ReturnType<typeof getConn>['procedures']['adminProducts']>>['rows'][number];

const LRI = '⁦';
const PDI = '⁩';
const iso = (s: string) => `${LRI}${s}${PDI}`;

const PATHS: [string, StrKey][] = [
  ['matchmaking', 'gclPathMatch'],
  ['bot', 'gclPathBot'],
  ['friend', 'gclPathFriend'],
];

const OPS: [string, StrKey][] = [
  ['gte', 'gclOpGte'],
  ['gt', 'gclOpGt'],
  ['eq', 'gclOpEq'],
  ['lte', 'gclOpLte'],
  ['lt', 'gclOpLt'],
];

const PLATFORMS: [string, StrKey][] = [
  ['android', 'plAndroid'],
  ['ios', 'plIos'],
  ['web', 'plWeb'],
  ['windows', 'plWindows'],
  ['macos', 'plMacos'],
  ['linux', 'plLinux'],
];

const WEEK: [string, StrKey][] = [
  ['6', 'dSat'],
  ['0', 'dSun'],
  ['1', 'dMon'],
  ['2', 'dTue'],
  ['3', 'dWed'],
  ['4', 'dThu'],
  ['5', 'dFri'],
];

const TABS: [string, StrKey][] = [
  ['general', 'gclTabGeneral'],
  ['maintenance', 'gclTabMaintenance'],
  ['matchmaking', 'gclTabMatchmaking'],
  ['settings', 'gclTabSettings'],
  ['requirements', 'gclTabRequirements'],
  ['rooms', 'gclTabRooms'],
];

export function emptyReq(): Req {
  return { itemKeys: [], itemsMode: 'any', consumeItems: false, tagIds: [], tagsMode: 'any', excludeTagIds: [], minLevel: 0, metas: [], productIds: [], paths: [], refund: 'return', lock: 'show', message: [] };
}

function reqCopy(r: Req): Req {
  return { ...r, itemKeys: [...r.itemKeys], tagIds: [...r.tagIds], excludeTagIds: [...r.excludeTagIds], metas: r.metas.map(m => ({ ...m })), productIds: [...r.productIds], paths: [...r.paths], message: [...r.message] };
}

function reqCount(r: Req) {
  return (r.itemKeys.length ? 1 : 0) + (r.tagIds.length ? 1 : 0) + (r.excludeTagIds.length ? 1 : 0) + (r.minLevel ? 1 : 0) + r.metas.length;
}

function canon(s: string) {
  try {
    return JSON.stringify(JSON.parse(s || '{}'));
  } catch {
    return s;
  }
}

function formKey(v: GameArgs) {
  return stable({ ...v, settings: canon(v.settings) });
}

function stable(v: unknown) {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? `${x}n` : x));
}

function gameArgs(g: GameRow): GameArgs {
  return {
    id: g.id,
    key: g.key,
    name: [...g.name],
    description: [...g.description],
    iconUrl: g.iconUrl,
    isActive: g.isActive,
    maintenance: g.maintenance,
    maintenanceMessage: [...g.maintenanceMessage],
    sort: g.sort,
    categoryId: g.categoryId,
    tagIds: [...g.tagIds],
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    turnSeconds: g.turnSeconds,
    matchSeconds: g.matchSeconds,
    botsAllowed: g.botsAllowed,
    botAfterSeconds: g.botAfterSeconds,
    friendAllowed: g.friendAllowed,
    platforms: [...g.platforms],
    minVersions: g.minVersions.map(x => ({ ...x })),
    skillMetaKey: g.skillMetaKey,
    bandSize: g.bandSize,
    widenEverySeconds: g.widenEverySeconds,
    widenStep: g.widenStep,
    maxBand: g.maxBand,
    fillAfterSeconds: g.fillAfterSeconds,
    settings: g.settings || '{}',
    requirements: reqCopy(g.requirements),
  };
}

function newGameArgs(key: string, name: Tr[], minPlayers: number, maxPlayers: number): GameArgs {
  return {
    id: 0n,
    key,
    name,
    description: [],
    iconUrl: '',
    isActive: true,
    maintenance: false,
    maintenanceMessage: [],
    sort: 0,
    categoryId: 0n,
    tagIds: [],
    minPlayers,
    maxPlayers,
    turnSeconds: 0,
    matchSeconds: 0,
    botsAllowed: false,
    botAfterSeconds: 20,
    friendAllowed: true,
    platforms: [],
    minVersions: [],
    skillMetaKey: '',
    bandSize: 3,
    widenEverySeconds: 10,
    widenStep: 2,
    maxBand: 0,
    fillAfterSeconds: 30,
    settings: '{}',
    requirements: emptyReq(),
  };
}

type Sch = {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Sch>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Sch;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  default?: unknown;
};

function parseSchema(raw: string): Sch | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Sch;
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

function defaultsOf(s: Sch | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s?.properties ?? {})) if (v.default !== undefined) out[k] = v.default;
  return out;
}

function typeOk(type: string | undefined, v: unknown) {
  if (!type) return true;
  if (type === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v);
  if (type === 'array') return Array.isArray(v);
  if (type === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === type;
}

function collect(s: Sch, v: unknown, path: string, out: Record<string, string>) {
  const at = path || '$';
  if (!typeOk(s.type, v)) {
    out[at] = 'type';
    return;
  }
  if (s.enum && !s.enum.some(e => JSON.stringify(e) === JSON.stringify(v))) out[at] = 'enum';
  else if (typeof v === 'number' && s.minimum !== undefined && v < s.minimum) out[at] = 'minimum';
  else if (typeof v === 'number' && s.maximum !== undefined && v > s.maximum) out[at] = 'maximum';
  else if (typeof v === 'string' && s.minLength !== undefined && [...v].length < s.minLength) out[at] = 'minLength';
  else if (typeof v === 'string' && s.maxLength !== undefined && [...v].length > s.maxLength) out[at] = 'maxLength';
  else if (typeof v === 'string' && s.pattern && !safeTest(s.pattern, v)) out[at] = 'pattern';
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out[at] = 'minItems';
    else if (s.maxItems !== undefined && v.length > s.maxItems) out[at] = 'maxItems';
    if (s.items) v.forEach((x, i) => collect(s.items!, x, `${path}[${i}]`, out));
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in o)) out[`${path ? `${path}.` : ''}${r}`] = 'required';
    for (const [k, val] of Object.entries(o)) {
      const sub = s.properties?.[k];
      const p = path ? `${path}.${k}` : k;
      if (!sub) {
        if (s.additionalProperties === false) out[p] = 'unknown';
        continue;
      }
      collect(sub, val, p, out);
    }
  }
}

function safeTest(pattern: string, v: string) {
  try {
    return new RegExp(pattern).test(v);
  } catch {
    return true;
  }
}

function nodeAt(s: Sch | null, path: string): Sch | undefined {
  if (!s || !path || path === '$') return s ?? undefined;
  let cur: Sch | undefined = s;
  for (const part of path.split('.')) {
    const m = part.match(/^([^[]*)((?:\[\d+\])*)$/);
    if (!m || !cur) return undefined;
    if (m[1]) cur = cur.properties?.[m[1]];
    const depth = (m[2].match(/\[/g) ?? []).length;
    for (let i = 0; i < depth && cur; i++) cur = cur.items;
  }
  return cur;
}

function ruleOnly(rule: string, node: Sch | undefined) {
  const n = (x: number | undefined) => (x === undefined ? '' : num(x));
  if (rule === 'minimum') return t('gclRuleMin', { n: n(node?.minimum) });
  if (rule === 'maximum') return t('gclRuleMax', { n: n(node?.maximum) });
  if (rule === 'minLength') return t('gclRuleMinLen', { n: n(node?.minLength) });
  if (rule === 'maxLength') return t('gclRuleMaxLen', { n: n(node?.maxLength) });
  if (rule === 'minItems') return t('gclRuleMinItems', { n: n(node?.minItems) });
  if (rule === 'maxItems') return t('gclRuleMaxItems', { n: n(node?.maxItems) });
  if (rule === 'pattern') return t('gclRulePattern', { p: iso(node?.pattern ?? '') });
  if (rule === 'enum') return t('gclRuleEnum', { list: (node?.enum ?? []).map(x => iso(String(x))).join('، ') });
  if (rule === 'required') return t('gclRuleRequired');
  if (rule === 'unknown') return t('gclRuleUnknown');
  if (rule === 'json') return t('gclRuleJson');
  if (rule === 'type') return t(node?.type === 'integer' ? 'gclRuleInteger' : node?.type === 'number' ? 'gclRuleNumber' : 'gclRuleType');
  return t('gclRuleOther', { r: iso(rule) });
}

function settingsErrText(path: string, rule: string, schema: Sch | null) {
  const node = nodeAt(schema, path);
  const field = path === '$' || !path ? t('gclSetRoot') : iso(node?.title ?? path);
  return t('gclSetErr', { field, rule: ruleOnly(rule, node) });
}

function parseSettingsErr(raw: string) {
  const m = raw.match(/INVALID_SETTINGS:([^\s:]*):(\w+)/);
  return m ? { path: m[1], rule: m[2] } : null;
}

function gameErr(info: ErrInfo, schema: Sch | null) {
  const s = parseSettingsErr(info.raw);
  if (s) return settingsErrText(s.path, s.rule, schema);
  if (info.field === 'requirements') return t('gclReqErr', { e: codeText(info.code) });
  if (info.field === 'room.requirements') return t('gclRoomReqErr', { e: codeText(info.code) });
  return errorText(info);
}

function settingsHint(s: Sch) {
  const parts: string[] = [];
  if (s.minimum !== undefined && s.maximum !== undefined) parts.push(t('gclRange', { a: num(s.minimum), b: num(s.maximum) }));
  else if (s.minimum !== undefined) parts.push(t('gclRuleMin', { n: num(s.minimum) }));
  else if (s.maximum !== undefined) parts.push(t('gclRuleMax', { n: num(s.maximum) }));
  if (s.minLength !== undefined || s.maxLength !== undefined) parts.push(t('gclLenRange', { a: num(s.minLength ?? 0), b: s.maxLength === undefined ? '∞' : num(s.maxLength) }));
  if (s.pattern) parts.push(t('gclRulePattern', { p: iso(s.pattern) }));
  if (s.default !== undefined) parts.push(t('gclDefault', { v: defaultText(s.default) }));
  return parts.join(' · ');
}

function defaultText(v: unknown) {
  if (typeof v === 'boolean') return v ? t('yes') : t('no');
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return iso(v);
  return iso(JSON.stringify(v));
}

function SNum(props: { value: unknown; onChange: (v: unknown) => void; name: string; placeholder?: string; invalid?: boolean }) {
  const l = useLocale();
  const show = (v: unknown) => (v === undefined ? '' : digits(String(v), l));
  const [text, setText] = useState(show(props.value));
  useEffect(() => {
    const cur = latin(text).replace('٫', '.').trim();
    if (cur === '' ? props.value !== undefined : String(Number(cur)) !== String(props.value) && cur !== String(props.value)) setText(show(props.value));
  }, [props.value, l]);
  return (
    <input
      className="input ltr"
      style={{ textAlign: 'start' }}
      inputMode="decimal"
      name={props.name}
      value={text}
      placeholder={props.placeholder}
      aria-invalid={props.invalid || undefined}
      onChange={e => {
        setText(e.target.value);
        const raw = latin(e.target.value).replace('٫', '.').trim();
        if (raw === '') props.onChange(undefined);
        else if (/^-?\d+(\.\d+)?$/.test(raw)) props.onChange(Number(raw));
        else props.onChange(raw);
      }}
    />
  );
}

function JsonBox(props: { value: unknown; onChange: (v: unknown) => void; name: string }) {
  const [text, setText] = useState(props.value === undefined ? '' : JSON.stringify(props.value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <>
      <textarea
        className="textarea ltr mono"
        rows={4}
        name={props.name}
        value={text}
        onChange={e => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            props.onChange(undefined);
            return;
          }
          try {
            props.onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && <span className="field-err">{t('gclRuleJson')}</span>}
    </>
  );
}

function primitive(s: Sch | undefined) {
  return !!s && ['string', 'number', 'integer', 'boolean'].includes(s.type ?? '');
}

function PrimInput(props: { s: Sch; value: unknown; onChange: (v: unknown) => void; name: string; invalid?: boolean; label: string }) {
  const s = props.s;
  if (s.type === 'boolean') return <Switch checked={props.value === true} onChange={props.onChange} label={props.label} testId={props.name} />;
  if (s.type === 'string' && s.enum) {
    return (
      <select className="select" name={props.name} value={props.value === undefined ? '' : String(props.value)} onChange={e => props.onChange(e.target.value === '' ? undefined : e.target.value)} aria-label={props.label}>
        <option value="">{s.default !== undefined ? t('gclUseDefault', { v: iso(String(s.default)) }) : '—'}</option>
        {s.enum.map(o => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  }
  if (s.type === 'integer' || s.type === 'number') return <SNum value={props.value} onChange={props.onChange} name={props.name} placeholder={s.default !== undefined ? digits(String(s.default)) : undefined} invalid={props.invalid} />;
  return (
    <input
      className="input ltr"
      name={props.name}
      value={props.value === undefined ? '' : String(props.value)}
      placeholder={typeof s.default === 'string' ? s.default : undefined}
      maxLength={s.maxLength}
      aria-invalid={props.invalid || undefined}
      aria-label={props.label}
      onChange={e => props.onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  );
}

function SchemaProps(props: { s: Sch; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; path: string; errs: Record<string, string>; schema: Sch | null }) {
  const entries = Object.entries(props.s.properties ?? {});
  const set = (k: string, v: unknown) => {
    const next = { ...props.value };
    if (v === undefined) delete next[k];
    else next[k] = v;
    props.onChange(next);
  };
  if (!entries.length) return <span className="small muted">{t('gclSetNoProps')}</span>;
  return (
    <div className="form-grid">
      {entries.map(([k, sub]) => (
        <SchemaProp key={k} k={k} s={sub} value={props.value[k]} onChange={v => set(k, v)} path={props.path ? `${props.path}.${k}` : k} errs={props.errs} schema={props.schema} required={props.s.required?.includes(k)} />
      ))}
    </div>
  );
}

function SchemaProp(props: { k: string; s: Sch; value: unknown; onChange: (v: unknown) => void; path: string; errs: Record<string, string>; schema: Sch | null; required?: boolean }) {
  const s = props.s;
  const label = (
    <>
      <bdi>{s.title ?? props.k}</bdi>
      {s.title && <span className="mono muted gcl-key"> {props.k}</span>}
    </>
  );
  const err = props.errs[props.path];
  const errText = err ? ruleOnly(err, s) : undefined;
  const hint = [s.description, settingsHint(s)].filter(Boolean).join(' · ') || undefined;
  const name = `set-${props.path}`;
  if (s.type === 'object') {
    const v = props.value && typeof props.value === 'object' && !Array.isArray(props.value) ? (props.value as Record<string, unknown>) : {};
    return (
      <fieldset className="gcl-fieldset span-2" data-testid={name}>
        <legend>{label}</legend>
        {s.description && <span className="hint">{s.description}</span>}
        <SchemaProps s={s} value={v} onChange={x => props.onChange(Object.keys(x).length ? x : undefined)} path={props.path} errs={props.errs} schema={props.schema} />
        {errText && <span className="field-err">{errText}</span>}
      </fieldset>
    );
  }
  if (s.type === 'array' && primitive(s.items)) {
    const list = Array.isArray(props.value) ? props.value : [];
    const item = s.items!;
    const blank = () => (item.default !== undefined ? item.default : item.type === 'boolean' ? false : item.type === 'string' ? '' : 0);
    return (
      <Field label={label} hint={hint} error={errText} className="span-2" required={props.required}>
        <Rows
          rows={list.map(v => ({ v }))}
          onChange={rows => props.onChange(rows.map(r => r.v))}
          make={() => ({ v: blank() })}
          max={s.maxItems}
          testId={name}
          addLabel={t('gclAddValue')}
          cols={[
            {
              label: t('gclValue'),
              width: 'minmax(0, 1fr)',
              render: (r, set, i) => (
                <>
                  <PrimInput s={item} value={r.v} onChange={v => set({ v })} name={`${name}-${i}`} invalid={!!props.errs[`${props.path}[${i}]`]} label={t('gclValue')} />
                  {props.errs[`${props.path}[${i}]`] && <span className="field-err">{ruleOnly(props.errs[`${props.path}[${i}]`], item)}</span>}
                </>
              ),
            },
          ]}
        />
      </Field>
    );
  }
  if (!primitive(s)) {
    return (
      <Field label={label} hint={hint ?? t('gclJsonHint')} error={errText} className="span-2" required={props.required}>
        <JsonBox value={props.value} onChange={props.onChange} name={name} />
      </Field>
    );
  }
  if (s.type === 'boolean') {
    return (
      <Field label={label} hint={hint} error={errText} required={props.required}>
        <span className="row" style={{ minHeight: 36 }}>
          <PrimInput s={s} value={props.value ?? s.default} onChange={props.onChange} name={name} label={s.title ?? props.k} />
        </span>
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint} error={errText} required={props.required}>
      <PrimInput s={s} value={props.value} onChange={props.onChange} name={name} invalid={!!err} label={s.title ?? props.k} />
    </Field>
  );
}

function settingsState(text: string, schema: Sch | null, raw: boolean) {
  let obj: unknown;
  try {
    obj = JSON.parse(text.trim() || '{}');
  } catch {
    return { obj: null, errs: { $: 'json' } as Record<string, string> };
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return { obj: null, errs: { $: 'type' } as Record<string, string> };
  const errs: Record<string, string> = {};
  if (schema && !raw) collect(schema, { ...defaultsOf(schema), ...(obj as Record<string, unknown>) }, '', errs);
  return { obj: obj as Record<string, unknown>, errs };
}

function SettingsTab(props: { game: GameRow; value: string; onChange: (v: string) => void; raw: boolean; setRaw: (v: boolean) => void; serverErr: { path: string; rule: string } | null; ro: boolean }) {
  const schema = parseSchema(props.game.settingsSchema);
  const st = settingsState(props.value, schema, props.raw);
  const errs = { ...st.errs, ...(props.serverErr && !st.errs[props.serverErr.path] ? { [props.serverErr.path || '$']: props.serverErr.rule } : {}) };
  const [rawErr, setRawErr] = useState<string | null>(null);
  const list = Object.entries(errs);
  return (
    <div className="stack" data-testid="gm-settings">
      <Section
        title={t('gclSetTitle')}
        action={
          <SwitchRow
            checked={props.raw}
            label={t('gclRawJson')}
            testId="gm-raw"
            onChange={v => {
              if (!v && settingsState(props.value, schema, true).obj === null) {
                setRawErr(t('gclRawBad'));
                return;
              }
              setRawErr(null);
              if (v) {
                try {
                  props.onChange(JSON.stringify(JSON.parse(props.value || '{}'), null, 2));
                } catch {
                  props.onChange(props.value);
                }
              }
              props.setRaw(v);
            }}
          />
        }
      >
        <div className="stack">
          {schema ? (
            <span className="small sub">{t('gclSetFromCode', { name: iso(props.game.codeName || props.game.key) })}</span>
          ) : (
            <Notice kind="plain" icon={<Code className="ic" />} text={t('gclSetNoSchema')} />
          )}
          {list.length > 0 && (
            <div className="err-box" role="alert" data-testid="gm-settings-errors">
              <span className="stack" style={{ gap: 2 }}>
                {list.map(([p, r]) => (
                  <span key={p}>{settingsErrText(p, r, schema)}</span>
                ))}
              </span>
            </div>
          )}
          <ErrBox text={rawErr} />
          {props.raw || !schema ? (
            <Field label={t('gclRawJson')} hint={props.raw ? t('gclRawHint') : undefined}>
              <textarea className="textarea ltr mono gcl-json" rows={10} name="settingsRaw" value={props.value} onChange={e => props.onChange(e.target.value)} disabled={props.ro} spellCheck={false} />
            </Field>
          ) : (
            <SchemaProps s={schema} value={st.obj ?? {}} onChange={v => props.onChange(JSON.stringify(v))} path="" errs={errs} schema={schema} />
          )}
        </div>
      </Section>
    </div>
  );
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

function PickList(props: { value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; testId: string; empty: string; add: string }) {
  const left = props.options.filter(o => !props.value.includes(o.value));
  const label = (k: string) => props.options.find(o => o.value === k)?.label ?? k;
  return (
    <div className="stack stack-sm" data-testid={props.testId}>
      <div className="chips">
        {props.value.length === 0 && <span className="small muted">{props.empty}</span>}
        {props.value.map(k => (
          <span className="chip" key={k} data-testid={`${props.testId}-${k}`}>
            <bdi>{label(k)}</bdi>
            <button type="button" className="gcl-chip-x" onClick={() => props.onChange(props.value.filter(x => x !== k))} aria-label={t('delete')} title={t('delete')}>
              <X className="ic" />
            </button>
          </span>
        ))}
      </div>
      {left.length > 0 && (
        <select className="select" value="" onChange={e => e.target.value && props.onChange([...props.value, e.target.value])} aria-label={props.add} data-testid={`${props.testId}-add`}>
          <option value="">{props.add}</option>
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

function UserTags(props: { value: bigint[]; onChange: (v: bigint[]) => void; testId: string; other?: bigint[] }) {
  const tags = useRows('tag')
    .filter(x => x.keyType === 'user')
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const { def } = useLanguages();
  const opts = tags.filter(x => !props.other?.includes(x.id) || props.value.includes(x.id)).map(x => ({ value: String(x.id), label: trText(x.title, def) || x.key }));
  return <PickList value={props.value.map(String)} onChange={v => props.onChange(v.map(BigInt))} options={opts} testId={props.testId} empty={tags.length ? t('gclReqNoTags') : t('gclNoUserTags')} add={t('gclReqAddTag')} />;
}

function ModeSeg(props: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Seg
      value={props.value || 'any'}
      onChange={props.onChange}
      label={props.label}
      options={[
        { value: 'any', label: t('gclModeAny') },
        { value: 'all', label: t('gclModeAll') },
      ]}
    />
  );
}

export function RequirementsEditor(props: { value: Req; onChange: (v: Req) => void; prefix: string; room?: boolean }) {
  const v = props.value;
  const up = (p: Partial<Req>) => props.onChange({ ...v, ...p });
  const items = useRows('item');
  const { def } = useLanguages();
  const products = useProducts();
  const itemOpts = [...items].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)).map(x => ({ value: x.key, label: trText(x.name, def) || x.key }));
  const productOpts = products.map(x => ({ value: String(x.id), label: trText(x.name, def) || x.key }));
  const allPaths = v.paths.length === 0;
  const pathOn = (p: string) => allPaths || v.paths.includes(p);
  const togglePath = (p: string) => {
    const cur = allPaths ? PATHS.map(x => x[0]) : v.paths;
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p];
    if (!next.length) return;
    up({ paths: next.length === PATHS.length ? [] : next });
  };
  const p = props.prefix;
  return (
    <div className="stack" data-testid={p}>
      <Section title={t('gclReqWhen')}>
        <div className="form-grid">
          <Field label={t('gclReqPaths')} hint={allPaths ? t('gclReqPathsAll') : t('gclReqPathsSome')} className="span-2">
            <div className="chips" data-testid={`${p}-paths`}>
              {PATHS.map(([k, l]) => (
                <button type="button" key={k} className="chip chip-btn" aria-pressed={pathOn(k)} onClick={() => togglePath(k)} data-testid={`${p}-path-${k}`}>
                  {t(l)}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('gclReqMinLevel')} hint={t('gclZeroNone')}>
            <NumInput value={v.minLevel} onChange={x => up({ minLevel: Math.max(0, x) })} name={`${p}-minLevel`} />
          </Field>
        </div>
      </Section>
      <Section title={t('gclReqItems')}>
        <div className="form-grid">
          <Field label={t('gclReqItemList')} className="span-2">
            <PickList value={v.itemKeys} onChange={x => up({ itemKeys: x })} options={itemOpts} testId={`${p}-items`} empty={t('gclReqNoItems')} add={t('gclReqAddItem')} />
          </Field>
          {v.itemKeys.length > 1 && (
            <Field label={t('gclReqItemsMode')}>
              <ModeSeg value={v.itemsMode} onChange={x => up({ itemsMode: x })} label={t('gclReqItemsMode')} />
            </Field>
          )}
          {v.itemKeys.length > 0 && (
            <div className="span-2 stack" style={{ gap: 2 }}>
              <SwitchRow checked={v.consumeItems} onChange={x => up({ consumeItems: x })} label={t('gclReqConsumeItems')} testId={`${p}-consume-items`} />
              <span className="hint">{t('gclReqConsumeItemsHint')}</span>
            </div>
          )}
        </div>
      </Section>
      <Section title={t('gclReqTags')}>
        <div className="form-grid">
          <Field label={t('gclReqTagsIn')} className="span-2">
            <UserTags value={v.tagIds} onChange={x => up({ tagIds: x })} testId={`${p}-in`} other={v.excludeTagIds} />
          </Field>
          {v.tagIds.length > 1 && (
            <Field label={t('gclReqTagsMode')}>
              <ModeSeg value={v.tagsMode} onChange={x => up({ tagsMode: x })} label={t('gclReqTagsMode')} />
            </Field>
          )}
          <Field label={t('gclReqTagsOut')} hint={t('gclReqTagsOutHint')} className="span-2">
            <UserTags value={v.excludeTagIds} onChange={x => up({ excludeTagIds: x })} testId={`${p}-ex`} other={v.tagIds} />
          </Field>
        </div>
      </Section>
      <Section title={t('gclReqMetas')}>
        <div className="stack stack-sm">
          <span className="small sub">{t('gclReqMetasHint')}</span>
          <Rows
            rows={v.metas}
            onChange={x => up({ metas: x })}
            max={10}
            testId={`${p}-metas`}
            addLabel={t('gclReqAddMeta')}
            make={() => ({ metaKey: '', operator: 'gte', value: 1, consume: 0 })}
            cols={[
              { label: t('gclReqMeta'), width: 'minmax(0, 2fr)', render: (r, set, i) => <KeyPick kind="meta" value={r.metaKey} onChange={x => set({ metaKey: x })} none={t('gclPick')} testId={`${p}-metas-${i}-key`} label={t('gclReqMeta')} /> },
              { label: t('gclReqOp'), width: 'minmax(0, 1.3fr)', render: (r, set, i) => <Choice value={r.operator} onChange={x => set({ operator: x })} options={OPS} testId={`${p}-metas-${i}-op`} label={t('gclReqOp')} /> },
              { label: t('gclValue'), width: 'minmax(0, 1fr)', render: (r, set) => <FloatInput value={r.value} onChange={x => set({ value: x })} name="metaValue" /> },
              { label: t('gclReqConsume'), width: 'minmax(0, 1fr)', render: (r, set) => <FloatInput value={r.consume} onChange={x => set({ consume: x })} name="metaConsume" /> },
            ]}
          />
          {v.metas.some(m => m.consume > 0) && <span className="hint">{t('gclReqConsumeHint')}</span>}
        </div>
      </Section>
      <Section title={t('gclReqRefusal')}>
        <div className="form-grid">
          <Field label={t('gclReqRefund')} hint={v.refund === 'keep' ? t('gclReqRefundKeepHint') : t('gclReqRefundReturnHint')}>
            <Seg
              value={v.refund || 'return'}
              onChange={x => up({ refund: x })}
              label={t('gclReqRefund')}
              options={[
                { value: 'return', label: t('gclReqRefundReturn') },
                { value: 'keep', label: t('gclReqRefundKeep') },
              ]}
            />
          </Field>
          <Field label={t('gclReqLock')} hint={v.lock === 'hide' ? t('gclReqLockHideHint') : t('gclReqLockShowHint')}>
            <Seg
              value={v.lock || 'show'}
              onChange={x => up({ lock: x })}
              label={t('gclReqLock')}
              options={[
                { value: 'show', label: t('gclReqLockShow') },
                { value: 'hide', label: t('gclReqLockHide') },
              ]}
            />
          </Field>
          <Field label={t('gclReqProducts')} hint={t('gclReqProductsHint')} className="span-2">
            <PickList value={v.productIds.map(String)} onChange={x => up({ productIds: x.map(BigInt) })} options={productOpts} testId={`${p}-products`} empty={t('gclReqAutoProducts')} add={t('gclReqAddProduct')} />
          </Field>
          <Field label={t('gclReqMessage')} hint={t('gclReqMessageHint')} className="span-2">
            <TrInputs value={v.message} onChange={x => up({ message: x })} multiline name={`${p}-message`} />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function GameIcon(props: { url: string; size?: number }) {
  const [bad, setBad] = useState(false);
  const s = props.size ?? 32;
  return (
    <span className="gcl-icon" style={{ width: s, height: s }}>
      {props.url && !bad ? <img src={props.url} alt="" onError={() => setBad(true)} /> : <GameController className="ic" weight="duotone" />}
    </span>
  );
}

function RegBadge(props: { on: boolean }) {
  return props.on ? <span className="badge b-info">{t('gclRegistered')}</span> : <span className="badge b-warn">{t('gclUnregistered')}</span>;
}

function players(min: number, max: number) {
  return min === max ? digits(min) : t('gclRange', { a: min, b: max });
}

function PathFlags(props: { g: GameRow }) {
  return (
    <span className="chips">
      <span className="chip">{t('gclPathMatch')}</span>
      {props.g.botsAllowed && (
        <span className="chip">
          <Robot className="ic" />
          {t('gclPathBot')}
        </span>
      )}
      {props.g.friendAllowed && (
        <span className="chip">
          <UsersThree className="ic" />
          {t('gclPathFriend')}
        </span>
      )}
    </span>
  );
}

function NewGameDialog(props: { onClose: () => void }) {
  const { def } = useLanguages();
  const [key, setKey] = useState('');
  const [name, setName] = useState<Tr[]>([]);
  const [min, setMin] = useState(2);
  const [max, setMax] = useState(2);
  return (
    <FormDialog
      title={t('gclNew')}
      testId="gcl-new-dialog"
      onClose={props.onClose}
      submit={async () => needTitle(name, def) ?? save(() => getConn().reducers.adminSaveGame(newGameArgs(key.trim().toLowerCase(), name, min, max)))}
    >
      <div className="span-2">
        <Notice kind="plain" text={t('gclNewHint')} />
      </div>
      <Field label={t('key')} hint={t('ktKeyHint')} required className="span-2">
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('gclMinPlayers')}>
        <NumInput value={min} onChange={setMin} name="minPlayers" />
      </Field>
      <Field label={t('gclMaxPlayers')}>
        <NumInput value={max} onChange={setMax} name="maxPlayers" />
      </Field>
    </FormDialog>
  );
}

export function GamesCatalog(_props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const games = useRows('adminGames');
  const rooms = useRows('adminGameRooms');
  const loaded = useLoaded();
  const { def } = useLanguages();
  const [add, setAdd] = useState(false);
  const list = [...games].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const roomCount = (id: bigint) => rooms.filter(r => r.gameId === id).length;
  const open = (g: GameRow) => go(`game?id=${g.id}`);
  const title = (g: GameRow) => (
    <a className="gcl-name" href={`#/game?id=${g.id}`} data-testid={`gcl-open-${g.key}`}>
      <GameIcon url={g.iconUrl} />
      <span style={{ minWidth: 0 }}>
        <span className="primary">{trText(g.name, def) || g.key}</span>
        <div className="mono muted">{g.key}</div>
      </span>
    </a>
  );
  return (
    <main className="page" data-testid="page-games-catalog">
      <PageHead title={t('navGamesCatalog')} sub={t('gclSub', { n: num(list.length) })} action={<AddButton label={t('gclNew')} onClick={() => setAdd(true)} testId="gcl-add" />} />
      <CatalogTable
        rows={list}
        loaded={loaded}
        prefix="gcl"
        keyOf={g => g.key}
        empty={{ icon: <GameController className="ic" weight="duotone" />, title: t('gclEmpty') }}
        locked={g => g.registered}
        cardTitle={title}
        cols={[
          { label: t('name'), render: title },
          {
            label: t('status'),
            render: g => (
              <span className="chips">
                <RegBadge on={g.registered} />
                <ActiveBadge on={g.isActive} />
                {g.maintenance && (
                  <span className="badge b-bad">
                    <Wrench className="ic" />
                    {t('gclMaintenance')}
                  </span>
                )}
              </span>
            ),
          },
          { label: t('gclPlayers'), render: g => players(g.minPlayers, g.maxPlayers), className: 'nowrap' },
          { label: t('gclRooms'), render: g => num(roomCount(g.id)) },
          { label: t('gclPaths'), render: g => <PathFlags g={g} /> },
        ]}
        extra={(g, card) => (
          <button type="button" className="btn btn-sm btn-icon" onClick={() => open(g)} aria-label={t('gclOpen')} title={t('gclOpen')} data-testid={`${card ? 'gclc' : 'gcl'}-go-${g.key}`}>
            <ArrowSquareOut className="ic" />
          </button>
        )}
        onEdit={open}
        onDelete={g => del(t('deleteConfirmName', { name: g.key }), () => getConn().reducers.adminDeleteGame({ id: g.id }))}
      />
      {add && <NewGameDialog onClose={() => setAdd(false)} />}
    </main>
  );
}

function PlatformsField(props: { platforms: string[]; minVersions: { platform: string; version: string }[]; onChange: (p: string[], v: { platform: string; version: string }[]) => void }) {
  const all = props.platforms.length === 0;
  const on = (k: string) => props.platforms.includes(k);
  return (
    <>
      <Field label={t('gclPlatforms')} hint={all ? t('gclPlatformsAll') : undefined} className="span-2">
        <div className="chips" data-testid="gm-platforms">
          {PLATFORMS.map(([k, l]) => (
            <button
              type="button"
              key={k}
              className="chip chip-btn"
              aria-pressed={on(k)}
              onClick={() => props.onChange(on(k) ? props.platforms.filter(x => x !== k) : [...props.platforms, k], props.minVersions)}
              data-testid={`gm-platform-${k}`}
            >
              {t(l)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('gclMinVersions')} hint={t('gclMinVersionsHint')} className="span-2">
        <Rows
          rows={props.minVersions}
          onChange={v => props.onChange(props.platforms, v)}
          max={PLATFORMS.length}
          testId="gm-versions"
          addLabel={t('gclAddVersion')}
          make={() => ({ platform: PLATFORMS.find(([k]) => !props.minVersions.some(x => x.platform === k))?.[0] ?? 'android', version: '1.0.0' })}
          cols={[
            { label: t('gclPlatform'), width: 'minmax(0, 1fr)', render: (r, set) => <Choice value={r.platform} onChange={x => set({ platform: x })} options={PLATFORMS} label={t('gclPlatform')} /> },
            { label: t('gclVersion'), width: 'minmax(0, 1fr)', render: (r, set) => <input className="input ltr" name="minVersion" value={r.version} onChange={e => set({ version: latin(e.target.value) })} placeholder="1.4.2" aria-label={t('gclVersion')} /> },
          ]}
        />
      </Field>
    </>
  );
}

function SwitchField(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; testId?: string }) {
  return (
    <div className="span-2 stack" style={{ gap: 2 }}>
      <SwitchRow checked={props.checked} onChange={props.onChange} label={props.label} testId={props.testId} />
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  );
}

function GeneralTab(props: { v: GameArgs; up: (p: Partial<GameArgs>) => void; game: GameRow }) {
  const { v, up } = props;
  return (
    <div className="stack">
      <Section title={t('gclBasics')}>
        <div className="form-grid">
          <Field label={t('name')} required className="span-2">
            <TrInputs value={v.name} onChange={x => up({ name: x })} required name="name" />
          </Field>
          <Field label={t('description')} className="span-2">
            <TrInputs value={v.description} onChange={x => up({ description: x })} multiline name="description" />
          </Field>
          <Field label={t('gclIconUrl')} hint={t('gclIconHint')}>
            <div className="input-group">
              <GameIcon url={v.iconUrl} size={36} />
              <input className="input ltr grow" name="iconUrl" value={v.iconUrl} onChange={e => up({ iconUrl: e.target.value })} placeholder="https://" />
            </div>
          </Field>
          <Field label={t('sort')}>
            <NumInput value={v.sort} onChange={x => up({ sort: x })} name="sort" />
          </Field>
          <Field label={t('category')}>
            <CategoryPicker keyType="game" value={v.categoryId} onChange={x => up({ categoryId: x })} none={t('gclNoCategory')} label={t('category')} testId="gm-category" />
          </Field>
          <Field label={t('tags')} className="span-2">
            <TagPicker keyType="game" value={v.tagIds} onChange={x => up({ tagIds: x })} testId="gm-tags" />
          </Field>
          <SwitchField checked={v.isActive} onChange={x => up({ isActive: x })} label={t('gclActive')} hint={props.game.registered ? t('gclActiveHint') : t('gclUnregHint')} testId="gm-active" />
        </div>
      </Section>
      <Section title={t('gclPlay')}>
        <div className="form-grid">
          <Field label={t('gclMinPlayers')} hint={t('gclPlayersHint')}>
            <NumInput value={v.minPlayers} onChange={x => up({ minPlayers: x })} name="minPlayers" />
          </Field>
          <Field label={t('gclMaxPlayers')}>
            <NumInput value={v.maxPlayers} onChange={x => up({ maxPlayers: x })} name="maxPlayers" />
          </Field>
          <Field label={t('gclTurnSeconds')} hint={t('gclZeroNone')}>
            <NumInput value={v.turnSeconds} onChange={x => up({ turnSeconds: x })} name="turnSeconds" />
          </Field>
          <Field label={t('gclMatchSeconds')} hint={t('gclZeroNone')}>
            <NumInput value={v.matchSeconds} onChange={x => up({ matchSeconds: x })} name="matchSeconds" />
          </Field>
          <SwitchField checked={v.botsAllowed} onChange={x => up({ botsAllowed: x })} label={t('gclBots')} hint={t('gclBotsHint')} testId="gm-bots" />
          {v.botsAllowed && (
            <Field label={t('gclBotAfter')} hint={t('gclBotAfterHint')}>
              <NumInput value={v.botAfterSeconds} onChange={x => up({ botAfterSeconds: x })} name="botAfterSeconds" />
            </Field>
          )}
          <SwitchField checked={v.friendAllowed} onChange={x => up({ friendAllowed: x })} label={t('gclFriend')} hint={t('gclFriendHint')} testId="gm-friend" />
        </div>
      </Section>
      <Section title={t('gclClients')}>
        <div className="form-grid">
          <PlatformsField platforms={v.platforms} minVersions={v.minVersions} onChange={(platforms, minVersions) => up({ platforms, minVersions })} />
        </div>
      </Section>
    </div>
  );
}

function MaintenanceTab(props: { v: GameArgs; up: (p: Partial<GameArgs>) => void }) {
  const { v, up } = props;
  return (
    <section className={`card gcl-maint ${v.maintenance ? 'on' : ''}`} data-testid="gm-maint">
      <div className="card-pad stack">
        <div className="row row-wrap">
          <span className="gcl-maint-ic">
            <Wrench className="ic" weight="duotone" />
          </span>
          <div className="grow stack" style={{ gap: 2, minWidth: 200 }}>
            <b>{v.maintenance ? t('gclMaintOn') : t('gclMaintOff')}</b>
            <span className="small sub">{t('gclMaintHint')}</span>
          </div>
          <Switch checked={v.maintenance} onChange={x => up({ maintenance: x })} label={t('gclMaintenance')} testId="gm-maintenance" />
        </div>
        <Field label={t('gclMaintMessage')} hint={t('gclMaintMessageHint')}>
          <TrInputs value={v.maintenanceMessage} onChange={x => up({ maintenanceMessage: x })} multiline name="maintenanceMessage" />
        </Field>
      </div>
    </section>
  );
}

function bandAt(v: GameArgs, waited: number) {
  const b = v.bandSize + (v.widenEverySeconds ? Math.floor(waited / v.widenEverySeconds) * v.widenStep : 0);
  return v.maxBand ? Math.min(b, v.maxBand) : b;
}

function MatchmakingTab(props: { v: GameArgs; up: (p: Partial<GameArgs>) => void }) {
  const { v, up } = props;
  return (
    <div className="stack">
      <Section title={t('gclMmSkill')}>
        <div className="form-grid">
          <Field label={t('gclSkillMeta')} hint={t('gclSkillMetaHint')} className="span-2">
            <KeyPick kind="meta" value={v.skillMetaKey} onChange={x => up({ skillMetaKey: x })} none={t('gclSkillLevel')} testId="gm-skill" label={t('gclSkillMeta')} />
          </Field>
          <Field label={t('gclBandSize')} hint={t('gclBandSizeHint')}>
            <NumInput value={v.bandSize} onChange={x => up({ bandSize: x })} name="bandSize" />
          </Field>
          <Field label={t('gclMaxBand')} hint={t('zeroNoLimit')}>
            <NumInput value={v.maxBand} onChange={x => up({ maxBand: x })} name="maxBand" />
          </Field>
          <Field label={t('gclWidenEvery')} hint={t('gclWidenEveryHint')}>
            <NumInput value={v.widenEverySeconds} onChange={x => up({ widenEverySeconds: x })} name="widenEverySeconds" />
          </Field>
          <Field label={t('gclWidenStep')}>
            <NumInput value={v.widenStep} onChange={x => up({ widenStep: x })} name="widenStep" />
          </Field>
          <Field label={t('gclFillAfter')} hint={t('gclFillAfterHint')}>
            <NumInput value={v.fillAfterSeconds} onChange={x => up({ fillAfterSeconds: x })} name="fillAfterSeconds" />
          </Field>
        </div>
      </Section>
      <Section title={t('gclBandPreview')} testId="gm-band-preview">
        <div className="stack stack-sm">
          <span className="small sub">{t('gclBandPreviewHint')}</span>
          <div className="gcl-band">
            {[0, 10, 30, 60, 120].map(s => (
              <div key={s} className="gcl-band-cell">
                <span className="small muted">{s ? t('gclAfterSec', { n: s }) : t('gclAtStart')}</span>
                <b>±{num(bandAt(v, s))}</b>
              </div>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

function RoomDialog(props: { game: GameRow; row?: RoomRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [currency, setCurrency] = useState(r?.entryCurrency ?? '');
  const [fee, setFee] = useState(r?.entryFee ?? 0n);
  const [prizeKind, setPrizeKind] = useState<'none' | 'prize' | 'group'>(r?.prizeGroupId ? 'group' : r?.prizeId ? 'prize' : 'none');
  const [prizeId, setPrizeId] = useState(r?.prizeId ?? 0n);
  const [groupId, setGroupId] = useState(r?.prizeGroupId ?? 0n);
  const [minLevel, setMinLevel] = useState(r?.minLevel ?? 0);
  const [isLocked, setLocked] = useState(r?.isLocked ?? false);
  const [isHidden, setHidden] = useState(r?.isHidden ?? false);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [inheritGame, setInherit] = useState(r?.inheritGame ?? true);
  const [req, setReq] = useState<Req>(r ? reqCopy(r.requirements) : emptyReq());
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('gclRoomEdit') : t('gclRoomNew')}
      testId="grm-dialog"
      width={760}
      onClose={props.onClose}
      submit={async () => {
        const miss = needTitle(name, def);
        if (miss) return miss;
        if (fee > 0n && !currency) return { ok: false, msg: t('gclFeeNeedsCurrency') };
        const args: RoomArgs = {
          id: r?.id ?? 0n,
          gameId: props.game.id,
          key: key.trim().toLowerCase(),
          name,
          entryCurrency: fee > 0n ? currency : '',
          entryFee: fee,
          prizeId: prizeKind === 'prize' ? prizeId : 0n,
          prizeGroupId: prizeKind === 'group' ? groupId : 0n,
          minLevel,
          isLocked,
          isHidden,
          isActive,
          inheritGame,
          requirements: req,
          sort,
        };
        const res = await run(() => getConn().reducers.adminSaveGameRoom(args), t('saved'));
        return res.ok ? { ok: true } : { ok: false, msg: gameErr(res.err, null) };
      }}
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('gclEntryCurrency')}>
        <KeyPick kind="currency" value={currency} onChange={setCurrency} none={t('gclFree')} testId="grm-currency" label={t('gclEntryCurrency')} />
      </Field>
      <Field label={t('gclEntryFee')} hint={t('gclEntryFeeHint')}>
        <BigInput value={fee} onChange={setFee} name="entryFee" min0 />
      </Field>
      <Field label={t('gclPrize')} hint={t('gclPrizeHint')} className="span-2">
        <div className="stack stack-sm">
          <Seg
            value={prizeKind}
            onChange={setPrizeKind}
            label={t('gclPrize')}
            options={[
              { value: 'none', label: t('gclPrizeNone') },
              { value: 'prize', label: t('gclPrizeOne') },
              { value: 'group', label: t('gclPrizeGroup') },
            ]}
          />
          {prizeKind === 'prize' && <IdPick kind="prize" value={prizeId} onChange={setPrizeId} none={t('gclPick')} testId="grm-prize" label={t('gclPrizeOne')} />}
          {prizeKind === 'group' && <IdPick kind="prizeGroup" value={groupId} onChange={setGroupId} none={t('gclPick')} testId="grm-group" label={t('gclPrizeGroup')} />}
        </div>
      </Field>
      <Field label={t('gclRoomMinLevel')} hint={t('gclZeroNone')}>
        <NumInput value={minLevel} onChange={setMinLevel} name="minLevel" />
      </Field>
      <div className="span-2 stack stack-sm">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="grm-active" />
        <SwitchRow checked={isLocked} onChange={setLocked} label={t('gclRoomLocked')} testId="grm-locked" />
        <span className="hint">{t('gclRoomLockedHint')}</span>
        <SwitchRow checked={isHidden} onChange={setHidden} label={t('gclRoomHidden')} testId="grm-hidden" />
        <span className="hint">{t('gclRoomHiddenHint')}</span>
        <SwitchRow checked={inheritGame} onChange={setInherit} label={t('gclRoomInherit')} testId="grm-inherit" />
        <span className="hint">{t('gclRoomInheritHint')}</span>
      </div>
      <div className="span-2 stack stack-sm">
        <div className="section-label">{t('gclRoomReq')}</div>
        <RequirementsEditor value={req} onChange={setReq} prefix="grm-req" room />
      </div>
    </FormDialog>
  );
}

function RoomsTab(props: { game: GameRow }) {
  const rooms = useRows('adminGameRooms');
  const loaded = useLoaded();
  const { def } = useLanguages();
  const currencies = useRows('currency');
  const prizes = useRows('prize');
  const groups = useRows('prizeGroup');
  const [edit, setEdit] = useState<RoomRow | 'new' | null>(null);
  const list = rooms.filter(r => r.gameId === props.game.id).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  const curName = (k: string) => trText(currencies.find(c => c.key === k)?.name, def) || k;
  const prizeText = (r: RoomRow) => {
    if (r.prizeId) {
      const p = prizes.find(x => x.id === r.prizeId);
      return p ? trText(p.name, def) || p.key : `#${digits(String(r.prizeId))}`;
    }
    if (r.prizeGroupId) {
      const g = groups.find(x => x.id === r.prizeGroupId);
      return `${t('gclPrizeGroup')}: ${g ? trText(g.name, def) || g.key : `#${digits(String(r.prizeGroupId))}`}`;
    }
    return '—';
  };
  return (
    <Section title={t('gclRoomsTitle')} pad={false} testId="gm-rooms" action={<AddButton label={t('gclRoomNew')} onClick={() => setEdit('new')} testId="grm-add" />}>
      <div className="gcl-rooms">
        <CatalogTable
          rows={list}
          loaded={loaded}
          prefix="grm"
          keyOf={r => r.key}
          empty={{ icon: <Cube className="ic" weight="duotone" />, title: t('gclRoomsEmpty') }}
          cols={[
            {
              label: t('name'),
              render: r => (
                <>
                  <span className="primary">{trText(r.name, def) || r.key}</span>
                  <div className="mono muted">{r.key}</div>
                </>
              ),
            },
            { label: t('gclEntryFee'), render: r => (r.entryFee > 0n ? `${num(r.entryFee)} ${curName(r.entryCurrency)}` : t('gclFree')) },
            { label: t('gclPrize'), render: r => prizeText(r) },
            {
              label: t('status'),
              render: r => (
                <span className="chips">
                  <ActiveBadge on={r.isActive} />
                  {r.isLocked && <span className="badge b-warn">{t('gclRoomLockedShort')}</span>}
                  {r.isHidden && <span className="badge">{t('gclRoomHiddenShort')}</span>}
                  {r.minLevel > 0 && <span className="badge b-info">{t('gclLevelShort', { n: r.minLevel })}</span>}
                  {reqCount(r.requirements) > 0 && (
                    <span className="badge b-violet">
                      <ListChecks className="ic" />
                      {t('gclReqShort', { n: reqCount(r.requirements) })}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
          onEdit={r => setEdit(r)}
          onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteGameRoom({ id: r.id }))}
        />
      </div>
      {edit && <RoomDialog game={props.game} row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

function GameSkeleton() {
  return (
    <>
      <div className="card card-pad player-head">
        <Skel w={52} h={52} r={12} />
        <div className="stack stack-sm grow">
          <Skel w="30%" h={16} />
          <Skel w="45%" h={10} />
        </div>
      </div>
      <Skel w={420} h={32} r={8} />
      <div className="card card-pad stack">
        <Skel w="20%" h={12} />
        <div className="form-grid">
          {[0, 1, 2, 3].map(i => (
            <div className="field" key={i}>
              <Skel w={90} h={10} />
              <Skel h={36} r={6} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function GameEditPage(_props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const route = useRoute();
  const { can } = useSession();
  const { def } = useLanguages();
  const games = useRows('adminGames');
  const loaded = useLoaded();
  const id = BigInt(/^\d+$/.test(route.query.get('id') ?? '') ? route.query.get('id')! : '0');
  const tab = TABS.some(([k]) => k === route.query.get('tab')) ? route.query.get('tab')! : 'general';
  const game = games.find(g => g.id === id);
  const [v, setV] = useState<GameArgs | null>(null);
  const [base, setBase] = useState('');
  const [raw, setRaw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [serverSet, setServerSet] = useState<{ path: string; rule: string } | null>(null);
  const stamp = game ? `${game.id}:${game.updatedAt.microsSinceUnixEpoch}` : '';
  const keep = useRef({ v: null as GameArgs | null, base: '', saved: false, game: undefined as GameRow | undefined, stamp: '' });
  keep.current.v = v;
  keep.current.game = game;
  keep.current.stamp = stamp;
  keep.current.base = base;
  useEffect(() => {
    if (!game) return;
    const k = keep.current;
    if (k.v && formKey(k.v) !== k.base && !k.saved) return;
    k.saved = false;
    const a = gameArgs(game);
    setV(a);
    setBase(formKey(a));
  }, [stamp]);
  const ro = !can('admin');
  const back = (
    <a href="#/games-catalog" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} data-testid="gm-back">
      <ArrowRight className="ic" style={{ transform: document.documentElement.dir === 'rtl' ? undefined : 'scaleX(-1)' }} />
      {t('gclBack')}
    </a>
  );
  if (!game || !v) {
    return (
      <main className="page" data-testid="page-game" aria-busy={!loaded || games.length === 0}>
        {back}
        {loaded && games.length > 0 ? <Empty icon={<GameController className="ic" weight="duotone" />} title={t('gclNotFound')} /> : <GameSkeleton />}
      </main>
    );
  }
  const schema = parseSchema(game.settingsSchema);
  const up = (p: Partial<GameArgs>) => setV({ ...v, ...p });
  const dirty = formKey(v) !== base;
  const setTab = (k: string) => pageQuery('game', { id: String(game.id), tab: k === 'general' ? '' : k });
  async function onSave() {
    if (!v || !game) return;
    setErr(null);
    if (!v.name.some(x => x.text.trim())) {
      setErr(t('trRequired', { lang: def }));
      setTab('general');
      return;
    }
    const st = settingsState(v.settings, schema, raw);
    const first = Object.entries(st.errs)[0];
    if (first) {
      setErr(settingsErrText(first[0], first[1], schema));
      setTab('settings');
      return;
    }
    let settings = v.settings.trim() || '{}';
    if (!raw && st.obj) settings = JSON.stringify(st.obj);
    setBusy(true);
    const before = keep.current.stamp;
    const r = await run(() => getConn().reducers.adminSaveGame({ ...v, settings }), t('saved'));
    setBusy(false);
    if (r.ok) {
      const now = keep.current.game;
      if (now && keep.current.stamp !== before) {
        const a = gameArgs(now);
        setV(a);
        setBase(formKey(a));
      } else keep.current.saved = true;
      setServerSet(null);
      setRaw(false);
      return;
    }
    const s = parseSettingsErr(r.err.raw);
    setServerSet(s);
    setErr(gameErr(r.err, schema));
    if (s) setTab('settings');
    else if (r.err.field === 'requirements') setTab('requirements');
  }
  const count = reqCount(v.requirements);
  return (
    <main className="page" data-testid="page-game">
      {back}
      <div className="card card-pad player-head">
        <GameIcon url={game.iconUrl} size={52} />
        <div className="stack grow" style={{ gap: 2, minWidth: 180 }}>
          <div className="row row-wrap">
            <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }} data-testid="gm-name">
              {trText(game.name, def) || game.key}
            </h2>
            <RegBadge on={game.registered} />
            <ActiveBadge on={game.isActive} />
            {game.realtime && <span className="badge b-teal">{t('gclRealtime')}</span>}
            {game.maintenance && (
              <span className="badge b-bad" data-testid="gm-maint-badge">
                <Wrench className="ic" />
                {t('gclMaintenance')}
              </span>
            )}
          </div>
          <span className="small muted">
            <span className="mono">{game.key}</span>
            {game.codeName ? (
              <>
                {' · '}
                {t('gclCodeName', { name: iso(game.codeName) })}
              </>
            ) : null}
            {' · '}
            {t('gclPlayersN', { n: players(game.minPlayers, game.maxPlayers) })}
          </span>
          <span className="small muted">{t('gclUpdated', { d: when(game.updatedAt) })}</span>
        </div>
      </div>
      {game.maintenance && <Notice kind="warn" icon={<Wrench className="ic" />} title={t('gclMaintOn')} text={trText(game.maintenanceMessage, def) || t('gclMaintNoMessage')} />}
      {!game.registered && <Notice kind="plain" text={t('gclUnregHint')} />}
      <div className="gcl-tabs" data-testid="gm-tabs">
        <Seg
          value={tab}
          onChange={setTab}
          label={t('navGame')}
          options={TABS.map(([k, l]) => ({ value: k, label: k === 'requirements' && count ? `${t(l)} ${digits(count)}` : t(l) }))}
        />
      </div>
      {tab === 'rooms' ? (
        <RoomsTab game={game} />
      ) : (
        <fieldset className="gcl-form" disabled={ro}>
          {tab === 'general' && <GeneralTab v={v} up={up} game={game} />}
          {tab === 'maintenance' && <MaintenanceTab v={v} up={up} />}
          {tab === 'matchmaking' && <MatchmakingTab v={v} up={up} />}
          {tab === 'settings' && <SettingsTab game={game} value={v.settings} onChange={x => up({ settings: x })} raw={raw} setRaw={setRaw} serverErr={serverSet} ro={ro} />}
          {tab === 'requirements' && (
            <div className="stack">
              <Notice kind="plain" icon={<ListChecks className="ic" />} text={t('gclReqGameHint')} />
              <RequirementsEditor value={v.requirements} onChange={x => up({ requirements: x })} prefix="gm-req" />
            </div>
          )}
        </fieldset>
      )}
      {!ro && tab !== 'rooms' && (
        <div className="card gcl-savebar" data-testid="gm-savebar">
          <ErrBox text={err} />
          <div className="row row-wrap">
            <span className={`small ${dirty ? 'gcl-warn-text' : 'muted'} grow`}>{dirty ? t('gclDirty') : t('gclClean')}</span>
            {dirty && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setV(gameArgs(game));
                  setErr(null);
                  setServerSet(null);
                  setRaw(false);
                }}
                data-testid="gm-reset"
              >
                {t('gclDiscard')}
              </button>
            )}
            <SaveButton busy={busy} type="button" onClick={onSave} testId="gm-save" />
          </div>
        </div>
      )}
    </main>
  );
}

function hexOf(s: ServerRow) {
  return s.identity.toHexString();
}

function ServerDialog(props: { row?: ServerRow; onClose: () => void }) {
  const r = props.row;
  const [identity, setIdentity] = useState(r ? hexOf(r) : '');
  const [note, setNote] = useState(r?.note ?? '');
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const clean = latin(identity).trim().replace(/^0x/i, '').toLowerCase();
  const bad = identity.trim() !== '' && !/^[0-9a-f]{64}$/.test(clean);
  return (
    <FormDialog
      title={r ? t('gclSrvEdit') : t('gclSrvNew')}
      testId="gsv-dialog"
      onClose={props.onClose}
      submit={async () => {
        if (!/^[0-9a-f]{64}$/.test(clean)) return { ok: false, msg: t('gclSrvBadIdentity') };
        return save(() => getConn().reducers.adminSaveGameServer({ identity: Identity.fromString(clean), note, isActive }));
      }}
    >
      <Field label={t('gclSrvIdentity')} hint={t('gclSrvIdentityHint')} error={bad ? t('gclSrvBadIdentity') : undefined} required className="span-2">
        <input className="input ltr mono" name="identity" value={identity} onChange={e => setIdentity(e.target.value)} disabled={!!r} autoFocus={!r} spellCheck={false} placeholder="c200…" aria-invalid={bad || undefined} />
      </Field>
      <Field label={t('note')} className="span-2">
        <input className="input" name="note" value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
      </Field>
      <div className="span-2 stack" style={{ gap: 2 }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} testId="gsv-active" />
        <span className="hint">{t('gclSrvActiveHint')}</span>
      </div>
    </FormDialog>
  );
}

export function GameServers(_props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const list = useRows('adminGameServers');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<ServerRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));
  return (
    <main className="page" data-testid="page-game-servers">
      <PageHead title={t('navGameServers')} sub={t('gclSrvSub', { n: num(rows.length) })} action={<AddButton label={t('gclSrvNew')} onClick={() => setEdit('new')} testId="gsv-add" />} />
      <Notice icon={<HardDrives className="ic" />} title={t('gclSrvWhatTitle')} text={t('gclSrvWhat')} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="gsv"
        keyOf={r => hexOf(r).slice(0, 16)}
        empty={{ icon: <HardDrives className="ic" weight="duotone" />, title: t('gclSrvEmpty') }}
        cols={[
          {
            label: t('gclSrvIdentity'),
            render: r => (
              <span className="mono gcl-hex" title={hexOf(r)}>
                {hexOf(r).slice(0, 16)}…{hexOf(r).slice(-6)}
              </span>
            ),
          },
          { label: t('note'), render: r => r.note || <span className="muted">—</span> },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
          { label: t('gclSrvAdded'), render: r => when(r.createdAt), className: 'nowrap' },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('gclSrvDeleteConfirm'), () => getConn().reducers.adminDeleteGameServer({ identity: r.identity }))}
      />
      {edit && <ServerDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type SetArgs = Parameters<ReturnType<typeof getConn>['reducers']['adminSaveGamesSettings']>[0];

const SET_FIELDS: [keyof SetArgs, StrKey, StrKey][] = [
  ['ticketTtlSeconds', 'gclStTicketTtl', 'gclStTicketTtlHint'],
  ['maxTicketsPerPlayer', 'gclStMaxTickets', 'gclStMaxTicketsHint'],
  ['startTimeoutSeconds', 'gclStStartTimeout', 'gclStStartTimeoutHint'],
  ['playTimeoutSeconds', 'gclStPlayTimeout', 'gclStPlayTimeoutHint'],
  ['payoutMaxTries', 'gclStPayoutTries', 'gclStPayoutTriesHint'],
  ['historyDays', 'gclStHistory', 'gclStHistoryHint'],
];

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

function RunNow() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ matches: number; expired: number; cancelled: number; boards: number; paid: number } | null>(null);
  return (
    <Notice
      icon={<Lightning className="ic" />}
      title={t('gclRunTitle')}
      text={
        last ? (
          <span data-testid="gst-run-result">{t('gclRunDone', { m: num(last.matches), e: num(last.expired), c: num(last.cancelled), b: num(last.boards), p: num(last.paid) })}</span>
        ) : (
          t('gclRunHint')
        )
      }
      action={
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={busy}
          data-testid="gst-run"
          onClick={async () => {
            setBusy(true);
            const r = await run(c => c.procedures.adminGamesRun({}));
            setBusy(false);
            if (r.ok) {
              setLast(r.value);
              toast('ok', t('gclRunDone', { m: num(r.value.matches), e: num(r.value.expired), c: num(r.value.cancelled), b: num(r.value.boards), p: num(r.value.paid) }));
            } else toast('bad', errorText(r.err));
          }}
        >
          {t('gclRun')}
        </button>
      }
    />
  );
}

export function GamesSettingsSection(props: { ro?: boolean; accountId?: bigint }) {
  useLocale();
  const s = useRows('adminGamesSettings')[0];
  const [v, setV] = useState<SetArgs | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ro = !!props.ro;
  useEffect(() => {
    if (s && !v)
      setV({
        ticketTtlSeconds: s.ticketTtlSeconds,
        startTimeoutSeconds: s.startTimeoutSeconds,
        playTimeoutSeconds: s.playTimeoutSeconds,
        maxTicketsPerPlayer: s.maxTicketsPerPlayer,
        payoutMaxTries: s.payoutMaxTries,
        weekStart: s.weekStart,
        monthCalendar: s.monthCalendar,
        historyDays: s.historyDays,
      });
  }, [s, v]);
  if (!v || !s) return <FormSkel n={8} />;
  const up = (p: Partial<SetArgs>) => setV({ ...v, ...p });
  const field = ([k, l, h]: (typeof SET_FIELDS)[number]) => (
    <Field key={k} label={t(l)} hint={t(h)}>
      <NumInput value={Number(v[k])} onChange={x => up({ [k]: Math.max(0, x) })} disabled={ro} name={k} />
    </Field>
  );
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        data-testid="gst-form"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          const r = await run(() => getConn().reducers.adminSaveGamesSettings(v), t('saved'));
          setBusy(false);
          setErr(r.ok ? null : errorText(r.err));
        }}
      >
        <Section title={t('gclStQueue')}>
          <div className="form-grid">{SET_FIELDS.slice(0, 2).map(field)}</div>
        </Section>
        <Section title={t('gclStMatches')}>
          <div className="form-grid">{SET_FIELDS.slice(2).map(field)}</div>
        </Section>
        <Section title={t('gclStPeriods')}>
          <div className="form-grid">
            <Field label={t('gclStWeekStart')} hint={t('gclStWeekStartHint')}>
              {ro ? <input className="input" disabled value={t(WEEK.find(([d]) => d === String(v.weekStart))?.[1] ?? 'dSat')} /> : <Choice value={String(v.weekStart)} onChange={x => up({ weekStart: Number(x) })} name="weekStart" options={WEEK} label={t('gclStWeekStart')} />}
            </Field>
            <Field label={t('gclStCalendar')} hint={t('gclStCalendarHint')}>
              {ro ? (
                <input className="input" disabled value={v.monthCalendar === 'gregorian' ? t('gclStGregorian') : t('gclStJalali')} />
              ) : (
                <Seg
                  value={v.monthCalendar}
                  onChange={x => up({ monthCalendar: x })}
                  label={t('gclStCalendar')}
                  options={[
                    { value: 'jalali', label: t('gclStJalali') },
                    { value: 'gregorian', label: t('gclStGregorian') },
                  ]}
                />
              )}
            </Field>
          </div>
        </Section>
        {!ro && (
          <>
            <ErrBox text={err} />
            <div className="form-actions">
              <SaveButton busy={busy} testId="gst-save" />
            </div>
          </>
        )}
      </form>
      {!ro && <RunNow />}
      {!ro && <TestClock value={s.clockOffsetSec} testId="gst-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetGamesClockOffset({ seconds: sec }))} />}
      {ro && (
        <span className="small muted row">
          <Clock className="ic" />
          {t('gclStRoNote')}
        </span>
      )}
    </div>
  );
}

