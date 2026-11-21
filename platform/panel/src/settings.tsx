import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Broom, ChatCircleText, CheckCircle, DeviceMobile, FolderSimple, Key, MagicWand, PaperPlaneTilt, PencilSimple, Plus, Star, Tag, Translate, Trash, Tray, X } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { getConn, useRows } from './conn.ts';
import { date, digits, errorText, latin, num, numeric, phone as fmtPhone, t, useLocale } from './i18n.ts';
import { closeSettings, openSettings, run, runToast, trText, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { GROUPS, SECTIONS } from './nav.tsx';
import { Empty, ErrBox, Field, ListSkeleton, Notice, NumInput, SaveButton, Skel, Switch, TrInputs, confirmAsk, trMissingDefault, useEscape } from './ui.tsx';
import {
  CategoryDialog,
  KeyTypeDialog,
  KeyTypePicker,
  LanguageDialog,
  ProviderDialog,
  TagDialog,
  TestPhoneDialog,
  TestSmsDialog,
  kindLabel,
  type CategoryRow,
  type KeyTypeRow,
  type LanguageRow,
  type ProviderRow,
  type TagRow,
  type TestPhoneRow,
} from './dialogs.tsx';
import { openWizard } from './shell.tsx';
import { AdminLoginSection, AccountRulesSection, AppVersionsSection, CountriesSection, EconomySettingsSection, PaymentMethodsSection, ReportRulesSection, ReportTitlesSection } from './settings2.tsx';

export function SettingsWindow() {
  const route = useRoute();
  const { can } = useSession();
  useLocale();
  const allowed = SECTIONS.filter(s => can(s.need));
  const mobile = window.matchMedia('(max-width: 767px)').matches;
  const section = allowed.find(s => s.id === route.settings) ?? (mobile && !route.settings ? undefined : allowed[0]);
  useEscape(closeSettings);
  useEffect(() => {
    if (route.settings && !allowed.some(s => s.id === route.settings) && allowed[0]) openSettings(allowed[0].id);
  }, [route.settings, allowed.length]);
  const ro = section ? !can('admin') : false;
  return createPortal(
    <div className="layer" data-testid="settings">
      <div className="scrim" onClick={closeSettings} />
      <div className={`win ${section ? 'has-section' : ''}`} role="dialog" aria-modal="true" aria-label={t('stTitle')}>
        <nav className="win-nav" aria-label={t('stTitle')}>
          <div className="row win-title">
            <span className="grow">{t('stTitle')}</span>
            <button type="button" className="btn btn-icon win-nav-close" onClick={closeSettings} aria-label={t('close')}>
              <X className="ic" />
            </button>
          </div>
          {GROUPS.map(g => {
            const list = allowed.filter(s => s.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id} className="stack" style={{ gap: 2 }}>
                <div className="side-label">{g.label()}</div>
                {list.map(s => {
                  const Icon = s.icon;
                  return (
                    <a key={s.id} href={`#/settings/${s.id}`} className="nav" aria-current={section?.id === s.id ? 'page' : undefined} data-testid={`st-nav-${s.id}`}>
                      <Icon className="ic" weight={section?.id === s.id ? 'duotone' : 'regular'} />
                      <span className="nav-label">{s.label()}</span>
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="win-body">
          <div className="win-head">
            <a href="#/settings/" className="btn btn-icon win-back" aria-label={t('back')}>
              <ArrowRight className="ic" style={{ transform: document.documentElement.dir === 'rtl' ? undefined : 'scaleX(-1)' }} />
            </a>
            <h2 data-testid="st-title">{section?.label()}</h2>
            {ro && <span className="badge">{t('readOnly')}</span>}
            <button type="button" className="btn btn-icon" onClick={closeSettings} aria-label={t('close')} data-testid="st-close">
              <X className="ic" />
            </button>
          </div>
          <div className="win-scroll" key={section?.id} data-testid={`st-${section?.id}`}>
            {section?.id === 'brand' && <BrandSection ro={ro} />}
            {section?.id === 'languages' && <LanguagesSection ro={ro} />}
            {section?.id === 'setup' && <SetupSection />}
            {section?.id === 'key-types' && <KeyTypesSection ro={ro} />}
            {section?.id === 'categories' && <CategoriesSection ro={ro} />}
            {section?.id === 'tags' && <TagsSection ro={ro} />}
            {section?.id === 'sms' && <SmsSection />}
            {section?.id === 'test-phones' && <TestPhonesSection />}
            {section?.id === 'sandbox' && <SandboxSection />}
            {section?.id === 'otp' && <OtpSection ro={ro} />}
            {section?.id === 'admin-login' && <AdminLoginSection />}
            {section?.id === 'account-rules' && <AccountRulesSection ro={ro} />}
            {section?.id === 'app-versions' && <AppVersionsSection ro={ro} />}
            {section?.id === 'countries' && <CountriesSection ro={ro} />}
            {section?.id === 'report-titles' && <ReportTitlesSection ro={ro} />}
            {section?.id === 'report-rules' && <ReportRulesSection ro={ro} />}
            {section?.id === 'payment-methods' && <PaymentMethodsSection />}
            {section?.id === 'economy-settings' && <EconomySettingsSection />}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function FormSkeleton(props: { fields: number }) {
  return (
    <div className="form-grid">
      {Array.from({ length: props.fields }).map((_, i) => (
        <div className="field" key={i}>
          <Skel w={90} h={10} />
          <Skel h={36} r={6} />
        </div>
      ))}
    </div>
  );
}

export function useBrandForm() {
  const brand = useRows('brand')[0];
  const [v, setV] = useState<null | {
    name: Tr[];
    shortName: string;
    logoUrl: string;
    iconUrl: string;
    primaryColor: string;
    supportPhone: string;
    supportEmail: string;
    website: string;
  }>(null);
  useEffect(() => {
    if (brand && !v)
      setV({
        name: brand.name,
        shortName: brand.shortName,
        logoUrl: brand.logoUrl,
        iconUrl: brand.iconUrl,
        primaryColor: brand.primaryColor,
        supportPhone: brand.supportPhone,
        supportEmail: brand.supportEmail,
        website: brand.website,
      });
  }, [brand, v]);
  return { v, setV, brand };
}

export async function saveBrand(v: NonNullable<ReturnType<typeof useBrandForm>['v']>, def: string) {
  if (trMissingDefault(v.name, def)) return t('trRequired', { lang: def });
  const r = await run(c => c.reducers.adminSaveBrand({ ...v, supportPhone: latin(v.supportPhone) }), t('saved'));
  return r.ok ? null : errorText(r.err);
}

export function BrandFields(props: { v: NonNullable<ReturnType<typeof useBrandForm>['v']>; set: (v: NonNullable<ReturnType<typeof useBrandForm>['v']>) => void; ro?: boolean; compact?: boolean }) {
  const { v, set, ro } = props;
  const up = (p: Partial<typeof v>) => set({ ...v, ...p });
  const color = /^#[0-9a-fA-F]{6}$/.test(v.primaryColor) ? v.primaryColor : '#3f76ff';
  return (
    <div className="form-grid">
      <Field label={t('brName')} required className="span-2">
        <TrInputs value={v.name} onChange={name => up({ name })} required disabled={ro} name="brand-name" />
      </Field>
      <Field label={t('brShortName')} hint={t('brShortHint')}>
        <input className="input" name="shortName" value={v.shortName} onChange={e => up({ shortName: e.target.value })} disabled={ro} maxLength={40} />
      </Field>
      <Field label={t('brColor')}>
        <div className="input-group">
          <input type="color" className="color-input" value={color} onChange={e => up({ primaryColor: e.target.value })} disabled={ro} aria-label={t('brColor')} />
          <input className="input ltr grow" name="primaryColor" value={v.primaryColor} onChange={e => up({ primaryColor: e.target.value })} disabled={ro} />
        </div>
      </Field>
      <Field label={t('brLogo')} hint={t('brUrlHint')} className={props.compact ? 'span-2' : undefined}>
        <input className="input ltr" name="logoUrl" value={v.logoUrl} onChange={e => up({ logoUrl: e.target.value })} disabled={ro} placeholder="https://" />
      </Field>
      {!props.compact && (
        <Field label={t('brIcon')} hint={t('brUrlHint')}>
          <input className="input ltr" name="iconUrl" value={v.iconUrl} onChange={e => up({ iconUrl: e.target.value })} disabled={ro} placeholder="https://" />
        </Field>
      )}
    </div>
  );
}

function BrandSection(props: { ro: boolean }) {
  const { v, setV } = useBrandForm();
  const { def } = useLanguages();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v)
    return (
      <>
        <FormSkeleton fields={6} />
      </>
    );
  const up = (p: Partial<typeof v>) => setV({ ...v, ...p });
  const name = trText(v.name, def);
  return (
    <form
      className="stack stack-lg"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setErr(await saveBrand(v, def));
        setBusy(false);
      }}
    >
      <div className="brand-preview">
        <div className="auth-mark" style={{ background: /^#[0-9a-fA-F]{6}$/.test(v.primaryColor) ? v.primaryColor : undefined }}>
          {v.logoUrl ? <img src={v.logoUrl} alt="" /> : (v.shortName || name).slice(0, 2)}
        </div>
        <div className="stack" style={{ gap: 0 }}>
          <b>{name || '—'}</b>
          <span className="small muted">{t('brPreview')}</span>
        </div>
      </div>
      <div className="section-label">{t('brIdentity')}</div>
      <BrandFields v={v} set={setV} ro={props.ro} />
      <div className="section-label">{t('brContact')}</div>
      <div className="form-grid">
        <Field label={t('brSupportPhone')}>
          <input className="input ltr" name="supportPhone" value={digits(v.supportPhone)} onChange={e => up({ supportPhone: latin(e.target.value) })} disabled={props.ro} inputMode="tel" />
        </Field>
        <Field label={t('brSupportEmail')}>
          <input className="input ltr" name="supportEmail" value={v.supportEmail} onChange={e => up({ supportEmail: e.target.value })} disabled={props.ro} inputMode="email" />
        </Field>
        <Field label={t('brWebsite')} hint={t('brUrlHint')} className="span-2">
          <input className="input ltr" name="website" value={v.website} onChange={e => up({ website: e.target.value })} disabled={props.ro} placeholder="https://" />
        </Field>
      </div>
      <ErrBox text={err} />
      {!props.ro && (
        <div className="form-actions">
          <SaveButton busy={busy} testId="brand-save" />
        </div>
      )}
    </form>
  );
}

function SectionHead(props: { text?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="row row-wrap">
      {props.children}
      {props.text && <p className="small muted grow">{props.text}</p>}
      {!props.text && <span className="grow" />}
      {props.action}
    </div>
  );
}

function AddBtn(props: { label: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="btn btn-primary" onClick={props.onClick} data-testid={props.testId}>
      <Plus className="ic" />
      {props.label}
    </button>
  );
}

function RowBtn(props: { label: string; onClick: () => void; testId?: string; danger?: boolean; icon: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      className={`btn btn-sm btn-icon ${props.danger ? 'btn-danger-ghost' : ''}`}
      onClick={props.onClick}
      aria-label={props.label}
      title={props.title ?? props.label}
      data-testid={props.testId}
      disabled={props.disabled}
    >
      {props.icon}
    </button>
  );
}

function LanguagesSection(props: { ro: boolean }) {
  const { all } = useLanguages();
  const [edit, setEdit] = useState<LanguageRow | 'new' | null>(null);
  async function del(l: LanguageRow) {
    if (!(await confirmAsk(t('lgDeleteConfirm', { name: l.name }), { danger: true, ok: t('delete') }))) return;
    await runToast(c => c.reducers.adminDeleteLanguage({ code: l.code }), t('deleted'));
  }
  return (
    <>
      <SectionHead action={!props.ro && <AddBtn label={t('lgAdd')} onClick={() => setEdit('new')} testId="lg-add" />} />
      <div className="card">
        {all.length === 0 ? (
          <ListSkeleton rows={2} />
        ) : (
          <div className="list">
            {all.map(l => (
              <div className="list-row" key={l.code} data-testid={`lg-row-${l.code}`}>
                <span className="tr-lang" style={{ height: 28 }}>
                  {l.code}
                </span>
                <div className="list-main">
                  <span className="list-title" dir={l.dir}>
                    {l.name}
                  </span>
                  <span className="list-sub">
                    {l.dir === 'rtl' ? t('lgRtl') : t('lgLtr')} · {t('lgSort')} {num(l.sort)}
                  </span>
                </div>
                {l.isDefault && (
                  <span className="badge b-info">
                    <Star className="ic" weight="fill" />
                    {t('lgDefault')}
                  </span>
                )}
                <span className={`badge ${l.isActive ? 'b-ok' : ''}`}>{l.isActive ? t('active') : t('inactive')}</span>
                {!props.ro && (
                  <div className="row-actions">
                    {!l.isDefault && l.isActive && (
                      <button type="button" className="btn btn-sm" onClick={() => runToast(c => c.reducers.adminSetDefaultLanguage({ code: l.code }), t('lgDefaultChanged'))} data-testid={`lg-default-${l.code}`}>
                        {t('lgMakeDefault')}
                      </button>
                    )}
                    <RowBtn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(l)} testId={`lg-edit-${l.code}`} />
                    <RowBtn label={t('delete')} icon={<Trash className="ic" />} onClick={() => del(l)} danger disabled={l.isDefault} testId={`lg-del-${l.code}`} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <LanguageDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SetupSection() {
  const settings = useRows('adminSettings')[0];
  return (
    <>
      <Notice
        kind={settings?.setupDone ? 'plain' : 'info'}
        icon={settings?.setupDone ? <CheckCircle className="ic" weight="duotone" /> : <MagicWand className="ic" weight="duotone" />}
        title={settings?.setupDone ? t('stSetupDone') : t('stSetupPending')}
        text={t('stSetupText')}
        action={
          <button type="button" className="btn btn-primary" onClick={openWizard} data-testid="st-open-wizard">
            {t('stSetupOpen')}
          </button>
        }
      />
    </>
  );
}

function KeyTypesSection(props: { ro: boolean }) {
  const list = useRows('keyType');
  const { def } = useLanguages();
  const [edit, setEdit] = useState<KeyTypeRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => Number(b.system) - Number(a.system) || a.key.localeCompare(b.key));
  async function del(k: KeyTypeRow) {
    if (!(await confirmAsk(t('ktDeleteConfirm', { key: k.key }), { danger: true, ok: t('delete') }))) return;
    await runToast(c => c.reducers.adminDeleteKeyType({ key: k.key }), t('deleted'));
  }
  return (
    <>
      <SectionHead action={!props.ro && <AddBtn label={t('ktAdd')} onClick={() => setEdit('new')} testId="kt-add" />} />
      <div className="card">
        {rows.length === 0 ? (
          <ListSkeleton rows={2} />
        ) : (
          <div className="list">
            {rows.map(k => (
              <div className="list-row" key={k.key} data-testid={`kt-row-${k.key}`}>
                <div className="tile-ic badge" style={{ width: 32, height: 32, padding: 0, justifyContent: 'center', gridRow: 'auto' }}>
                  <Key className="ic" weight="duotone" style={{ width: 18, height: 18 }} />
                </div>
                <div className="list-main">
                  <span className="list-title">{trText(k.title, def) || k.key}</span>
                  <span className="list-sub mono">{k.key}</span>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {k.forCategory && <span className="badge b-warn">{t('stCategories')}</span>}
                  {k.forTag && <span className="badge b-teal">{t('stTags')}</span>}
                  {k.system && <span className="badge">{t('ktSystem')}</span>}
                </div>
                {!props.ro && (
                  <div className="row-actions">
                    <RowBtn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(k)} testId={`kt-edit-${k.key}`} />
                    <RowBtn label={t('delete')} icon={<Trash className="ic" />} onClick={() => del(k)} danger disabled={k.system} testId={`kt-del-${k.key}`} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <KeyTypeDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function useKeyTypeFilter(kind: 'category' | 'tag') {
  const route = useRoute();
  const kts = useRows('keyType').filter(k => (kind === 'category' ? k.forCategory : k.forTag));
  const fromUrl = route.query.get('kt') ?? '';
  const [kt, setKt] = useState(fromUrl || sessionStorage.getItem(`stg.kt.${kind}`) || 'general');
  useEffect(() => {
    if (kts.length && !kts.some(k => k.key === kt)) setKt(kts[0].key);
  }, [kts.length, kt]);
  return {
    kt,
    setKt: (v: string) => {
      sessionStorage.setItem(`stg.kt.${kind}`, v);
      setKt(v);
    },
    has: kts.length > 0,
    loaded: useRows('keyType').length > 0,
  };
}

function CategoriesSection(props: { ro: boolean }) {
  const all = useRows('category');
  const { def } = useLanguages();
  const f = useKeyTypeFilter('category');
  const [edit, setEdit] = useState<{ row?: CategoryRow; parentId?: bigint } | null>(null);
  const tree = useMemo(() => {
    const list = all.filter(c => c.keyType === f.kt);
    const ids = new Set(list.map(c => c.id));
    const out: { c: CategoryRow; depth: number }[] = [];
    const walk = (parent: bigint, depth: number) => {
      list
        .filter(c => (depth === 0 ? !c.parentId || !ids.has(c.parentId) : c.parentId === parent))
        .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
        .forEach(c => {
          out.push({ c, depth });
          if (depth < 20) walk(c.id, depth + 1);
        });
    };
    walk(0n, 0);
    return out;
  }, [all, f.kt]);
  async function del(c: CategoryRow) {
    if (!(await confirmAsk(t('ctDeleteConfirm', { name: trText(c.title, def) || c.key }), { danger: true, ok: t('delete') }))) return;
    await runToast(x => x.reducers.adminDeleteCategory({ id: c.id }), t('deleted'));
  }
  return (
    <>
      <SectionHead action={!props.ro && f.has && <AddBtn label={t('ctAdd')} onClick={() => setEdit({})} testId="ct-add" />}>
        <div style={{ width: 280, maxWidth: '100%' }}>
          <KeyTypePicker value={f.kt} onChange={f.setKt} kind="category" disabled={props.ro && false} testId="ct-filter" />
        </div>
      </SectionHead>
      {!f.loaded ? (
        <div className="card">
          <ListSkeleton />
        </div>
      ) : !f.has ? (
        <Notice kind="warn" text={t('ctNoKeyType')} />
      ) : (
        <div className="card">
          {tree.length === 0 ? (
            <Empty
              icon={<FolderSimple className="ic" weight="duotone" />}
              title={t('ctEmpty')}
              action={!props.ro && <AddBtn label={t('ctAdd')} onClick={() => setEdit({})} testId="ct-add-empty" />}
            />
          ) : (
            <div className="list" data-testid="ct-tree">
              {tree.map(({ c, depth }) => (
                <div className="list-row" key={String(c.id)} data-testid={`ct-row-${c.key}`}>
                  <span className="tree-indent" style={{ width: depth * 20 }} />
                  <FolderSimple className="ic muted" weight={depth ? 'regular' : 'duotone'} />
                  <div className="list-main">
                    <span className="list-title">{trText(c.title, def) || c.key}</span>
                    <span className="list-sub">
                      <span className="mono">{c.key}</span>
                      {trText(c.description, def) ? ` · ${trText(c.description, def)}` : ''}
                    </span>
                  </div>
                  {!c.isActive && <span className="badge">{t('inactive')}</span>}
                  {!props.ro && (
                    <div className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEdit({ parentId: c.id })} data-testid={`ct-child-${c.key}`}>
                        <Plus className="ic" />
                        {t('ctAddChild')}
                      </button>
                      <RowBtn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit({ row: c })} testId={`ct-edit-${c.key}`} />
                      <RowBtn label={t('delete')} icon={<Trash className="ic" />} onClick={() => del(c)} danger testId={`ct-del-${c.key}`} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {edit && <CategoryDialog row={edit.row} parentId={edit.parentId} keyType={f.kt} onClose={() => setEdit(null)} />}
    </>
  );
}

function TagsSection(props: { ro: boolean }) {
  const all = useRows('tag');
  const metas = useRows('tagMeta');
  const { def } = useLanguages();
  const f = useKeyTypeFilter('tag');
  const [edit, setEdit] = useState<TagRow | 'new' | null>(null);
  const rows = all.filter(x => x.keyType === f.kt).sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  async function del(x: TagRow) {
    if (!(await confirmAsk(t('tgDeleteConfirm', { name: trText(x.title, def) || x.key }), { danger: true, ok: t('delete') }))) return;
    await runToast(c => c.reducers.adminDeleteTag({ id: x.id }), t('deleted'));
  }
  return (
    <>
      <SectionHead action={!props.ro && f.has && <AddBtn label={t('tgAdd')} onClick={() => setEdit('new')} testId="tg-add" />}>
        <div style={{ width: 280, maxWidth: '100%' }}>
          <KeyTypePicker value={f.kt} onChange={f.setKt} kind="tag" testId="tg-filter" />
        </div>
      </SectionHead>
      <div className="card">
        {!f.loaded ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <Empty icon={<Tag className="ic" weight="duotone" />} title={t('tgEmpty')} action={!props.ro && <AddBtn label={t('tgAdd')} onClick={() => setEdit('new')} testId="tg-add-empty" />} />
        ) : (
          <div className="list">
            {rows.map(x => (
              <div className="list-row" key={String(x.id)} data-testid={`tg-row-${x.key}`}>
                <span className="swatch" style={{ background: x.color || 'var(--well-2)' }} />
                <div className="list-main">
                  <span className="list-title">{trText(x.title, def) || x.key}</span>
                  <span className="list-sub">
                    <span className="mono">{x.key}</span>
                    {x.color ? <span className="mono"> · {x.color}</span> : null}
                  </span>
                </div>
                {!x.isActive && <span className="badge">{t('inactive')}</span>}
                {x.keyType === 'user' && (
                  <label className="check small" title={t('tgVisibleOn')}>
                    <Switch
                      checked={!!metas.find(m => m.tagId === x.id)?.isPublic}
                      disabled={props.ro}
                      label={t('tgVisible')}
                      testId={`tg-public-${x.key}`}
                      onChange={v => runToast(c => c.reducers.adminSetTagVisibility({ tagId: x.id, isPublic: v }), t('saved'))}
                    />
                    {t('tgVisible')}
                  </label>
                )}
                {!props.ro && (
                  <div className="row-actions">
                    <RowBtn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(x)} testId={`tg-edit-${x.key}`} />
                    <RowBtn label={t('delete')} icon={<Trash className="ic" />} onClick={() => del(x)} danger testId={`tg-del-${x.key}`} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <TagDialog row={edit === 'new' ? undefined : edit} keyType={f.kt} onClose={() => setEdit(null)} />}
    </>
  );
}

function SmsSection() {
  const list = useRows('adminSmsProviders');
  const [edit, setEdit] = useState<ProviderRow | 'new' | null>(null);
  const [test, setTest] = useState<ProviderRow | null>(null);
  const rows = [...list].sort((a, b) => Number(b.isActive) - Number(a.isActive) || (a.id < b.id ? -1 : 1));
  async function activate(p: ProviderRow) {
    await runToast(
      c => c.reducers.adminSaveSmsProvider({ id: p.id, kind: p.kind, name: p.name, apiKey: '', sender: p.sender, otpTemplate: p.otpTemplate, otpCodeVar: p.otpCodeVar, isActive: true }),
      t('smActivated')
    );
  }
  async function del(p: ProviderRow) {
    if (!(await confirmAsk(t('smDeleteConfirm', { name: p.name }), { danger: true, ok: t('delete') }))) return;
    await runToast(c => c.reducers.adminDeleteSmsProvider({ id: p.id }), t('deleted'));
  }
  return (
    <>
      <SectionHead action={<AddBtn label={t('smAdd')} onClick={() => setEdit('new')} testId="sm-add" />} />
      {rows.length === 0 ? (
        <div className="card">
          <ListSkeleton rows={2} />
        </div>
      ) : (
        <div className="stack">
          {rows.map(p => (
            <div className={`provider ${p.isActive ? 'on' : ''}`} key={String(p.id)} data-testid={`sm-row-${p.name}`}>
              <div className="row">
                <ChatCircleText className="ic" weight="duotone" style={{ color: p.isActive ? 'var(--accent-ink)' : 'var(--ink-3)' }} />
                <b className="grow ellipsis">{p.name}</b>
                <span className="badge">{kindLabel(p.kind)}</span>
                {p.isActive && (
                  <span className="badge b-ok">
                    <span className="dot" />
                    {t('smActive')}
                  </span>
                )}
              </div>
              {p.kind !== 'sandbox' && (
                <dl className="kv">
                  <dt>{t('smKey')}</dt>
                  <dd className="mono ltr" style={{ textAlign: 'start' }}>
                    {p.hasKey ? p.apiKeyMasked : t('smNoKey')}
                  </dd>
                  {p.sender && (
                    <>
                      <dt>{p.kind === 'smsir' ? t('smSenderSmsir') : t('smSender')}</dt>
                      <dd>{numeric(p.sender)}</dd>
                    </>
                  )}
                  {p.otpTemplate && (
                    <>
                      <dt>{t('smTemplate')}</dt>
                      <dd className="ltr" style={{ textAlign: 'start' }}>
                        {numeric(p.otpTemplate)}
                        {p.kind === 'smsir' ? ` · ${p.otpCodeVar}` : ''}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {p.kind === 'sandbox' && <span className="small muted">{t('smSandboxHint')}</span>}
              <div className="row row-wrap" style={{ gap: 4 }}>
                {!p.isActive && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => activate(p)} data-testid={`sm-activate-${p.name}`}>
                    <CheckCircle className="ic" />
                    {t('smActivate')}
                  </button>
                )}
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setTest(p)} data-testid={`sm-test-${p.name}`}>
                  <PaperPlaneTilt className="ic ic-dir" />
                  {t('smTest')}
                </button>
                <span className="grow" />
                <RowBtn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(p)} testId={`sm-edit-${p.name}`} />
                <RowBtn label={t('delete')} title={p.isActive ? t('smActiveNoDelete') : t('delete')} icon={<Trash className="ic" />} onClick={() => del(p)} danger disabled={p.isActive} testId={`sm-del-${p.name}`} />
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <ProviderDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {test && <TestSmsDialog provider={test} onClose={() => setTest(null)} />}
    </>
  );
}

function TestPhonesSection() {
  const list = useRows('adminTestPhones');
  const settings = useRows('adminSettings')[0];
  const [edit, setEdit] = useState<TestPhoneRow | 'new' | null>(null);
  async function del(p: TestPhoneRow) {
    if (!(await confirmAsk(t('tpDeleteConfirm', { phone: fmtPhone(p.phone) }), { danger: true, ok: t('delete') }))) return;
    await runToast(c => c.reducers.adminDeleteTestPhone({ phone: p.phone }), t('deleted'));
  }
  return (
    <>
      <SectionHead text={t('tpHint')} action={<AddBtn label={t('tpAdd')} onClick={() => setEdit('new')} testId="tp-add" />} />
      <div className="card">
        {!settings ? (
          <ListSkeleton rows={2} />
        ) : list.length === 0 ? (
          <Empty icon={<DeviceMobile className="ic" weight="duotone" />} title={t('tpEmpty')} text={t('tpHint')} />
        ) : (
          <div className="list">
            {list.map(p => (
              <div className="list-row" key={p.phone} data-testid={`tp-row-${p.phone}`}>
                <DeviceMobile className="ic muted" weight="duotone" />
                <div className="list-main">
                  <span className="list-title ltr" style={{ textAlign: 'start' }}>
                    {fmtPhone(p.phone)}
                  </span>
                  <span className="list-sub">{p.note || '—'}</span>
                </div>
                <span className="badge b-info ltr">{digits(p.code)}</span>
                <div className="row-actions">
                  <RowBtn label={t('edit')} icon={<PencilSimple className="ic" />} onClick={() => setEdit(p)} testId={`tp-edit-${p.phone}`} />
                  <RowBtn label={t('delete')} icon={<Trash className="ic" />} onClick={() => del(p)} danger testId={`tp-del-${p.phone}`} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {edit && <TestPhoneDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SandboxSection() {
  const list = useRows('adminSandboxSms');
  const settings = useRows('adminSettings')[0];
  const rows = [...list].sort((a, b) => (a.id < b.id ? 1 : -1));
  async function clear() {
    if (!(await confirmAsk(t('sbClearConfirm'), { danger: true, ok: t('sbClear') }))) return;
    await runToast(c => c.reducers.adminClearSandboxSms({}), t('done'));
  }
  return (
    <>
      <SectionHead
        text={t('sbHint')}
        action={
          <button type="button" className="btn btn-outline" onClick={clear} disabled={!rows.length} data-testid="sb-clear">
            <Broom className="ic" />
            {t('sbClear')}
          </button>
        }
      >
        <span className="badge b-ok">
          <span className="live-dot" style={{ width: 6, height: 6 }} />
          {t('sbLive')}
        </span>
      </SectionHead>
      <div className="card">
        {!settings ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <Empty icon={<Tray className="ic" weight="duotone" />} title={t('sbEmpty')} />
        ) : (
          <div className="list" data-testid="sb-list">
            {rows.map(m => (
              <div className="list-row" key={String(m.id)} style={{ alignItems: 'flex-start' }}>
                <ChatCircleText className="ic muted" weight="duotone" style={{ marginTop: 2 }} />
                <div className="list-main">
                  <span className="row" style={{ gap: 8 }}>
                    <b className="ltr">{fmtPhone(m.phone)}</b>
                    <span className="small muted">{date(m.at.toDate())}</span>
                  </span>
                  <span className="sms-text sub">{digits(m.text)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export type OtpValues = { otpLength: number; otpTtlSec: number; otpResendSec: number; otpMaxAttempts: number; otpDailyCap: number };

export function useOtpForm() {
  const s = useRows('adminSettings')[0];
  const [v, setV] = useState<OtpValues | null>(null);
  useEffect(() => {
    if (s && !v) setV({ otpLength: s.otpLength, otpTtlSec: s.otpTtlSec, otpResendSec: s.otpResendSec, otpMaxAttempts: s.otpMaxAttempts, otpDailyCap: s.otpDailyCap });
  }, [s, v]);
  return { v, setV };
}

export async function saveOtp(v: OtpValues) {
  const r = await run(c => c.reducers.adminSaveSettings(v), t('saved'));
  return r.ok ? null : errorText(r.err);
}

export function OtpFields(props: { v: OtpValues; set: (v: OtpValues) => void; ro?: boolean }) {
  const { v, set, ro } = props;
  const up = (p: Partial<OtpValues>) => set({ ...v, ...p });
  return (
    <div className="form-grid">
      <Field label={t('otLength')} hint={t('otLengthHint')}>
        <NumInput name="otpLength" value={v.otpLength} onChange={n => up({ otpLength: n })} disabled={ro} />
      </Field>
      <Field label={t('otTtl')} hint={t('otTtlHint')}>
        <NumInput name="otpTtlSec" value={v.otpTtlSec} onChange={n => up({ otpTtlSec: n })} disabled={ro} />
      </Field>
      <Field label={t('otResend')} hint={t('otResendHint')}>
        <NumInput name="otpResendSec" value={v.otpResendSec} onChange={n => up({ otpResendSec: n })} disabled={ro} />
      </Field>
      <Field label={t('otAttempts')} hint={t('otAttemptsHint')}>
        <NumInput name="otpMaxAttempts" value={v.otpMaxAttempts} onChange={n => up({ otpMaxAttempts: n })} disabled={ro} />
      </Field>
      <Field label={t('otDaily')} hint={t('otDailyHint')}>
        <NumInput name="otpDailyCap" value={v.otpDailyCap} onChange={n => up({ otpDailyCap: n })} disabled={ro} />
      </Field>
    </div>
  );
}

function OtpSection(props: { ro: boolean }) {
  const { v, setV } = useOtpForm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!v) return <FormSkeleton fields={5} />;
  return (
    <form
      className="stack stack-lg"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setErr(await saveOtp(v));
        setBusy(false);
      }}
    >
      <p className="small muted">{t('otIntro')}</p>
      <OtpFields v={v} set={setV} ro={props.ro} />
      <ErrBox text={err} />
      {!props.ro && (
        <div className="form-actions">
          <SaveButton busy={busy} testId="otp-save" />
        </div>
      )}
    </form>
  );
}

export { getConn };
