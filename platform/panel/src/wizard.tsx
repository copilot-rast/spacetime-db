import { useState } from 'react';
import { Check, ChatCircleText, Palette, Password, Plus, Star, Translate, X, ListChecks } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { useRows } from './conn.ts';
import { digits, num, t, useLocale } from './i18n.ts';
import { run, runToast, trText, useLanguages } from './app.ts';
import { ErrBox, Skel, Spinner, Switch, useEscape } from './ui.tsx';
import { LanguageDialog, ProviderForm, TestSmsForm, kindLabel } from './dialogs.tsx';
import { BrandFields, OtpFields, saveBrand, saveOtp, useBrandForm, useOtpForm } from './settings.tsx';

const STEPS = ['brand', 'languages', 'sms', 'otp', 'review'] as const;
type Step = (typeof STEPS)[number];

export function Wizard(props: { onClose: () => void }) {
  useLocale();
  const [step, setStep] = useState<Step>('brand');
  const [done, setDone] = useState<Set<Step>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const brandForm = useBrandForm();
  const otpForm = useOtpForm();
  const { def, all } = useLanguages();
  const providers = useRows('adminSmsProviders');
  const active = providers.find(p => p.isActive);
  const [newProvider, setNewProvider] = useState(false);
  const [smsBusy, setSmsBusy] = useState(false);
  useEscape(props.onClose);
  const idx = STEPS.indexOf(step);
  const labels: Record<Step, string> = { brand: t('wzBrand'), languages: t('wzLanguages'), sms: t('wzSms'), otp: t('wzOtp'), review: t('wzReview') };
  const texts: Record<Step, string> = { brand: t('wzBrandText'), languages: t('wzLanguagesText'), sms: t('wzSmsText'), otp: t('wzOtpText'), review: t('wzReviewText') };
  const icons: Record<Step, React.ReactNode> = {
    brand: <Palette className="ic" weight="duotone" />,
    languages: <Translate className="ic" weight="duotone" />,
    sms: <ChatCircleText className="ic" weight="duotone" />,
    otp: <Password className="ic" weight="duotone" />,
    review: <ListChecks className="ic" weight="duotone" />,
  };

  async function next() {
    setErr(null);
    setBusy(true);
    let e: string | null = null;
    if (step === 'brand' && brandForm.v) e = await saveBrand(brandForm.v, def);
    if (step === 'otp' && otpForm.v) e = await saveOtp(otpForm.v);
    if (step === 'review') {
      const r = await run(c => c.reducers.adminCompleteSetup({ done: true }), t('wzFinished'));
      setBusy(false);
      if (r.ok) props.onClose();
      return;
    }
    setBusy(false);
    if (e) {
      setErr(e);
      return;
    }
    setDone(d => new Set(d).add(step));
    setStep(STEPS[idx + 1]);
  }

  return createPortal(
    <div className="layer" data-testid="wizard">
      <div className="scrim" />
      <div className="wiz" role="dialog" aria-modal="true" aria-label={t('wzTitle')}>
        <div className="wiz-head">
          <div className="row">
            <div className="stack grow" style={{ gap: 0 }}>
              <span className="small muted">
                {t('wzTitle')} · {t('wzStep', { n: idx + 1, total: STEPS.length })}
              </span>
              <h2 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }} data-testid="wz-title">
                {labels[step]}
              </h2>
            </div>
            <button type="button" className="btn btn-icon" onClick={props.onClose} aria-label={t('close')} data-testid="wz-close">
              <X className="ic" />
            </button>
          </div>
          <div className="stepper">
            {STEPS.map((s, i) => (
              <span key={s} className="row" style={{ flex: i < STEPS.length - 1 ? 1 : 'none', gap: 6 }}>
                <button
                  type="button"
                  className={`step ${done.has(s) ? 'done' : ''}`}
                  aria-current={s === step ? 'step' : undefined}
                  onClick={() => (done.has(s) || i <= idx ? setStep(s) : undefined)}
                  data-testid={`wz-step-${s}`}
                >
                  <span className="step-n">{done.has(s) && s !== step ? <Check className="ic" style={{ width: 12, height: 12 }} /> : digits(i + 1)}</span>
                  <span className="step-text">{labels[s]}</span>
                </button>
                {i < STEPS.length - 1 && <span className="step-line" />}
              </span>
            ))}
          </div>
        </div>
        <div className="wiz-body" data-testid={`wz-body-${step}`}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div className="notice-ic" style={{ background: 'var(--tint-info-bg)' }}>
              {icons[step]}
            </div>
            <p className="sub small" style={{ paddingTop: 8 }}>
              {texts[step]}
            </p>
          </div>
          {step === 'brand' &&
            (brandForm.v ? (
              <BrandFields v={brandForm.v} set={brandForm.setV} compact />
            ) : (
              <div className="stack">
                <Skel h={36} />
                <Skel h={36} />
              </div>
            ))}
          {step === 'languages' && <LanguagesStep />}
          {step === 'sms' && (
            <div className="stack">
              {active && !newProvider && (
                <div className="provider on" data-testid="wz-active-provider">
                  <div className="row">
                    <ChatCircleText className="ic" weight="duotone" style={{ color: 'var(--accent-ink)' }} />
                    <b className="grow">{t('wzSmsCurrent', { name: active.name })}</b>
                    <span className="badge">{kindLabel(active.kind)}</span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setNewProvider(true)} data-testid="wz-new-provider">
                      <Plus className="ic" />
                      {t('wzSmsUse')}
                    </button>
                  </div>
                  <TestSmsForm provider={active} compact />
                </div>
              )}
              {(!active || newProvider) && (
                <div className="provider">
                  <ProviderForm id="wz-sms-form" activateDefault onDone={() => setNewProvider(false)} setBusy={setSmsBusy} />
                  <div className="row">
                    {active && (
                      <button type="button" className="btn btn-outline" onClick={() => setNewProvider(false)}>
                        {t('cancel')}
                      </button>
                    )}
                    <span className="grow" />
                    <button type="submit" form="wz-sms-form" className="btn btn-primary" disabled={smsBusy} data-testid="wz-sms-save">
                      {smsBusy && <Spinner />}
                      {t('save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {step === 'otp' && (otpForm.v ? <OtpFields v={otpForm.v} set={otpForm.setV} /> : <Skel h={120} />)}
          {step === 'review' && (
            <div className="review" data-testid="wz-review">
              <div className="review-item">
                <Palette className="ic muted" weight="duotone" />
                <dl className="kv grow">
                  <dt>{t('brName')}</dt>
                  <dd>{trText(brandForm.brand?.name, def)}</dd>
                  <dt>{t('brColor')}</dt>
                  <dd className="row" style={{ gap: 6 }}>
                    <span className="swatch" style={{ background: brandForm.brand?.primaryColor }} />
                    <span className="mono">{brandForm.brand?.primaryColor}</span>
                  </dd>
                </dl>
              </div>
              <div className="review-item">
                <Translate className="ic muted" weight="duotone" />
                <dl className="kv grow">
                  <dt>{t('stLanguages')}</dt>
                  <dd>
                    {all
                      .filter(l => l.isActive)
                      .map(l => l.name)
                      .join('، ')}
                  </dd>
                  <dt>{t('lgDefault')}</dt>
                  <dd>{all.find(l => l.isDefault)?.name}</dd>
                </dl>
              </div>
              <div className="review-item">
                <ChatCircleText className="ic muted" weight="duotone" />
                <dl className="kv grow">
                  <dt>{t('smActive')}</dt>
                  <dd>{active ? `${active.name} · ${kindLabel(active.kind)}` : t('dashSmsNone')}</dd>
                </dl>
              </div>
              <div className="review-item">
                <Password className="ic muted" weight="duotone" />
                <dl className="kv grow">
                  <dt>{t('otLength')}</dt>
                  <dd>{num(otpForm.v?.otpLength ?? 0)}</dd>
                  <dt>{t('otTtl')}</dt>
                  <dd>{num(otpForm.v?.otpTtlSec ?? 0)}</dd>
                  <dt>{t('otDaily')}</dt>
                  <dd>{num(otpForm.v?.otpDailyCap ?? 0)}</dd>
                </dl>
              </div>
            </div>
          )}
          <ErrBox text={err} />
        </div>
        <div className="wiz-foot">
          <button type="button" className="btn" onClick={props.onClose} data-testid="wz-later">
            {t('wzLater')}
          </button>
          <span className="grow" />
          {idx > 0 && (
            <button type="button" className="btn btn-outline" onClick={() => setStep(STEPS[idx - 1])} data-testid="wz-back">
              {t('back')}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={next} disabled={busy} data-testid="wz-next">
            {busy && <Spinner />}
            {step === 'review' ? t('wzFinish') : t('next')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function LanguagesStep() {
  const { all } = useLanguages();
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <div className="card">
        <div className="list">
          {all.map(l => (
            <div className="list-row" key={l.code} data-testid={`wz-lg-${l.code}`}>
              <span className="tr-lang" style={{ height: 28 }}>
                {l.code}
              </span>
              <div className="list-main">
                <span className="list-title" dir={l.dir}>
                  {l.name}
                </span>
                <span className="list-sub">{l.dir === 'rtl' ? t('lgRtl') : t('lgLtr')}</span>
              </div>
              {l.isDefault ? (
                <span className="badge b-info">
                  <Star className="ic" weight="fill" />
                  {t('lgDefault')}
                </span>
              ) : (
                l.isActive && (
                  <button type="button" className="btn btn-sm" onClick={() => runToast(c => c.reducers.adminSetDefaultLanguage({ code: l.code }), t('lgDefaultChanged'))}>
                    {t('lgMakeDefault')}
                  </button>
                )
              )}
              <Switch
                checked={l.isActive}
                disabled={l.isDefault}
                label={t('active')}
                testId={`wz-lg-active-${l.code}`}
                onChange={v => runToast(c => c.reducers.adminSaveLanguage({ code: l.code, name: l.name, dir: l.dir, isActive: v, sort: l.sort }), t('saved'))}
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <button type="button" className="btn btn-outline" onClick={() => setAdding(true)} data-testid="wz-lg-add">
          <Plus className="ic" />
          {t('lgAdd')}
        </button>
      </div>
      {adding && <LanguageDialog onClose={() => setAdding(false)} />}
    </div>
  );
}
