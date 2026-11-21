import { useId, useMemo, useState, type FormEvent } from 'react';
import { Eye, EyeSlash, Plus } from '@phosphor-icons/react';
import { useRows, getConn, type RowOf } from './conn.ts';
import { codeText, digits, errorText, latin, numeric, t } from './i18n.ts';
import { run, toast, trText, useLanguages, useSession, type Tr } from './app.ts';
import { Dialog, ErrBox, Field, NumInput, OkBox, SaveButton, SwitchRow, TrInputs, trMissingDefault } from './ui.tsx';

export type KeyTypeRow = RowOf<'keyType'>;
export type CategoryRow = RowOf<'category'>;
export type TagRow = RowOf<'tag'>;
export type LanguageRow = RowOf<'language'>;
export type ProviderRow = RowOf<'adminSmsProviders'>;
export type TestPhoneRow = RowOf<'adminTestPhones'>;

function useForm() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent | null, fn: () => Promise<unknown>, ok: string, after: () => void) {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await run(() => fn(), ok);
    setBusy(false);
    if (r.ok) after();
    else setErr(errorText(r.err));
  }
  return { busy, err, setErr, submit };
}

function Foot(props: { busy: boolean; onClose: () => void; form: string; label?: string }) {
  return (
    <>
      <span className="grow" />
      <button type="button" className="btn btn-outline" onClick={props.onClose}>
        {t('cancel')}
      </button>
      <button type="submit" form={props.form} className="btn btn-primary" disabled={props.busy} data-testid="dialog-save">
        {props.label ?? t('save')}
      </button>
    </>
  );
}

export function KeyTypeDialog(props: { row?: KeyTypeRow; preset?: { forCategory?: boolean; forTag?: boolean }; onClose: () => void; onSaved?: (key: string) => void }) {
  const { def } = useLanguages();
  const r = props.row;
  const [key, setKey] = useState(r?.key ?? '');
  const [title, setTitle] = useState<Tr[]>(r?.title ?? []);
  const [forCategory, setForCategory] = useState(r?.forCategory ?? props.preset?.forCategory ?? true);
  const [forTag, setForTag] = useState(r?.forTag ?? props.preset?.forTag ?? true);
  const f = useForm();
  const id = `kt-${useId().replace(/:/g, '')}`;
  const sys = !!r?.system;
  return (
    <Dialog title={r ? t('ktEdit') : t('ktAdd')} onClose={props.onClose} testId="kt-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form
        id={id}
        className="stack"
        onSubmit={e => {
          if (trMissingDefault(title, def)) {
            e.preventDefault();
            f.setErr(t('trRequired', { lang: def }));
            return;
          }
          const k = key.trim().toLowerCase();
          f.submit(e, () => getConn().reducers.adminSaveKeyType({ key: k, title, forCategory, forTag }), t('saved'), () => {
            props.onSaved?.(k);
            props.onClose();
          });
        }}
      >
        <Field label={t('ktKey')} hint={t('ktKeyHint')} required>
          <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
        </Field>
        <Field label={t('ktTitle')} required>
          <TrInputs value={title} onChange={setTitle} required name="title" />
        </Field>
        <div className="field">
          <span className="label">{t('ktUse')}</span>
          <div className="row row-wrap" style={{ gap: 16 }}>
            <SwitchRow checked={forCategory} onChange={setForCategory} disabled={sys} label={t('ktForCategory')} testId="kt-cat" />
            <SwitchRow checked={forTag} onChange={setForTag} disabled={sys} label={t('ktForTag')} testId="kt-tag" />
          </div>
          {sys && <span className="hint">{t('ktSystemHint')}</span>}
        </div>
        <ErrBox text={f.err} />
      </form>
    </Dialog>
  );
}

export function KeyTypePicker(props: { value: string; onChange: (v: string) => void; kind: 'category' | 'tag'; disabled?: boolean; testId?: string }) {
  const all = useRows('keyType');
  const { def } = useLanguages();
  const { can } = useSession();
  const [quick, setQuick] = useState(false);
  const list = all.filter(k => (props.kind === 'category' ? k.forCategory : k.forTag)).sort((a, b) => a.key.localeCompare(b.key));
  return (
    <div className="input-group">
      <select className="select grow" value={props.value} onChange={e => props.onChange(e.target.value)} disabled={props.disabled} data-testid={props.testId} aria-label={t('ktPick')}>
        {!list.some(k => k.key === props.value) && <option value={props.value}>{props.value || '—'}</option>}
        {list.map(k => (
          <option key={k.key} value={k.key}>
            {trText(k.title, def) || k.key} ({k.key})
          </option>
        ))}
      </select>
      {can('admin') && (
        <button type="button" className="btn btn-outline btn-icon" title={t('ktQuick')} aria-label={t('ktQuick')} onClick={() => setQuick(true)} disabled={props.disabled} data-testid={props.testId ? `${props.testId}-plus` : undefined}>
          <Plus className="ic" />
        </button>
      )}
      {quick && (
        <KeyTypeDialog
          preset={{ forCategory: props.kind === 'category', forTag: props.kind === 'tag' }}
          onClose={() => setQuick(false)}
          onSaved={k => props.onChange(k)}
        />
      )}
    </div>
  );
}

export function categoryPath(list: CategoryRow[], id: bigint, def: string): string {
  const parts: string[] = [];
  let cur = list.find(c => c.id === id);
  for (let i = 0; cur && i < 20; i++) {
    parts.unshift(trText(cur.title, def) || cur.key);
    cur = cur.parentId ? list.find(c => c.id === cur!.parentId) : undefined;
  }
  return parts.join(' / ');
}

function descendants(list: CategoryRow[], id: bigint): Set<bigint> {
  const out = new Set<bigint>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (!out.has(c.id) && out.has(c.parentId)) {
        out.add(c.id);
        grew = true;
      }
    }
  }
  return out;
}

export function CategoryPicker(props: { keyType: string; value: bigint; onChange: (v: bigint) => void; exclude?: bigint; disabled?: boolean; testId?: string; none?: string; label?: string }) {
  const all = useRows('category');
  const { def } = useLanguages();
  const { can } = useSession();
  const [quick, setQuick] = useState(false);
  const options = useMemo(() => {
    const ex = props.exclude ? descendants(all, props.exclude) : new Set<bigint>();
    return all
      .filter(c => c.keyType === props.keyType && !ex.has(c.id))
      .map(c => ({ id: c.id, label: categoryPath(all, c.id, def) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [all, props.keyType, props.exclude, def]);
  return (
    <div className="input-group">
      <select
        className="select grow"
        value={String(props.value)}
        onChange={e => props.onChange(BigInt(e.target.value))}
        disabled={props.disabled}
        data-testid={props.testId}
        aria-label={props.label ?? t('ctParent')}
      >
        <option value="0">{props.none ?? t('ctNoParent')}</option>
        {options.map(o => (
          <option key={String(o.id)} value={String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
      {can('admin') && (
        <button type="button" className="btn btn-outline btn-icon" title={t('ctQuick')} aria-label={t('ctQuick')} onClick={() => setQuick(true)} disabled={props.disabled} data-testid={props.testId ? `${props.testId}-plus` : undefined}>
          <Plus className="ic" />
        </button>
      )}
      {quick && <CategoryDialog keyType={props.keyType} onClose={() => setQuick(false)} onSaved={id => props.onChange(id)} />}
    </div>
  );
}

export async function waitFor<T>(fn: () => T | undefined, ms = 3000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v !== undefined) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  return fn();
}

export function CategoryDialog(props: { row?: CategoryRow; keyType: string; parentId?: bigint; onClose: () => void; onSaved?: (id: bigint) => void }) {
  const { def } = useLanguages();
  const r = props.row;
  const [keyType, setKeyType] = useState(r?.keyType ?? props.keyType);
  const [key, setKey] = useState(r?.key ?? '');
  const [title, setTitle] = useState<Tr[]>(r?.title ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [parentId, setParentId] = useState<bigint>(r?.parentId ?? props.parentId ?? 0n);
  const [iconUrl, setIconUrl] = useState(r?.iconUrl ?? '');
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const f = useForm();
  const id = `ct-${useId().replace(/:/g, '')}`;
  return (
    <Dialog title={r ? t('ctEdit') : t('ctAdd')} width={560} onClose={props.onClose} testId="ct-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form
        id={id}
        className="form-grid"
        onSubmit={e => {
          if (trMissingDefault(title, def)) {
            e.preventDefault();
            f.setErr(t('trRequired', { lang: def }));
            return;
          }
          const k = key.trim().toLowerCase();
          f.submit(
            e,
            () =>
              getConn().reducers.adminSaveCategory({ id: r?.id ?? 0n, keyType, key: k, title, description, parentId, iconUrl: iconUrl.trim(), sort, isActive }),
            t('saved'),
            async () => {
              if (props.onSaved) {
                const found = await waitFor(() => [...getConn().db.category.iter()].find(c => c.keyType === keyType && c.key === k));
                if (found) props.onSaved(found.id);
              }
              props.onClose();
            }
          );
        }}
      >
        <Field label={t('ktPick')} required>
          <KeyTypePicker value={keyType} onChange={v => { setKeyType(v); setParentId(0n); }} kind="category" testId="ct-kt" />
        </Field>
        <Field label={t('ktKey')} hint={t('ktKeyHint')} required>
          <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus />
        </Field>
        <Field label={t('ctTitle')} required className="span-2">
          <TrInputs value={title} onChange={setTitle} required name="title" />
        </Field>
        <Field label={t('ctDescription')} className="span-2" hint={t('optional')}>
          <TrInputs value={description} onChange={setDescription} name="desc" />
        </Field>
        <Field label={t('ctParent')} className="span-2">
          <CategoryPicker keyType={keyType} value={parentId} onChange={setParentId} exclude={r?.id} testId="ct-parent" />
        </Field>
        <Field label={t('ctIcon')} hint={t('brUrlHint')}>
          <input className="input ltr" value={iconUrl} onChange={e => setIconUrl(e.target.value)} placeholder="https://" />
        </Field>
        <Field label={t('ctSort')}>
          <NumInput value={sort} onChange={setSort} />
        </Field>
        <div className="span-2">
          <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
        </div>
        <div className="span-2">
          <ErrBox text={f.err} />
        </div>
      </form>
    </Dialog>
  );
}

export function TagDialog(props: { row?: TagRow; keyType: string; onClose: () => void; onSaved?: (id: bigint) => void }) {
  const { def } = useLanguages();
  const r = props.row;
  const [keyType, setKeyType] = useState(r?.keyType ?? props.keyType);
  const [key, setKey] = useState(r?.key ?? '');
  const [title, setTitle] = useState<Tr[]>(r?.title ?? []);
  const [color, setColor] = useState(r?.color || '#3f76ff');
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const f = useForm();
  const id = 'tg-form';
  return (
    <Dialog title={r ? t('tgEdit') : t('tgAdd')} width={520} onClose={props.onClose} testId="tg-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form
        id={id}
        className="form-grid"
        onSubmit={e => {
          if (trMissingDefault(title, def)) {
            e.preventDefault();
            f.setErr(t('trRequired', { lang: def }));
            return;
          }
          f.submit(
            e,
            () => getConn().reducers.adminSaveTag({ id: r?.id ?? 0n, keyType, key: key.trim().toLowerCase(), title, color: color.trim(), sort, isActive }),
            t('saved'),
            async () => {
              if (props.onSaved) {
                const k = key.trim().toLowerCase();
                const found = await waitFor(() => [...getConn().db.tag.iter()].find(x => x.keyType === keyType && x.key === k));
                if (found) props.onSaved(found.id);
              }
              props.onClose();
            }
          );
        }}
      >
        <Field label={t('ktPick')} required>
          <KeyTypePicker value={keyType} onChange={setKeyType} kind="tag" testId="tg-kt" />
        </Field>
        <Field label={t('ktKey')} hint={t('ktKeyHint')} required>
          <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} autoFocus />
        </Field>
        <Field label={t('ctTitle')} required className="span-2">
          <TrInputs value={title} onChange={setTitle} required name="title" />
        </Field>
        <Field label={t('tgColor')}>
          <div className="input-group">
            <input type="color" className="color-input" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#000000'} onChange={e => setColor(e.target.value)} aria-label={t('tgColor')} />
            <input className="input ltr grow" name="color" value={color} onChange={e => setColor(e.target.value)} />
          </div>
        </Field>
        <Field label={t('ctSort')}>
          <NumInput value={sort} onChange={setSort} />
        </Field>
        <div className="span-2">
          <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
        </div>
        <div className="span-2">
          <ErrBox text={f.err} />
        </div>
      </form>
    </Dialog>
  );
}

export function LanguageDialog(props: { row?: LanguageRow; onClose: () => void }) {
  const r = props.row;
  const [code, setCode] = useState(r?.code ?? '');
  const [name, setName] = useState(r?.name ?? '');
  const [dir, setDir] = useState(r?.dir ?? 'ltr');
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const f = useForm();
  const id = 'lg-form';
  return (
    <Dialog title={r ? t('lgEdit') : t('lgAdd')} onClose={props.onClose} testId="lg-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form
        id={id}
        className="form-grid"
        onSubmit={e => f.submit(e, () => getConn().reducers.adminSaveLanguage({ code: code.trim(), name, dir, isActive, sort }), t('saved'), props.onClose)}
      >
        <Field label={t('lgCode')} hint={t('lgCodeHint')} required>
          <input className="input ltr" name="code" value={code} onChange={e => setCode(e.target.value)} disabled={!!r} autoFocus={!r} />
        </Field>
        <Field label={t('lgName')} required>
          <input className="input" name="name" value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label={t('lgDir')}>
          <select className="select" name="dir" value={dir} onChange={e => setDir(e.target.value)}>
            <option value="rtl">{t('lgRtl')}</option>
            <option value="ltr">{t('lgLtr')}</option>
          </select>
        </Field>
        <Field label={t('lgSort')}>
          <NumInput value={sort} onChange={setSort} />
        </Field>
        <div className="span-2">
          <SwitchRow checked={isActive} onChange={setActive} disabled={r?.isDefault} label={t('active')} testId="lg-active" />
        </div>
        <div className="span-2">
          <ErrBox text={f.err} />
        </div>
      </form>
    </Dialog>
  );
}

export const SMS_KINDS = ['sandbox', 'kavenegar', 'smsir'] as const;

export function kindLabel(kind: string) {
  return kind === 'sandbox' ? t('smKindSandbox') : kind === 'kavenegar' ? t('smKindKavenegar') : kind === 'smsir' ? t('smKindSmsir') : kind;
}

export function ProviderForm(props: { row?: ProviderRow; id: string; onDone: () => void; activateDefault?: boolean; setBusy?: (b: boolean) => void }) {
  const r = props.row;
  const [kind, setKind] = useState(r?.kind ?? 'kavenegar');
  const [name, setName] = useState(r?.name ?? '');
  const [apiKey, setApiKey] = useState('');
  const [sender, setSender] = useState(numeric(r?.sender ?? ''));
  const [otpTemplate, setTemplate] = useState(numeric(r?.otpTemplate ?? ''));
  const [otpCodeVar, setCodeVar] = useState(r?.otpCodeVar ?? 'CODE');
  const [isActive, setActive] = useState(r?.isActive ?? props.activateDefault ?? false);
  const f = useForm();
  return (
    <form
      id={props.id}
      className="form-grid"
      onSubmit={e => {
        props.setBusy?.(true);
        f.submit(
          e,
          () =>
            getConn().reducers.adminSaveSmsProvider({
              id: r?.id ?? 0n,
              kind,
              name: name.trim() || kindLabel(kind),
              apiKey: kind === 'sandbox' ? '' : apiKey.trim(),
              sender: kind === 'sandbox' ? '' : latin(sender).trim(),
              otpTemplate: kind === 'sandbox' ? '' : latin(otpTemplate).trim(),
              otpCodeVar: kind === 'smsir' ? otpCodeVar.trim() : 'CODE',
              isActive,
            }),
          t('saved'),
          props.onDone
        ).finally(() => props.setBusy?.(false));
      }}
    >
      <Field label={t('smKind')} required>
        <select className="select" name="kind" value={kind} onChange={e => setKind(e.target.value)} disabled={!!r}>
          {SMS_KINDS.map(k => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('smName')} required>
        <input className="input" name="name" value={name} onChange={e => setName(e.target.value)} placeholder={kindLabel(kind)} />
      </Field>
      {kind === 'sandbox' ? (
        <p className="hint span-2">{t('smSandboxHint')}</p>
      ) : (
        <>
          <Field label={t('smApiKey')} required={!r?.hasKey} className="span-2" hint={r?.hasKey ? t('smApiKeyKeep', { mask: r.apiKeyMasked }) : undefined}>
            <input className="input ltr" name="apiKey" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={r?.hasKey ? r.apiKeyMasked : ''} autoComplete="off" />
          </Field>
          <Field label={kind === 'smsir' ? t('smSenderSmsir') : t('smSender')} hint={t('optional')}>
            <input className="input ltr" name="sender" value={sender} onChange={e => setSender(e.target.value)} inputMode="numeric" />
          </Field>
          <Field
            label={kind === 'smsir' ? t('smTemplateSmsir') : t('smTemplateKavenegar')}
            hint={kind === 'smsir' ? t('smTemplateSmsirHint') : t('smTemplateKavenegarHint')}
          >
            <input className="input ltr" name="otpTemplate" value={otpTemplate} onChange={e => setTemplate(e.target.value)} inputMode={kind === 'smsir' ? 'numeric' : undefined} />
          </Field>
          {kind === 'smsir' && (
            <Field label={t('smCodeVar')} hint={t('smCodeVarHint')}>
              <input className="input ltr" name="otpCodeVar" value={otpCodeVar} onChange={e => setCodeVar(e.target.value)} />
            </Field>
          )}
        </>
      )}
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} disabled={r?.isActive} label={t('smMakeActive')} testId="sm-active" />
      </div>
      <div className="span-2">
        <ErrBox text={f.err} />
      </div>
    </form>
  );
}

export function ProviderDialog(props: { row?: ProviderRow; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={props.row ? t('smEdit') : t('smAdd')} width={560} onClose={props.onClose} testId="sm-dialog" foot={<Foot busy={busy} onClose={props.onClose} form="sm-form" />}>
      <ProviderForm row={props.row} id="sm-form" onDone={props.onClose} setBusy={setBusy} />
    </Dialog>
  );
}

export function TestSmsForm(props: { provider: ProviderRow; compact?: boolean }) {
  const { me } = useSession();
  const [phone, setPhone] = useState(/^09\d{9}$/.test(me?.phone ?? '') ? digits(me!.phone) : '');
  const [otp, setOtp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  return (
    <form
      className="stack"
      data-testid="sms-test-form"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        setOk(null);
        const r = await run(c => c.procedures.adminTestSms({ providerId: props.provider.id, phone: latin(phone), otp }));
        setBusy(false);
        if (r.ok) {
          const v = r.value;
          setOk(`${t('smTestSent', { mode: v.mode })}${v.code ? ` · ${t('smTestCode', { code: digits(v.code) })}` : ''}`);
        } else setErr(errorText(r.err));
      }}
    >
      <div className={props.compact ? 'row row-wrap' : 'form-grid'} style={{ alignItems: 'flex-end' }}>
        <Field label={t('smTestPhone')} className={props.compact ? 'grow' : undefined}>
          <input className="input ltr" name="testPhone" value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="09…" />
        </Field>
        <div className="row" style={{ minHeight: 36 }}>
          <label className="check">
            <input type="checkbox" checked={otp} onChange={e => setOtp(e.target.checked)} />
            {t('smTestOtp')}
          </label>
        </div>
        <SaveButton busy={busy} label={t('smTestSend')} testId="sms-test-send" />
      </div>
      <ErrBox text={err} />
      <OkBox text={ok} />
    </form>
  );
}

export function TestSmsDialog(props: { provider: ProviderRow; onClose: () => void }) {
  return (
    <Dialog title={`${t('smTest')} · ${props.provider.name}`} width={520} onClose={props.onClose} testId="sms-test-dialog">
      <TestSmsForm provider={props.provider} />
    </Dialog>
  );
}

export function TestPhoneDialog(props: { row?: TestPhoneRow; onClose: () => void }) {
  const settings = useRows('adminSettings')[0];
  const len = settings?.otpLength ?? 5;
  const r = props.row;
  const [phone, setPhone] = useState(digits(r?.phone ?? ''));
  const [code, setCode] = useState(digits(r?.code ?? ''));
  const [note, setNote] = useState(r?.note ?? '');
  const f = useForm();
  const id = 'tp-form';
  return (
    <Dialog title={r ? t('tpEdit') : t('tpAdd')} onClose={props.onClose} testId="tp-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form id={id} className="form-grid" onSubmit={e => f.submit(e, () => getConn().reducers.adminSaveTestPhone({ phone: latin(phone), code: latin(code), note }), t('saved'), props.onClose)}>
        <Field label={t('tpPhone')} required>
          <input className="input ltr" name="phone" value={phone} onChange={e => setPhone(e.target.value)} disabled={!!r} inputMode="tel" autoFocus={!r} placeholder="09…" />
        </Field>
        <Field label={t('tpCode')} hint={t('tpCodeHint', { n: len })} required>
          <input className="input ltr" name="code" value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" maxLength={len} />
        </Field>
        <Field label={t('tpNote')} className="span-2" hint={t('optional')}>
          <input className="input" name="note" value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        <div className="span-2">
          <ErrBox text={f.err} />
        </div>
      </form>
    </Dialog>
  );
}

function genPassword() {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const dig = '23456789';
  const all = abc + dig;
  const r = crypto.getRandomValues(new Uint32Array(14));
  const out = [...r].map(x => all[x % all.length]);
  out[3] = dig[r[3] % dig.length];
  out[9] = abc[r[9] % abc.length];
  return out.join('');
}

export function PasswordInput(props: { value: string; onChange: (v: string) => void; name: string; id?: string; generate?: boolean; autoComplete?: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input
        id={props.id}
        className="input ltr grow"
        name={props.name}
        type={show ? 'text' : 'password'}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        autoComplete={props.autoComplete ?? 'new-password'}
        autoFocus={props.autoFocus}
      />
      <button type="button" className="btn btn-outline btn-icon" style={{ height: 36, width: 36 }} onClick={() => setShow(!show)} aria-label={show ? t('lgHide') : t('lgShow')} aria-pressed={show} data-testid={`${props.name}-toggle`}>
        {show ? <EyeSlash className="ic" /> : <Eye className="ic" />}
      </button>
      {props.generate && (
        <button
          type="button"
          className="btn btn-outline"
          style={{ height: 36 }}
          onClick={() => {
            props.onChange(genPassword());
            setShow(true);
          }}
          data-testid={`${props.name}-gen`}
        >
          {t('puGenerate')}
        </button>
      )}
    </div>
  );
}

function RoleRadios(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="stack stack-sm">
      {(['support', 'operator', 'admin', 'owner'] as const).map(r => (
        <label key={r} className="check" style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="role" value={r} checked={props.value === r} onChange={() => props.onChange(r)} style={{ marginTop: 3 }} />
          <span className="stack" style={{ gap: 0 }}>
            <span>{r === 'owner' ? t('roleOwner') : r === 'admin' ? t('roleAdmin') : r === 'support' ? t('roleSupport') : t('roleOperator')}</span>
            <span className="hint">{r === 'owner' ? t('adRoleHelpOwner') : r === 'admin' ? t('adRoleHelpAdmin') : r === 'support' ? t('adRoleHelpSupport') : t('adRoleHelpOperator')}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function CreateUserDialog(props: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const f = useForm();
  const id = 'pu-form';
  return (
    <Dialog title={t('puAdd')} width={500} onClose={props.onClose} testId="pu-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} label={t('create')} />}>
      <form id={id} className="stack" onSubmit={e => f.submit(e, () => getConn().reducers.adminCreateUser({ username: username.trim().toLowerCase(), password, role }), t('puCreated'), props.onClose)}>
        <Field label={t('puUsername')} hint={t('puUsernameHint')} required>
          <input className="input ltr" name="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label={t('puPassword')} hint={t('puPasswordHint')} required>
          <PasswordInput value={password} onChange={setPassword} name="password" generate />
        </Field>
        <div className="field">
          <span className="label">{t('puRole')}</span>
          <RoleRadios value={role} onChange={setRole} />
        </div>
        <p className="hint">{t('puCopy')}</p>
        <ErrBox text={f.err} />
      </form>
    </Dialog>
  );
}

export function ResetPasswordDialog(props: { accountId: bigint; name: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const f = useForm();
  const id = 'pr-pw-form';
  return (
    <Dialog title={t('puResetTitle', { name: props.name })} width={460} onClose={props.onClose} testId="pw-reset-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form id={id} className="stack" onSubmit={e => f.submit(e, () => getConn().reducers.adminSetUserPassword({ accountId: props.accountId, password }), t('puResetDone'), props.onClose)}>
        <Field label={t('puPassword')} hint={t('puPasswordHint')} required>
          <PasswordInput value={password} onChange={setPassword} name="newUserPassword" generate autoFocus />
        </Field>
        <p className="hint">{t('puCopy')}</p>
        <ErrBox text={f.err} />
      </form>
    </Dialog>
  );
}

export function ChangeMyPasswordDialog(props: { onClose: () => void }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const f = useForm();
  const id = 'my-pw-form';
  return (
    <Dialog title={t('myPw')} width={460} onClose={props.onClose} testId="my-pw-dialog" foot={<Foot busy={f.busy} onClose={props.onClose} form={id} />}>
      <form
        id={id}
        className="stack"
        onSubmit={e => {
          if (newPassword !== repeat) {
            e.preventDefault();
            f.setErr(t('myPwMismatch'));
            return;
          }
          f.submit(e, () => getConn().reducers.adminChangeMyPassword({ oldPassword, newPassword }), t('myPwDone'), props.onClose);
        }}
      >
        <Field label={t('myPwOld')} required>
          <PasswordInput value={oldPassword} onChange={setOld} name="oldPassword" autoComplete="current-password" autoFocus />
        </Field>
        <Field label={t('myPwNew')} hint={t('puPasswordHint')} required>
          <PasswordInput value={newPassword} onChange={setNew} name="newPassword" />
        </Field>
        <Field label={t('myPwRepeat')} required>
          <PasswordInput value={repeat} onChange={setRepeat} name="repeatPassword" />
        </Field>
        <ErrBox text={f.err} />
      </form>
    </Dialog>
  );
}

export function showError(code: string) {
  toast('bad', codeText(code));
}
