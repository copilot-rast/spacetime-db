import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CaretLeft, CaretRight, Check, Database, GearSix, List, MagnifyingGlass, Moon, SignOut, Sun, Translate, User } from '@phosphor-icons/react';
import { recentDbs, saveCfg, useRows, useSnap } from './conn.ts';
import { phone as fmtPhone, roleLabel, setLocale, t, useLocale, latin, withLocale } from './i18n.ts';
import { go, openSettings, runToast, setTheme, useBrand, useRoute, useSession, useTheme } from './app.ts';
import { GROUPS, MODES, PAGES, SECTIONS, pageMode, type ModeId } from './nav.tsx';
import { Field, Pop, SaveButton, useEscape } from './ui.tsx';

function isCurrent(path: string, page: string, query: URLSearchParams) {
  const [p, q] = path.split('?');
  if (p !== page) return false;
  const want = new URLSearchParams(q ?? '').get('status') ?? '';
  return (query.get('status') ?? '') === want;
}

export function openWizard() {
  window.dispatchEvent(new Event('stg-wizard'));
}

export function Shell(props: { children: ReactNode; crumbs: string[] }) {
  const route = useRoute();
  const { can, me, role } = useSession();
  const { brand, name, mark } = useBrand();
  const snap = useSnap();
  const settings = useRows('adminSettings')[0];
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<ModeId>(pageMode(route.page));
  const [pal, setPal] = useState(false);
  const [profile, setProfile] = useState<HTMLElement | null>(null);
  const [dbPop, setDbPop] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  useLocale();

  useEffect(() => setMode(route.settings !== null ? 'settings' : pageMode(route.page)), [route.page, route.settings]);
  useEffect(() => setDrawer(false), [route.page, route.settings, route.query.toString()]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPal(p => !p);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const pages = PAGES.filter(p => p.mode === mode && can(p.need));
  const sections = SECTIONS.filter(s => can(s.need));
  const setupPending = settings && !settings.setupDone;

  return (
    <div className={`app ${drawer ? 'drawer-open' : ''}`} style={{ ['--brand' as string]: brand?.primaryColor || undefined }}>
      <div className="drawer-scrim" onClick={() => setDrawer(false)} />
      <nav className="rail" aria-label={t('navOverview')}>
        <div className="rail-brand" title={name}>
          {brand?.iconUrl || brand?.logoUrl ? <img src={brand.iconUrl || brand.logoUrl} alt="" /> : mark}
        </div>
        {MODES.map(m => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              type="button"
              className="rail-mode"
              aria-current={mode === m.id ? 'true' : undefined}
              aria-label={m.label()}
              title={m.label()}
              data-testid={`rail-${m.id}`}
              onClick={() => {
                setMode(m.id);
                if (m.id === 'settings') return;
                const first = PAGES.find(p => p.mode === m.id && can(p.need));
                if (first && pageMode(route.page) !== m.id) go(first.path);
                if (route.settings !== null && first) go(first.path);
              }}
            >
              <Icon className="ic" weight="duotone" />
              {m.id === 'settings' && setupPending && can('admin') && <span className="rail-pip" />}
            </button>
          );
        })}
        <span className="rail-grow" />
        <button type="button" className="avatar-btn" aria-label={t('profile')} onClick={e => setProfile(e.currentTarget)} data-testid="profile-btn">
          <span className="avatar">{(me?.displayName || '').trim().slice(0, 1) || <User className="ic" weight="duotone" />}</span>
        </button>
      </nav>
      <aside className="side" aria-label={MODES.find(m => m.id === mode)?.label()}>
        <div className="ws">
          <div className="ws-mark">{brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : mark}</div>
          <div className="ws-name grow">
            <b data-testid="side-brand">{name}</b>
            <span className="ltr" style={{ textAlign: 'start' }}>
              {snap.cfg?.db}
            </span>
          </div>
        </div>
        <button type="button" className="side-search" onClick={() => setPal(true)} data-testid="side-search">
          <MagnifyingGlass className="ic" />
          <span className="grow" style={{ textAlign: 'start' }}>
            {t('search')}
          </span>
          <span className="keys">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        {mode === 'settings' ? (
          GROUPS.map(g => {
            const list = sections.filter(s => s.group === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id} className="stack" style={{ gap: 2 }}>
                <div className="side-label">{g.label()}</div>
                {list.map(s => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className="nav"
                      aria-current={route.settings === s.id ? 'page' : undefined}
                      onClick={() => (s.id === 'setup' ? openWizard() : openSettings(s.id))}
                      data-testid={`side-st-${s.id}`}
                    >
                      <Icon className="ic" weight={route.settings === s.id ? 'duotone' : 'regular'} />
                      <span className="nav-label">{s.label()}</span>
                      {s.id === 'setup' && setupPending && <span className="badge b-info">{t('navSetup')}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })
        ) : (
          <>
            <div className="side-label">{MODES.find(m => m.id === mode)?.label()}</div>
            {pages.map(p => {
              const Icon = p.icon;
              const cur = route.settings === null && isCurrent(p.path, route.page, route.query);
              return (
                <button key={p.id} type="button" className="nav" aria-current={cur ? 'page' : undefined} onClick={() => go(p.path)} data-testid={`side-${p.id}`}>
                  <Icon className="ic" weight={cur ? 'duotone' : 'regular'} />
                  <span className="nav-label">{p.label()}</span>
                </button>
              );
            })}
          </>
        )}
        <div className="side-foot">
          <button type="button" className="nav" onClick={() => openSettings('brand')} data-testid="side-open-settings">
            <GearSix className="ic" />
            <span className="nav-label">{t('navSettings')}</span>
          </button>
          <div className="row small muted" style={{ padding: '4px 8px' }}>
            <span className="ellipsis">{fmtPhone(me?.phone ?? '')}</span>
            <span className="grow" />
            <span className="badge">{roleLabel(role)}</span>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn btn-icon menu-btn" aria-label={t('openMenu')} onClick={() => setDrawer(true)} data-testid="menu-btn">
            <List className="ic" />
          </button>
          <div className="crumbs">
            {props.crumbs.slice(0, -1).map((c, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                <span className="crumb">{c}</span>
                {document.documentElement.dir === 'rtl' ? <CaretLeft className="crumb-sep" /> : <CaretRight className="crumb-sep" />}
              </span>
            ))}
            <h1 className="crumb-current">{props.crumbs[props.crumbs.length - 1]}</h1>
          </div>
          <button type="button" className="btn btn-icon menu-btn" aria-label={t('search')} onClick={() => setPal(true)}>
            <MagnifyingGlass className="ic" />
          </button>
          <button type="button" className="db-btn" onClick={e => setDbPop(e.currentTarget)} data-testid="db-btn" title={t('dbSwitch')}>
            <span className={`live-dot ${snap.phase === 'ready' ? '' : 'off'}`} />
            <Database className="ic" style={{ width: 16, height: 16 }} />
            <span className="db-label ellipsis ltr">{snap.cfg?.db}</span>
          </button>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? t('themeLight') : t('themeDark')}
            data-testid="theme-toggle"
          >
            {theme === 'dark' ? <Sun className="ic" /> : <Moon className="ic" />}
          </button>
        </header>
        {snap.phase === 'lost' && (
          <div className="notice notice-warn" style={{ margin: '12px 20px 0', borderRadius: 8 }}>
            <span className="small">{t('connLost')}</span>
          </div>
        )}
        {props.children}
      </div>
      {pal && <Palette onClose={() => setPal(false)} />}
      {profile && <ProfileMenu anchor={profile} onClose={() => setProfile(null)} />}
      {dbPop && <DbMenu anchor={dbPop} onClose={() => setDbPop(null)} />}
    </div>
  );
}

function ProfileMenu(props: { anchor: HTMLElement; onClose: () => void }) {
  const { me, role } = useSession();
  const l = useLocale();
  const theme = useTheme();
  const langs = useRows('language');
  const [name, setName] = useState(me?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  async function switchLang(code: 'fa' | 'en') {
    setLocale(code);
    if (me && langs.some(x => x.code === code && x.isActive)) await runToast(c => c.reducers.updateProfile({ displayName: me.displayName, lang: code }));
  }
  return (
    <Pop anchor={props.anchor} onClose={props.onClose} side="beside" testId="profile-menu" width={280}>
      <div className="pop-pad stack stack-sm" style={{ gap: 2 }}>
        <b>{me?.displayName || t('plNoName')}</b>
        <span className="small muted">
          {fmtPhone(me?.phone ?? '')} · {roleLabel(role)}
        </span>
      </div>
      <div className="pop-sep" />
      <form
        className="pop-pad stack stack-sm"
        onSubmit={async e => {
          e.preventDefault();
          if (!me) return;
          setBusy(true);
          await runToast(c => c.reducers.updateProfile({ displayName: name, lang: me.lang }), t('saved'));
          setBusy(false);
        }}
      >
        <Field label={t('profileName')} htmlFor="pf-name">
          <div className="input-group">
            <input id="pf-name" className="input grow" value={name} onChange={e => setName(e.target.value)} maxLength={40} />
            <SaveButton busy={busy} testId="profile-save" />
          </div>
        </Field>
      </form>
      <div className="pop-sep" />
      <div className="pop-label">{t('profileLang')}</div>
      {(['fa', 'en'] as const).map(code => (
        <button key={code} type="button" className="pop-item" onClick={() => switchLang(code)} data-testid={`profile-lang-${code}`}>
          <Translate className="ic" />
          <span className="grow">{code === 'fa' ? 'فارسی' : 'English'}</span>
          {l === code && <Check className="ic" />}
        </button>
      ))}
      <div className="pop-label">{t('profileTheme')}</div>
      {(['light', 'dark'] as const).map(th => (
        <button key={th} type="button" className="pop-item" onClick={() => setTheme(th)} data-testid={`profile-theme-${th}`}>
          {th === 'light' ? <Sun className="ic" /> : <Moon className="ic" />}
          <span className="grow">{th === 'light' ? t('themeLight') : t('themeDark')}</span>
          {theme === th && <Check className="ic" />}
        </button>
      ))}
      <div className="pop-sep" />
      <button
        type="button"
        className="pop-item"
        data-testid="logout"
        onClick={async () => {
          props.onClose();
          await runToast(c => c.reducers.logout({}));
        }}
      >
        <SignOut className="ic ic-dir" />
        {t('logout')}
      </button>
    </Pop>
  );
}

function DbMenu(props: { anchor: HTMLElement; onClose: () => void }) {
  const snap = useSnap();
  const [db, setDb] = useState('');
  const recent = recentDbs().filter(r => r.server === snap.cfg?.server);
  return (
    <Pop anchor={props.anchor} onClose={props.onClose} align="end" testId="db-menu" width={300}>
      <div className="pop-label">{t('dbCurrent')}</div>
      <div className="pop-pad row">
        <span className="live-dot" />
        <span className="stack" style={{ gap: 0, minWidth: 0 }}>
          <b className="ltr ellipsis" style={{ textAlign: 'start' }}>
            {snap.cfg?.db}
          </b>
          <span className="small muted ltr ellipsis" style={{ textAlign: 'start' }}>
            {snap.cfg?.server}
          </span>
        </span>
      </div>
      {recent.filter(r => r.db !== snap.cfg?.db).length > 0 && (
        <>
          <div className="pop-sep" />
          <div className="pop-label">{t('dbRecent')}</div>
          {recent
            .filter(r => r.db !== snap.cfg?.db)
            .map(r => (
              <button key={r.db} type="button" className="pop-item" onClick={() => saveCfg(r)}>
                <Database className="ic" />
                <span className="ltr">{r.db}</span>
              </button>
            ))}
        </>
      )}
      <div className="pop-sep" />
      <form
        className="pop-pad stack stack-sm"
        onSubmit={e => {
          e.preventDefault();
          if (db.trim() && snap.cfg) {
            props.onClose();
            saveCfg({ server: snap.cfg.server, db });
          }
        }}
      >
        <Field label={t('dbOther')} htmlFor="db-other">
          <div className="input-group">
            <input id="db-other" className="input ltr grow" value={db} onChange={e => setDb(e.target.value)} placeholder="stg-…" />
            <button type="submit" className="btn btn-primary">
              {t('dbOpen')}
            </button>
          </div>
        </Field>
      </form>
    </Pop>
  );
}

type Cmd = { id: string; label: string; alt: string; where: string; icon: ReactNode; run: () => void };

function Palette(props: { onClose: () => void }) {
  const { can } = useSession();
  const l = useLocale();
  const theme = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEscape(props.onClose);
  const cmds = useMemo<Cmd[]>(() => {
    const other = l === 'fa' ? 'en' : 'fa';
    const inOther = (fn: () => string) => withLocale(other, fn);
    const out: Cmd[] = [];
    for (const p of PAGES.filter(x => can(x.need))) {
      const Icon = p.icon;
      out.push({ id: `p-${p.id}`, label: p.label(), alt: inOther(p.label), where: t('palPages'), icon: <Icon className="ic" />, run: () => go(p.path) });
    }
    for (const s of SECTIONS.filter(x => can(x.need))) {
      const Icon = s.icon;
      out.push({
        id: `s-${s.id}`,
        label: s.label(),
        alt: inOther(s.label),
        where: t('palSettings'),
        icon: <Icon className="ic" />,
        run: () => (s.id === 'setup' ? openWizard() : openSettings(s.id)),
      });
    }
    out.push({ id: 'a-theme', label: t('palTheme'), alt: inOther(() => t('palTheme')), where: t('palActions'), icon: theme === 'dark' ? <Sun className="ic" /> : <Moon className="ic" />, run: () => setTheme(theme === 'dark' ? 'light' : 'dark') });
    out.push({ id: 'a-lang', label: t('palLang'), alt: inOther(() => t('palLang')), where: t('palActions'), icon: <Translate className="ic" />, run: () => setLocale(other) });
    out.push({ id: 'a-logout', label: t('logout'), alt: inOther(() => t('logout')), where: t('palActions'), icon: <SignOut className="ic ic-dir" />, run: () => runToast(c => c.reducers.logout({})) });
    return out;
  }, [l, theme, can]);
  const needle = latin(q).trim().toLowerCase();
  const list = needle ? cmds.filter(c => c.label.toLowerCase().includes(needle) || c.alt.toLowerCase().includes(needle) || c.id.includes(needle)) : cmds;
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  function pick(c: Cmd | undefined) {
    if (!c) return;
    props.onClose();
    c.run();
  }
  let lastWhere = '';
  return (
    <div className="pal-holder" data-testid="palette">
      <div className="scrim" onClick={props.onClose} />
      <div className="pal" role="dialog" aria-modal="true" aria-label={t('search')}>
        <div className="pal-head">
          <MagnifyingGlass className="ic" />
          <input
            className="pal-input"
            autoFocus
            value={q}
            placeholder={t('palPlaceholder')}
            onChange={e => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel(s => Math.min(list.length - 1, s + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel(s => Math.max(0, s - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(list[sel]);
              }
            }}
          />
          <span className="keys">
            <kbd>Esc</kbd>
          </span>
        </div>
        <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
          {list.length === 0 && <div className="pal-empty">{t('palEmpty')}</div>}
          {list.map((c, i) => {
            const head = c.where !== lastWhere ? c.where : null;
            lastWhere = c.where;
            return (
              <div key={c.id}>
                {head && <div className="pal-group">{head}</div>}
                <button type="button" className="pal-row" role="option" aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => pick(c)} data-testid={`pal-${c.id}`}>
                  {c.icon}
                  <span className="grow">{c.label}</span>
                  <span className="pal-where">{c.alt}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="pal-foot">{t('palHint')}</div>
      </div>
    </div>
  );
}
