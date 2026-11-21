import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useRows, useSnap } from './conn.ts';
import { t, useLocale } from './i18n.ts';
import { useRoute, useSession } from './app.ts';
import { ConfirmHost, Toasts } from './ui.tsx';
import { ConnectScreen, ConnectingScreen, LoginScreen, NoAccessScreen } from './auth.tsx';
import { Shell } from './shell.tsx';
import { Admins, Audit, Dashboard, Players } from './pages.tsx';
import { SettingsWindow } from './settings.tsx';
import { Wizard } from './wizard.tsx';
import { MODES, PAGES, pageMode } from './nav.tsx';

function Panel() {
  const route = useRoute();
  const snap = useSnap();
  const { can, me } = useSession();
  const settings = useRows('adminSettings')[0];
  const [wizard, setWizard] = useState(false);
  useLocale();

  useEffect(() => {
    const h = () => setWizard(true);
    window.addEventListener('stg-wizard', h);
    return () => window.removeEventListener('stg-wizard', h);
  }, []);

  useEffect(() => {
    if (!settings || settings.setupDone || !can('admin') || !me || !snap.cfg) return;
    const key = `stg.wizardShown:${snap.cfg.server}|${snap.cfg.db}|${me.id}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    setWizard(true);
  }, [settings?.setupDone, !!settings, me?.id, can('admin')]);

  const def = PAGES.find(p => p.id === route.page && can(p.need)) ? route.page : 'dashboard';
  const page =
    def === 'players' ? <Players key="players" /> : def === 'admins' ? <Admins /> : def === 'audit' ? <Audit /> : <Dashboard />;
  const mode = MODES.find(m => m.id === pageMode(def));
  const pageLabel = def === 'players' ? t('plTitle') : def === 'admins' ? t('adTitle') : def === 'audit' ? t('auTitle') : t('dashTitle');
  const crumbs = mode && mode.label() !== pageLabel ? [mode.label(), pageLabel] : [pageLabel];

  return (
    <>
      <Shell crumbs={crumbs}>{page}</Shell>
      {route.settings !== null && <SettingsWindow />}
      {wizard && <Wizard onClose={() => setWizard(false)} />}
    </>
  );
}

function App() {
  const snap = useSnap();
  const { me, role } = useSession();
  useLocale();
  let body;
  if (!snap.cfg) body = <ConnectScreen />;
  else if (snap.phase !== 'ready') body = <ConnectingScreen />;
  else if (!me) body = <LoginScreen />;
  else if (!role) body = <NoAccessScreen />;
  else body = <Panel />;
  return (
    <>
      {body}
      <ConfirmHost />
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
