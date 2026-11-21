import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useRows, useSnap } from './conn.ts';
import { t, useLocale } from './i18n.ts';
import { useRoute, useSession } from './app.ts';
import { ConfirmHost, Toasts } from './ui.tsx';
import { ConnectScreen, ConnectingScreen, LoginScreen, NoAccessScreen } from './auth.tsx';
import { Shell } from './shell.tsx';
import { Admins, Audit, Dashboard } from './pages.tsx';
import { PlayerPage, PlayersList, Reports, Restrictions } from './moderation.tsx';
import { Achievements, Claims, EventLog, EventRules, EventTypes, LevelTables, MetaRelations, Streaks, TaskGroups, Tasks } from './progress.tsx';
import { ItemTypes, Items, Offers } from './itemsui.tsx';
import { Banners, ChanceGames, ChancePlays, Placements, SponsorReport, Sponsors } from './promo.tsx';
import { Currencies, EconomyOverview, Gifts, Metas, Payments, PrizeGroups, Prizes, Products } from './economy.tsx';
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

  const known = route.page === 'player' || route.page === 'sponsor-report' || PAGES.some(p => p.id === route.page && can(p.need));
  const def = known ? route.page : 'dashboard';
  const PAGE_EL: Record<string, () => ReactNode> = {
    players: () => <PlayersList />,
    player: () => <PlayerPage key={route.query.get('id') ?? ''} />,
    restrictions: () => <Restrictions />,
    reports: () => <Reports />,
    economy: () => <EconomyOverview />,
    currencies: () => <Currencies />,
    metas: () => <Metas />,
    prizes: () => <Prizes />,
    'prize-groups': () => <PrizeGroups />,
    products: () => <Products />,
    gifts: () => <Gifts />,
    payments: () => <Payments />,
    'event-types': () => <EventTypes />,
    'event-log': () => <EventLog />,
    'event-rules': () => <EventRules />,
    'level-tables': () => <LevelTables />,
    'meta-relations': () => <MetaRelations />,
    streaks: () => <Streaks />,
    tasks: () => <Tasks />,
    'task-groups': () => <TaskGroups />,
    achievements: () => <Achievements />,
    claims: () => <Claims />,
    'item-types': () => <ItemTypes />,
    items: () => <Items />,
    offers: () => <Offers />,
    placements: () => <Placements />,
    banners: () => <Banners />,
    sponsors: () => <Sponsors />,
    'sponsor-report': () => <SponsorReport key={route.query.get('id') ?? ''} />,
    'chance-games': () => <ChanceGames />,
    'chance-plays': () => <ChancePlays />,
    admins: () => <Admins />,
    audit: () => <Audit />,
  };
  const page = (PAGE_EL[def] ?? (() => <Dashboard />))();
  const mode = MODES.find(m => m.id === pageMode(def));
  const pageLabel = def === 'player' ? t('navPlayer') : def === 'sponsor-report' ? t('spReport') : PAGES.find(p => p.id === def)?.label() ?? t('dashTitle');
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
