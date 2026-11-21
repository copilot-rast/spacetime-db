import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, CreditCard, DeviceMobileCamera, GlobeHemisphereEast, ListBullets, MagnifyingGlass, PencilSimple, Plus, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { codeText, digits, errorText, latin, num, t, useLocale, type StrKey } from './i18n.ts';
import { run, runToast, trText, useLanguages, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, ListSkeleton, Notice, NumInput, SaveButton, Skel, Switch, SwitchRow, TrInputs, confirmAsk, trMissingDefault } from './ui.tsx';
import { TagPicker } from './widgets.tsx';

function SectionTop(props: { text?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="row row-wrap">
      {props.children}
      {props.text ? <p className="small muted grow">{props.text}</p> : <span className="grow" />}
      {props.action}
    </div>
  );
}

function Add(props: { label: string; onClick: () => void; testId: string; ro: boolean }) {
  if (props.ro) return null;
  return (
    <button type="button" className="btn btn-primary" onClick={props.onClick} data-testid={props.testId}>
      <Plus className="ic" />
      {props.label}
    </button>
  );
}

function Btn(props: { label: string; onClick: () => void; testId?: string; danger?: boolean; icon: React.ReactNode }) {
  return (
    <button type="button" className={`btn btn-sm btn-icon ${props.danger ? 'btn-danger-ghost' : ''}`} onClick={props.onClick} aria-label={props.label} title={props.label} data-testid={props.testId}>
      {props.icon}
    </button>
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

function Actions(props: { busy: boolean; testId: string }) {
  return (
    <div className="form-actions">
      <SaveButton busy={props.busy} testId={props.testId} />
    </div>
  );
}

const LATIN = /^[A-Za-z0-9_. -]+$/;
const PERSIAN = /^[؀-ۿ‌0-9۰-۹ _.-]+$/;

export function AccountRulesSection(props: { ro: boolean }) {
  const rules = useRows('accountRules')[0];
  const [v, setV] = useState<null | { displayNameMin: number; displayNameMax: number; displayNameCharset: string; displayNameUnique: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sample, setSample] = useState('');
  useEffect(() => {
    if (rules && !v) setV({ displayNameMin: rules.displayNameMin, displayNameMax: rules.displayNameMax, displayNameCharset: rules.displayNameCharset, displayNameUnique: rules.displayNameUnique });
  }, [rules, v]);
  if (!v) return <FormSkel n={4} />;
  const len = [...sample].length;
  const verdict = !sample
    ? null
    : len < v.displayNameMin
      ? 'DISPLAY_NAME_TOO_SHORT'
      : len > v.displayNameMax
        ? 'DISPLAY_NAME_TOO_LONG'
        : v.displayNameCharset === 'latin' && !LATIN.test(sample)
          ? 'DISPLAY_NAME_INVALID_CHARACTERS'
          : v.displayNameCharset === 'persian' && !PERSIAN.test(sample)
            ? 'DISPLAY_NAME_INVALID_CHARACTERS'
            : '';
  return (
    <form
      className="stack stack-lg"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const r = await run(c => c.reducers.adminSaveAccountRules(v), t('saved'));
        setBusy(false);
        setErr(r.ok ? null : errorText(r.err));
      }}
    >
      <div className="form-grid">
        <Field label={t('arMin')}>
          <NumInput value={v.displayNameMin} onChange={n => setV({ ...v, displayNameMin: n })} disabled={props.ro} name="displayNameMin" />
        </Field>
        <Field label={t('arMax')} hint={t('arMaxHint')}>
          <NumInput value={v.displayNameMax} onChange={n => setV({ ...v, displayNameMax: n })} disabled={props.ro} name="displayNameMax" />
        </Field>
        <Field label={t('arCharset')} className="span-2">
          <select className="select" name="charset" value={v.displayNameCharset} onChange={e => setV({ ...v, displayNameCharset: e.target.value })} disabled={props.ro}>
            <option value="any">{t('arAny')}</option>
            <option value="latin">{t('arLatin')}</option>
            <option value="persian">{t('arPersian')}</option>
          </select>
        </Field>
        <div className="span-2 stack" style={{ gap: 0 }}>
          <SwitchRow checked={v.displayNameUnique} onChange={b => setV({ ...v, displayNameUnique: b })} disabled={props.ro} label={t('arUnique')} />
          <span className="hint">{t('arUniqueHint')}</span>
        </div>
      </div>
      <div className="try-box stack stack-sm" data-testid="ar-try">
        <b>{t('arTry')}</b>
        <span className="small muted">{t('arTryHint')}</span>
        <input className="input" value={sample} onChange={e => setSample(e.target.value)} name="sample" aria-label={t('arTry')} />
        {verdict === '' && (
          <span className="row small pos" data-testid="ar-try-ok">
            <CheckCircle className="ic" weight="fill" />
            {t('arTryOk')} {v.displayNameUnique ? t('arTryUnique') : ''}
          </span>
        )}
        {verdict && (
          <span className="row small neg" data-testid="ar-try-bad">
            <WarningCircle className="ic" weight="fill" />
            {codeText(verdict)}
          </span>
        )}
      </div>
      <ErrBox text={err} />
      {!props.ro && <Actions busy={busy} testId="ar-save" />}
    </form>
  );
}

const PLATFORMS: [string, StrKey][] = [
  ['android', 'plAndroid'],
  ['ios', 'plIos'],
  ['web', 'plWeb'],
  ['windows', 'plWindows'],
  ['macos', 'plMacos'],
  ['linux', 'plLinux'],
];

const STORES: [string, StrKey][] = [
  ['google_play', 'sGooglePlay'],
  ['app_store', 'sAppStore'],
  ['bazaar', 'sBazaar'],
  ['myket', 'sMyket'],
  ['microsoft_store', 'sMicrosoft'],
  ['steam', 'sSteam'],
  ['web', 'sWeb'],
  ['direct', 'sDirect'],
];

const platformName = (p: string) => {
  const k = PLATFORMS.find(x => x[0] === p);
  return k ? t(k[1]) : p;
};
const storeName = (s: string) => {
  const k = STORES.find(x => x[0] === s);
  return k ? t(k[1]) : s;
};

type AppVersionRow = RowOf<'appVersion'>;
type Link = { store: string; url: string; label: Tr[] };

function AppVersionDialog(props: { row?: AppVersionRow; taken: string[]; onClose: () => void }) {
  const r = props.row;
  const free = PLATFORMS.filter(p => !props.taken.includes(p[0]) || p[0] === r?.platform);
  const [platform, setPlatform] = useState(r?.platform ?? free[0]?.[0] ?? 'android');
  const [latest, setLatest] = useState(r?.latestVersion ?? '');
  const [min, setMin] = useState(r?.minVersion ?? '');
  const [links, setLinks] = useState<Link[]>(r?.storeLinks.map(x => ({ ...x })) ?? []);
  const [updateMessage, setUpdate] = useState<Tr[]>(r?.updateMessage ?? []);
  const [forceMessage, setForce] = useState<Tr[]>(r?.forceMessage ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (i: number, p: Partial<Link>) => setLinks(links.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Dialog
      title={r ? t('avEdit', { p: platformName(r.platform) }) : t('avAdd')}
      width={700}
      onClose={props.onClose}
      testId="av-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="av-form" className="btn btn-primary" disabled={busy} data-testid="dialog-save">
            {t('save')}
          </button>
        </>
      }
    >
      <form
        id="av-form"
        className="form-grid"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          const res = await run(
            c =>
              c.reducers.adminSaveAppVersion({
                platform,
                latestVersion: latin(latest).trim(),
                minVersion: latin(min).trim(),
                storeLinks: links.map(l => ({ ...l, url: l.url.trim() })),
                updateMessage,
                forceMessage,
                isActive,
              }),
            t('saved')
          );
          setBusy(false);
          if (res.ok) props.onClose();
          else setErr(errorText(res.err));
        }}
      >
        <Field label={t('avPlatform')} required>
          <select className="select" name="platform" value={platform} onChange={e => setPlatform(e.target.value)} disabled={!!r}>
            {free.map(([p, k]) => (
              <option key={p} value={p}>
                {t(k)}
              </option>
            ))}
          </select>
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
        </div>
        <Field label={t('avLatest')} hint={t('avVersionHint')} required>
          <input className="input ltr" name="latest" value={latest} onChange={e => setLatest(e.target.value)} />
        </Field>
        <Field label={t('avMin')} hint={t('avMinHint')}>
          <input className="input ltr" name="min" value={min} onChange={e => setMin(e.target.value)} />
        </Field>
        <Field label={t('avStores')} className="span-2">
          <div className="stack stack-sm" data-testid="av-links">
            {links.map((l, i) => (
              <div className="link-row" key={i}>
                <select className="select" value={l.store} onChange={e => up(i, { store: e.target.value })} aria-label={t('avStore')} data-testid={`av-link-${i}-store`}>
                  {STORES.map(([s, k]) => (
                    <option key={s} value={s}>
                      {t(k)}
                    </option>
                  ))}
                </select>
                <div className="stack stack-sm">
                  <input className="input ltr" value={l.url} onChange={e => up(i, { url: e.target.value })} placeholder="https://" aria-label={t('avUrl')} name={`av-link-${i}-url`} />
                  <TrInputs value={l.label} onChange={label => up(i, { label })} name={`av-link-${i}-label`} />
                </div>
                <button type="button" className="btn btn-icon btn-danger-ghost" aria-label={t('delete')} onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                  <X className="ic" />
                </button>
              </div>
            ))}
            {links.length < 8 && (
              <div>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  data-testid="av-link-add"
                  onClick={() => setLinks([...links, { store: STORES.find(s => !links.some(l => l.store === s[0]))?.[0] ?? 'direct', url: '', label: [] }])}
                >
                  <Plus className="ic" />
                  {t('avAddLink')}
                </button>
              </div>
            )}
          </div>
        </Field>
        <Field label={t('avUpdateMsg')} className="span-2" hint={t('optional')}>
          <TrInputs value={updateMessage} onChange={setUpdate} name="updateMessage" />
        </Field>
        <Field label={t('avForceMsg')} className="span-2" hint={t('optional')}>
          <TrInputs value={forceMessage} onChange={setForce} name="forceMessage" />
        </Field>
        <div className="span-2">
          <ErrBox text={err} />
        </div>
      </form>
    </Dialog>
  );
}

export function AppVersionsSection(props: { ro: boolean }) {
  const list = useRows('appVersion');
  const loaded = useRows('language').length > 0;
  const [edit, setEdit] = useState<AppVersionRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => PLATFORMS.findIndex(p => p[0] === a.platform) - PLATFORMS.findIndex(p => p[0] === b.platform));
  return (
    <>
      <SectionTop action={rows.length < PLATFORMS.length && <Add label={t('avAdd')} onClick={() => setEdit('new')} testId="av-add" ro={props.ro} />} />
      <div className="card">
        {!loaded ? (
          <ListSkeleton rows={2} />
        ) : rows.length === 0 ? (
          <Empty icon={<DeviceMobileCamera className="ic" weight="duotone" />} title={t('avEmpty')} />
        ) : (
          <div className="list">
            {rows.map(v => (
              <div className="list-row" key={v.platform} data-testid={`av-row-${v.platform}`}>
                <DeviceMobileCamera className="ic muted" weight="duotone" />
                <div className="list-main">
                  <span className="list-title">{platformName(v.platform)}</span>
                  <span className="list-sub">
                    {t('avLatest')} <span className="mono">{v.latestVersion}</span>
                    {v.minVersion ? (
                      <>
                        {' · '}
                        {t('avMin')} <span className="mono">{v.minVersion}</span>
                      </>
                    ) : null}
                    {' · '}
                    {v.storeLinks.map(l => storeName(l.store)).join('، ') || t('avLinks', { n: 0 })}
                  </span>
                </div>
                <span className={`badge ${v.isActive ? 'b-ok' : ''}`}>{v.isActive ? t('active') : t('inactive')}</span>
                {!props.ro && (
                  <div className="row-actions">
                    <Btn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(v)} testId={`av-edit-${v.platform}`} />
                    <Btn
                      label={t('delete')}
                      icon={<Trash className="ic" />}
                      danger
                      testId={`av-del-${v.platform}`}
                      onClick={async () => {
                        if (await confirmAsk(t('avDeleteConfirm', { p: platformName(v.platform) }), { danger: true, ok: t('delete') }))
                          await runToast(c => c.reducers.adminDeleteAppVersion({ platform: v.platform }), t('deleted'));
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <AppVersionDialog row={edit === 'new' ? undefined : edit} taken={rows.map(r => r.platform)} onClose={() => setEdit(null)} />}
    </>
  );
}

type CountryRow = RowOf<'country'>;

function CountryDialog(props: { row?: CountryRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [code, setCode] = useState(r?.code ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [dialCode, setDial] = useState(r?.dialCode ?? '+');
  const [flagUrl, setFlag] = useState(r?.flagUrl ?? '');
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 100);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={r ? t('coEdit') : t('coAdd')}
      width={520}
      onClose={props.onClose}
      testId="co-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="co-form" className="btn btn-primary" disabled={busy} data-testid="dialog-save">
            {t('save')}
          </button>
        </>
      }
    >
      <form
        id="co-form"
        className="form-grid"
        onSubmit={async e => {
          e.preventDefault();
          if (trMissingDefault(name, def)) {
            setErr(t('trRequired', { lang: def }));
            return;
          }
          setBusy(true);
          const res = await run(c => c.reducers.adminSaveCountry({ code: code.trim().toUpperCase(), name, dialCode: latin(dialCode).trim(), flagUrl: flagUrl.trim(), isActive, sort }), t('saved'));
          setBusy(false);
          if (res.ok) props.onClose();
          else setErr(errorText(res.err));
        }}
      >
        <Field label={t('coCode')} required>
          <input className="input ltr" name="code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} disabled={!!r} maxLength={2} autoFocus={!r} />
        </Field>
        <Field label={t('coDial')} required>
          <input className="input ltr" name="dialCode" value={dialCode} onChange={e => setDial(e.target.value)} />
        </Field>
        <Field label={t('name')} required className="span-2">
          <TrInputs value={name} onChange={setName} required name="name" />
        </Field>
        <Field label={t('coFlag')} hint={t('brUrlHint')}>
          <input className="input ltr" value={flagUrl} onChange={e => setFlag(e.target.value)} placeholder="https://" />
        </Field>
        <Field label={t('sort')}>
          <NumInput value={sort} onChange={setSort} />
        </Field>
        <div className="span-2">
          <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
        </div>
        <div className="span-2">
          <ErrBox text={err} />
        </div>
      </form>
    </Dialog>
  );
}

export function CountriesSection(props: { ro: boolean }) {
  const all = useRows('country');
  const { def } = useLanguages();
  const l = useLocale();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(40);
  const [edit, setEdit] = useState<CountryRow | 'new' | null>(null);
  const needle = latin(q).trim().toLowerCase();
  const rows = useMemo(
    () =>
      [...all]
        .filter(c => !needle || c.code.toLowerCase().includes(needle) || c.dialCode.includes(needle) || c.name.some(n => n.text.toLowerCase().includes(needle)))
        .sort((a, b) => a.sort - b.sort || trText(a.name, def).localeCompare(trText(b.name, def), l)),
    [all, needle, def, l]
  );
  const active = all.filter(c => c.isActive).length;
  return (
    <>
      <SectionTop action={<Add label={t('coAdd')} onClick={() => setEdit('new')} testId="co-add" ro={props.ro} />}>
        <div className="input-affix" style={{ width: 280, maxWidth: '100%' }}>
          <MagnifyingGlass className="ic" />
          <input className="input" value={q} onChange={e => { setQ(e.target.value); setLimit(40); }} placeholder={t('coSearch')} aria-label={t('coSearch')} data-testid="co-search" />
        </div>
        <span className="small muted">{t('coActive', { n: active })}</span>
      </SectionTop>
      <div className="card">
        {all.length === 0 ? (
          <ListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          <Empty icon={<GlobeHemisphereEast className="ic" weight="duotone" />} title={t('coEmpty')} />
        ) : (
          <div className="list" data-testid="co-list">
            {rows.slice(0, limit).map(c => (
              <div className="list-row" key={c.code} data-testid={`co-row-${c.code}`}>
                <span className="tr-lang" style={{ height: 28, minWidth: 36, justifyContent: 'center' }}>
                  {c.code}
                </span>
                <div className="list-main">
                  <span className="list-title">{trText(c.name, def)}</span>
                  <span className="list-sub" dir="ltr" style={{ textAlign: 'start' }}>
                    {digits(c.dialCode)}
                  </span>
                </div>
                <Switch checked={c.isActive} disabled={props.ro} label={t('active')} testId={`co-active-${c.code}`} onChange={v => runToast(x => x.reducers.adminSetCountryActive({ code: c.code, isActive: v }), t('saved'))} />
                {!props.ro && (
                  <div className="row-actions">
                    <Btn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(c)} testId={`co-edit-${c.code}`} />
                    <Btn
                      label={t('delete')}
                      icon={<Trash className="ic" />}
                      danger
                      testId={`co-del-${c.code}`}
                      onClick={async () => {
                        if (await confirmAsk(t('coDeleteConfirm', { name: trText(c.name, def) }), { danger: true, ok: t('delete') }))
                          await runToast(x => x.reducers.adminDeleteCountry({ code: c.code }), t('deleted'));
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            {rows.length > limit && (
              <div className="list-row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setLimit(limit + 60)}>
                  {t('loadMore')} ({num(rows.length - limit)})
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {edit && <CountryDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

type TitleRow = RowOf<'reportTitle'>;

function TitleDialog(props: { row?: TitleRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={r ? t('rtEdit') : t('rtAdd')}
      width={540}
      onClose={props.onClose}
      testId="rt-dialog"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="rt-form" className="btn btn-primary" disabled={busy} data-testid="dialog-save">
            {t('save')}
          </button>
        </>
      }
    >
      <form
        id="rt-form"
        className="form-grid"
        onSubmit={async e => {
          e.preventDefault();
          if (trMissingDefault(name, def)) {
            setErr(t('trRequired', { lang: def }));
            return;
          }
          setBusy(true);
          const res = await run(c => c.reducers.adminSaveReportTitle({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, description, isActive, sort }), t('saved'));
          setBusy(false);
          if (res.ok) props.onClose();
          else setErr(errorText(res.err));
        }}
      >
        <Field label={t('key')} hint={t('ktKeyHint')} required>
          <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus={!r} />
        </Field>
        <Field label={t('sort')}>
          <NumInput value={sort} onChange={setSort} />
        </Field>
        <Field label={t('name')} required className="span-2">
          <TrInputs value={name} onChange={setName} required name="name" />
        </Field>
        <Field label={t('description')} className="span-2" hint={t('optional')}>
          <TrInputs value={description} onChange={setDescription} name="description" />
        </Field>
        <div className="span-2">
          <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
        </div>
        <div className="span-2">
          <ErrBox text={err} />
        </div>
      </form>
    </Dialog>
  );
}

export function ReportTitlesSection(props: { ro: boolean }) {
  const list = useRows('reportTitle');
  const { def } = useLanguages();
  const [edit, setEdit] = useState<TitleRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <>
      <SectionTop action={<Add label={t('rtAdd')} onClick={() => setEdit('new')} testId="rt-add" ro={props.ro} />} />
      <div className="card">
        {rows.length === 0 ? (
          <ListSkeleton rows={4} />
        ) : (
          <div className="list">
            {rows.map(x => (
              <div className="list-row" key={String(x.id)} data-testid={`rt-row-${x.key}`}>
                <ListBullets className="ic muted" weight="duotone" />
                <div className="list-main">
                  <span className="list-title">{trText(x.name, def) || x.key}</span>
                  <span className="list-sub">
                    <span className="mono">{x.key}</span>
                    {trText(x.description, def) ? ` · ${trText(x.description, def)}` : ''}
                  </span>
                </div>
                {!x.isActive && <span className="badge">{t('inactive')}</span>}
                {!props.ro && (
                  <div className="row-actions">
                    <Btn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(x)} testId={`rt-edit-${x.key}`} />
                    <Btn
                      label={t('delete')}
                      icon={<Trash className="ic" />}
                      danger
                      testId={`rt-del-${x.key}`}
                      onClick={async () => {
                        if (await confirmAsk(t('rtDeleteConfirm', { name: trText(x.name, def) || x.key }), { danger: true, ok: t('delete') }))
                          await runToast(c => c.reducers.adminDeleteReportTitle({ id: x.id }), t('deleted'));
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <TitleDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

export function ReportRulesSection(props: { ro: boolean }) {
  const rules = useRows('adminReportRules')[0];
  const tagRows = useRows('tag');
  type V = { perHour: number; duplicateHours: number; minAccountHours: number; noteRequired: boolean; trustedTagIds: bigint[]; trustedPerHour: number };
  const [v, setV] = useState<V | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (rules && !v && tagRows.length)
      setV({
        perHour: rules.perHour,
        duplicateHours: rules.duplicateHours,
        minAccountHours: rules.minAccountHours,
        noteRequired: rules.noteRequired,
        trustedTagIds: rules.trustedTagIds.filter(id => tagRows.some(x => x.id === id)),
        trustedPerHour: rules.trustedPerHour,
      });
  }, [rules, v, tagRows.length]);
  if (!v) return <FormSkel n={4} />;
  return (
    <form
      className="stack stack-lg"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const r = await run(c => c.reducers.adminSaveReportRules(v), t('saved'));
        setBusy(false);
        setErr(r.ok ? null : errorText(r.err));
      }}
    >
      <div className="form-grid">
        <Field label={t('rrPerHour')} hint={t('rrPerHourHint')}>
          <NumInput value={v.perHour} onChange={n => setV({ ...v, perHour: n })} disabled={props.ro} name="perHour" />
        </Field>
        <Field label={t('rrDuplicate')} hint={t('rrDuplicateHint')}>
          <NumInput value={v.duplicateHours} onChange={n => setV({ ...v, duplicateHours: n })} disabled={props.ro} name="duplicateHours" />
        </Field>
        <Field label={t('rrMinAge')}>
          <NumInput value={v.minAccountHours} onChange={n => setV({ ...v, minAccountHours: n })} disabled={props.ro} name="minAccountHours" />
        </Field>
        <Field label={t('rrTrustedPerHour')}>
          <NumInput value={v.trustedPerHour} onChange={n => setV({ ...v, trustedPerHour: n })} disabled={props.ro} name="trustedPerHour" />
        </Field>
        <div className="span-2">
          <SwitchRow checked={v.noteRequired} onChange={b => setV({ ...v, noteRequired: b })} disabled={props.ro} label={t('rrNoteReq')} />
        </div>
        <Field label={t('rrTrusted')} hint={t('rrTrustedHint')} className="span-2">
          <TagPicker keyType="user" value={v.trustedTagIds} onChange={ids => setV({ ...v, trustedTagIds: ids })} disabled={props.ro} testId="rr-trusted" />
        </Field>
      </div>
      <ErrBox text={err} />
      {!props.ro && <Actions busy={busy} testId="rr-save" />}
    </form>
  );
}

const SECRET = '********';

type MethodRow = RowOf<'adminPaymentMethods'>;

function MethodCard(props: { row: MethodRow }) {
  const m = props.row;
  const parsed = useMemo(() => {
    try {
      return JSON.parse(m.config || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }, [m.config]);
  const [cfg, setCfg] = useState<Record<string, unknown>>(parsed);
  const [active, setActive] = useState(m.isActive);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setCfg(parsed);
    setActive(m.isActive);
  }, [m.config, m.isActive]);
  const label = (n: string) => {
    const k = `f_${n}` as StrKey;
    const v = t(k);
    return v || n;
  };
  const methodName = m.method === 'zarinpal' ? t('mZarinpal') : m.method === 'zibal' ? t('mZibal') : m.method === 'bazaar' ? t('mBazaar') : m.method === 'myket' ? t('mMyket') : m.method === 'in_app' ? t('mInApp') : m.method;
  return (
    <form
      className={`method-card ${m.isActive ? 'on' : ''}`}
      data-testid={`pm-${m.method}`}
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        const r = await run(c => c.reducers.adminSavePaymentMethod({ method: m.method, isActive: active, config: JSON.stringify(cfg) }), t('pmSaved'));
        setBusy(false);
        if (!r.ok) setErr(errorText(r.err));
      }}
    >
      <div className="row row-wrap">
        <CreditCard className="ic" weight="duotone" style={{ color: m.isActive ? 'var(--accent-ink)' : 'var(--ink-3)' }} />
        <b className="grow">{methodName}</b>
        {parsed.sandbox === true && <span className="badge b-warn">{t('pmSandbox')}</span>}
        <span className={`badge ${m.configured ? 'b-ok' : ''}`} data-testid={`pm-${m.method}-configured`}>
          {m.configured ? t('pmConfigured') : t('pmNotConfigured')}
        </span>
        <label className="check">
          <Switch checked={active} onChange={setActive} label={t('pmActive')} testId={`pm-${m.method}-active`} />
          {t('pmActive')}
        </label>
      </div>
      {m.fields.length === 0 ? (
        <span className="small muted">{t('pmNoFields')}</span>
      ) : (
        <div className="form-grid">
          {m.fields.map(f =>
            f.type === 'bool' ? (
              <div className="span-2" key={f.name}>
                <SwitchRow checked={cfg[f.name] === true} onChange={b => setCfg({ ...cfg, [f.name]: b })} label={label(f.name)} testId={`pm-${m.method}-${f.name}`} />
              </div>
            ) : (
              <Field
                key={f.name}
                label={label(f.name)}
                required={f.required}
                className={f.type === 'textarea' ? 'span-2' : undefined}
                hint={f.type === 'secret' && cfg[f.name] === SECRET ? t('pmSecretKeep') : undefined}
              >
                {f.type === 'textarea' ? (
                  <textarea className="textarea ltr" name={`${m.method}-${f.name}`} value={String(cfg[f.name] ?? '')} onChange={e => setCfg({ ...cfg, [f.name]: e.target.value })} />
                ) : (
                  <input
                    className="input ltr"
                    name={`${m.method}-${f.name}`}
                    type={f.type === 'secret' && cfg[f.name] === SECRET ? 'password' : 'text'}
                    autoComplete="off"
                    value={String(cfg[f.name] ?? '')}
                    onChange={e => setCfg({ ...cfg, [f.name]: e.target.value })}
                    onFocus={e => f.type === 'secret' && cfg[f.name] === SECRET && e.target.select()}
                  />
                )}
              </Field>
            )
          )}
        </div>
      )}
      <ErrBox text={err} />
      <div className="row">
        <SaveButton busy={busy} testId={`pm-${m.method}-save`} />
      </div>
    </form>
  );
}

export function PaymentMethodsSection() {
  const list = useRows('adminPaymentMethods');
  const order = ['zarinpal', 'zibal', 'bazaar', 'myket', 'in_app'];
  const rows = [...list].sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method));
  if (!rows.length) return <ListSkeleton rows={3} />;
  return (
    <div className="stack">
      {rows.map(m => (
        <MethodCard key={m.method} row={m} />
      ))}
    </div>
  );
}

export function EconomySettingsSection() {
  const s = useRows('adminEconomySettings')[0];
  const [v, setV] = useState<null | { publicBaseUrl: string; redirectUrl: string; pendingTtlMinutes: number }>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (s && !v) setV({ publicBaseUrl: s.publicBaseUrl, redirectUrl: s.redirectUrl, pendingTtlMinutes: s.pendingTtlMinutes });
  }, [s, v]);
  if (!v) return <FormSkel n={3} />;
  return (
    <form
      className="stack stack-lg"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const r = await run(c => c.reducers.adminSaveEconomySettings(v), t('saved'));
        setBusy(false);
        setErr(r.ok ? null : errorText(r.err));
      }}
    >
      <div className="form-grid">
        <Field label={t('esBase')} hint={t('esBaseHint')} className="span-2">
          <input className="input ltr" name="publicBaseUrl" value={v.publicBaseUrl} onChange={e => setV({ ...v, publicBaseUrl: e.target.value })} placeholder="https://" />
        </Field>
        <Field label={t('esRedirect')} hint={t('esRedirectHint')} className="span-2">
          <input className="input ltr" name="redirectUrl" value={v.redirectUrl} onChange={e => setV({ ...v, redirectUrl: e.target.value })} placeholder="mygame://pay?ok={success}&id={paymentId}" />
        </Field>
        <Field label={t('esTtl')} hint={t('esTtlHint')}>
          <NumInput value={v.pendingTtlMinutes} onChange={n => setV({ ...v, pendingTtlMinutes: n })} name="pendingTtlMinutes" />
        </Field>
      </div>
      {v.publicBaseUrl && (
        <Notice kind="plain" title={t('esCallback')} text={<span className="mono ltr">{`${v.publicBaseUrl.replace(/\/+$/, '')}/v1/database/…/route/economy/callback`}</span>} />
      )}
      <ErrBox text={err} />
      <Actions busy={busy} testId="es-save" />
    </form>
  );
}

export function AdminLoginSection() {
  const st = useRows('adminSettings')[0];
  const { can } = useSession();
  const owner = can('owner');
  const [v, setV] = useState<null | { adminLoginMaxAttempts: number; adminLoginLockMinutes: number }>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (st && !v) setV({ adminLoginMaxAttempts: st.adminLoginMaxAttempts, adminLoginLockMinutes: st.adminLoginLockMinutes });
  }, [st, v]);
  if (!v) return <FormSkel n={2} />;
  return (
    <form
      className="stack stack-lg"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const r = await run(c => c.reducers.adminSaveLoginRules(v), t('saved'));
        setBusy(false);
        setErr(r.ok ? null : errorText(r.err));
      }}
    >
      <p className="small muted">{t('alIntro')}</p>
      {!owner && <Notice kind="plain" text={t('alOwnerOnly')} />}
      <div className="form-grid">
        <Field label={t('alMax')} hint={t('alMaxHint')}>
          <NumInput value={v.adminLoginMaxAttempts} onChange={n => setV({ ...v, adminLoginMaxAttempts: n })} disabled={!owner} name="adminLoginMaxAttempts" />
        </Field>
        <Field label={t('alLock')} hint={t('alLockHint')}>
          <NumInput value={v.adminLoginLockMinutes} onChange={n => setV({ ...v, adminLoginLockMinutes: n })} disabled={!owner} name="adminLoginLockMinutes" />
        </Field>
      </div>
      <ErrBox text={err} />
      {owner && (
        <div className="form-actions">
          <SaveButton busy={busy} testId="al-save" />
          <span className="grow" />
          <button
            type="button"
            className="btn btn-outline"
            data-testid="al-unlock"
            onClick={async () => {
              if (await confirmAsk(t('alUnlockConfirm'), { ok: t('alUnlock') })) await runToast(c => c.reducers.adminClearLoginLocks({}), t('alUnlocked'));
            }}
          >
            {t('alUnlock')}
          </button>
        </div>
      )}
    </form>
  );
}
