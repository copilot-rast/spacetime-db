import { useState } from 'react';
import { ArrowsClockwise, Database, Eye, EyeSlash, LockKey, Moon, PlugsConnected, SignOut, Sun, Translate } from '@phosphor-icons/react';
import { connect, defaultServer, forgetCfg, resetToken, saveCfg, useSnap } from './conn.ts';
import { errorText, parseError, phone as fmtPhone, setLocale, t, useLocale, type ErrInfo } from './i18n.ts';
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

function PasswordLogin() {
  const snap = useSnap();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ErrInfo | null>(null);
  const [lockUntil, setLockUntil] = useState(0);
  const lockLeft = useCountdown(lockUntil);
  async function submit() {
    if (!snap.conn) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await snap.conn.procedures.adminLogin({ username: username.trim(), password });
      if (!r.ok) {
        if (r.error === 'TOO_MANY_ATTEMPTS') setLockUntil(Date.now() + r.retryAfterSec * 1000);
        setErr({ code: r.error, raw: r.error });
      }
    } catch (e) {
      setErr(parseError(e));
    } finally {
      setBusy(false);
    }
  }
  const msg = err ? (err.code === 'TOO_MANY_ATTEMPTS' ? (lockLeft > 0 ? t('lgLocked', { s: lockLeft }) : null) : errorText(err)) : null;
  return (
    <form
      className="auth-card"
      data-testid="login-password"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <BrandHead title={t('loginTitle')} />
      <Field label={t('lgUsername')} htmlFor="l-user">
        <input id="l-user" name="username" className="input ltr" style={{ height: 44 }} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus />
      </Field>
      <Field label={t('lgPassword')} htmlFor="l-pass">
        <div className="input-group">
          <input
            id="l-pass"
            name="password"
            className="input ltr grow"
            style={{ height: 44 }}
            type={show ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="button" className="btn btn-outline btn-icon" style={{ height: 44, width: 44 }} onClick={() => setShow(!show)} aria-label={show ? t('lgHide') : t('lgShow')} aria-pressed={show} data-testid="login-pass-toggle">
            {show ? <EyeSlash className="ic" /> : <Eye className="ic" />}
          </button>
        </div>
      </Field>
      <ErrBox text={msg} />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !username.trim() || !password || lockLeft > 0} data-testid="login-pass-go">
        {busy && <Spinner />}
        {lockLeft > 0 ? t('lgLocked', { s: lockLeft }) : t('lgSignIn')}
      </button>
    </form>
  );
}

export function LoginScreen() {
  return (
    <div className="auth">
      <Corner />
      <PasswordLogin />
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
