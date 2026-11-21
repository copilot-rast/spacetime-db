import { useState } from 'react';
import { ArrowsClockwise, Database, LockKey, Moon, PlugsConnected, SignOut, Sun, Translate } from '@phosphor-icons/react';
import { connect, defaultServer, forgetCfg, resetToken, saveCfg, useSnap } from './conn.ts';
import { digits, errorText, latin, parseError, phone as fmtPhone, setLocale, t, useLocale, type ErrInfo } from './i18n.ts';
import { runToast, setTheme, useBrand, useCountdown, useSession, useTheme } from './app.ts';
import { ErrBox, Field, SaveButton, Skel, Spinner } from './ui.tsx';

export function Corner() {
  const l = useLocale();
  const theme = useTheme();
  return (
    <div className="auth-corner">
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setLocale(l === 'fa' ? 'en' : 'fa')} data-testid="corner-lang">
        <Translate className="ic" />
        {l === 'fa' ? 'English' : 'فارسی'}
      </button>
      <button
        type="button"
        className="btn btn-outline btn-sm btn-icon"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={theme === 'dark' ? t('themeLight') : t('themeDark')}
        data-testid="corner-theme"
      >
        {theme === 'dark' ? <Sun className="ic" /> : <Moon className="ic" />}
      </button>
    </div>
  );
}

export function ConnectScreen() {
  const snap = useSnap();
  const [server, setServer] = useState(snap.cfg?.server ?? defaultServer());
  const [db, setDb] = useState(snap.cfg?.db ?? 'stg-template');
  return (
    <div className="auth">
      <Corner />
      <form
        className="auth-card"
        data-testid="connect"
        onSubmit={e => {
          e.preventDefault();
          if (db.trim()) saveCfg({ server, db });
        }}
      >
        <div className="auth-brand">
          <div className="auth-mark" style={{ background: 'var(--ink-1)', color: 'var(--base)' }}>
            <PlugsConnected className="ic" weight="duotone" style={{ width: 24, height: 24 }} />
          </div>
          <div className="stack stack-sm" style={{ gap: 2 }}>
            <h1 className="auth-title">{t('connTitle')}</h1>
            <span className="small muted">{t('connHint')}</span>
          </div>
        </div>
        <Field label={t('connServer')} hint={t('connServerHint')} htmlFor="c-server">
          <input id="c-server" name="server" className="input ltr" value={server} onChange={e => setServer(e.target.value)} />
        </Field>
        <Field label={t('connDb')} htmlFor="c-db" required>
          <input id="c-db" name="db" className="input ltr" value={db} onChange={e => setDb(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" data-testid="connect-go">
          {t('connGo')}
        </button>
      </form>
    </div>
  );
}

export function ConnectingScreen() {
  const snap = useSnap();
  if (snap.phase === 'error') {
    return (
      <div className="auth">
        <Corner />
        <div className="auth-card" data-testid="conn-error">
          <div className="auth-brand">
            <div className="auth-mark" style={{ background: 'var(--tint-bad-bg)', color: 'var(--neg)' }}>
              <Database className="ic" weight="duotone" style={{ width: 24, height: 24 }} />
            </div>
            <div className="stack stack-sm" style={{ gap: 2 }}>
              <h1 className="auth-title">{t('connFailed')}</h1>
              <span className="small muted ltr">
                {snap.cfg?.server} · {snap.cfg?.db}
              </span>
            </div>
          </div>
          <ErrBox text={snap.error} />
          <div className="stack stack-sm">
            <button type="button" className="btn btn-primary btn-block" onClick={() => connect()}>
              <ArrowsClockwise className="ic" />
              {t('connRetry')}
            </button>
            <div className="row">
              <button type="button" className="btn btn-outline grow" onClick={forgetCfg}>
                {t('connChange')}
              </button>
              <button type="button" className="btn btn-outline grow" onClick={resetToken}>
                {t('connResetToken')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="auth">
      <div className="auth-card" aria-busy="true" data-testid="connecting">
        <div className="auth-brand">
          <Skel w={44} h={44} r={10} />
          <div className="stack stack-sm grow">
            <Skel w="60%" h={16} />
            <Skel w="40%" h={10} />
          </div>
        </div>
        <Skel h={36} r={6} />
        <div className="row muted small">
          <Spinner />
          {t('connConnecting', { db: snap.cfg?.db ?? '' })}
        </div>
      </div>
    </div>
  );
}

function BrandHead(props: { title: string; sub?: string }) {
  const { brand, name, mark } = useBrand();
  return (
    <div className="auth-brand">
      <div className="auth-mark" style={{ background: brand?.primaryColor || undefined }}>
        {brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : mark}
      </div>
      <div className="stack stack-sm" style={{ gap: 2, minWidth: 0 }}>
        <span className="small muted ellipsis" data-testid="brand-name">
          {name}
        </span>
        <h1 className="auth-title">{props.title}</h1>
        {props.sub && <span className="small muted">{props.sub}</span>}
      </div>
    </div>
  );
}

type Sent = { phone: string; codeLength: number; expiresAt: number; resendAt: number };

export function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrInfo | null>(null);
  const [retryUntil, setRetryUntil] = useState(0);
  const [attempts, setAttempts] = useState<number | null>(null);
  const retryLeft = useCountdown(retryUntil);
  const resendLeft = useCountdown(sent?.resendAt ?? 0);
  const expiresLeft = useCountdown(sent?.expiresAt ?? 0);
  const snap = useSnap();

  async function request(p: string) {
    if (!snap.conn) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await snap.conn.procedures.requestOtp({ phone: latin(p) });
      const now = Date.now();
      setSent({ phone: r.phone, codeLength: r.codeLength, expiresAt: now + r.expiresInSec * 1000, resendAt: now + r.retryAfterSec * 1000 });
      setCode('');
      setAttempts(null);
    } catch (e) {
      const info = parseError(e);
      if (info.code === 'RETRY_LATER' && info.seconds) setRetryUntil(Date.now() + info.seconds * 1000);
      setErr(info);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!snap.conn || !sent) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await snap.conn.procedures.verifyOtp({ phone: sent.phone, code: latin(code) });
      if (!r.ok) {
        setErr({ code: r.error, raw: r.error });
        if (r.error === 'WRONG_CODE') setAttempts(r.attemptsLeft);
        else setAttempts(null);
        if (r.error !== 'WRONG_CODE') setCode('');
      }
    } catch (e) {
      setErr(parseError(e));
    } finally {
      setBusy(false);
    }
  }

  const errMsg = err ? (err.code === 'RETRY_LATER' ? (retryLeft > 0 ? errorText(err, retryLeft) : null) : errorText(err)) : null;
  const needNewCode = err && ['NO_CODE', 'EXPIRED', 'TOO_MANY_ATTEMPTS'].includes(err.code);

  return (
    <div className="auth">
      <Corner />
      {!sent ? (
        <form
          className="auth-card"
          data-testid="login-phone"
          onSubmit={e => {
            e.preventDefault();
            request(phone);
          }}
        >
          <BrandHead title={t('loginTitle')} sub={t('loginPhoneHint')} />
          <Field label={t('loginPhone')} htmlFor="l-phone">
            <input
              id="l-phone"
              name="phone"
              className="input ltr"
              style={{ height: 44, fontSize: 16 }}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder={digits('09123456789')}
              autoFocus
            />
          </Field>
          <ErrBox text={errMsg} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !phone.trim() || retryLeft > 0} data-testid="login-send">
            {busy && <Spinner />}
            {retryLeft > 0 ? t('loginResendIn', { s: retryLeft }) : t('loginSend')}
          </button>
        </form>
      ) : (
        <form
          className="auth-card"
          data-testid="login-code"
          onSubmit={e => {
            e.preventDefault();
            verify();
          }}
        >
          <BrandHead title={t('loginCode', { n: sent.codeLength })} sub={t('loginCodeSent', { phone: fmtPhone(sent.phone) })} />
          <div className="field">
            <input
              name="code"
              className="input otp-input"
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^0-9۰-۹٠-٩]/g, '').slice(0, sent.codeLength))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={t('loginCode', { n: sent.codeLength })}
              maxLength={sent.codeLength}
              autoFocus
            />
            <div className="row small muted">
              <span className="grow">{expiresLeft > 0 ? t('loginExpiresIn', { s: expiresLeft }) : ''}</span>
              {attempts !== null && <span data-testid="attempts-left">{t('loginAttemptsLeft', { n: attempts })}</span>}
            </div>
          </div>
          <ErrBox text={errMsg} />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || latin(code).length !== sent.codeLength || !!needNewCode} data-testid="login-verify">
            {busy && <Spinner />}
            {t('loginVerify')}
          </button>
          <div className="row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSent(null);
                setErr(null);
              }}
            >
              {t('loginChangePhone')}
            </button>
            <span className="grow" />
            <button type="button" className="btn" disabled={busy || resendLeft > 0 || retryLeft > 0} onClick={() => request(sent.phone)} data-testid="login-resend">
              {resendLeft > 0 ? t('loginResendIn', { s: resendLeft }) : retryLeft > 0 ? t('loginResendIn', { s: retryLeft }) : t('loginResend')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function NoAccessScreen() {
  const { me } = useSession();
  return (
    <div className="auth">
      <Corner />
      <div className="auth-card" data-testid="no-access">
        <div className="auth-brand">
          <div className="auth-mark" style={{ background: 'var(--tint-warn-bg)', color: 'var(--warn)' }}>
            <LockKey className="ic" weight="duotone" style={{ width: 24, height: 24 }} />
          </div>
          <h1 className="auth-title">{t('noAccessTitle')}</h1>
        </div>
        <p className="sub">{t('noAccessText', { phone: fmtPhone(me?.phone ?? '') })}</p>
        <button type="button" className="btn btn-outline btn-block" onClick={() => runToast(c => c.reducers.logout({}))} data-testid="no-access-logout">
          <SignOut className="ic ic-dir" />
          {t('logout')}
        </button>
      </div>
    </div>
  );
}

export { SaveButton };
