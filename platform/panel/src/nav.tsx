import type { Icon } from '@phosphor-icons/react';
import {
  ChartPieSlice,
  ChatCircleText,
  ClockCounterClockwise,
  DeviceMobile,
  FolderSimple,
  GearSix,
  IdentificationBadge,
  Key,
  MagicWand,
  Palette,
  ShieldCheck,
  Tag,
  Translate,
  Tray,
  Users,
  UsersThree,
  Password,
  LockKey,
  Prohibit,
  Flag,
  Coins,
  CurrencyCircleDollar,
  SlidersHorizontal,
  Gift,
  Stack,
  Storefront,
  Receipt,
  Ticket,
  ChartBar,
  UserGear,
  DeviceMobileCamera,
  GlobeHemisphereEast,
  ListBullets,
  Scales,
  CreditCard,
  Wallet,
} from '@phosphor-icons/react';
import { t } from './i18n.ts';

export type Need = 'operator' | 'admin' | 'owner';

export type ModeId = 'overview' | 'players' | 'economy' | 'access' | 'settings';

export type PageDef = { id: string; path: string; mode: ModeId; label: () => string; icon: Icon; need: Need };

export const MODES: { id: ModeId; label: () => string; icon: Icon }[] = [
  { id: 'overview', label: () => t('navOverview'), icon: ChartPieSlice },
  { id: 'players', label: () => t('navModeration'), icon: UsersThree },
  { id: 'economy', label: () => t('navEconomy'), icon: Coins },
  { id: 'access', label: () => t('navAccess'), icon: ShieldCheck },
  { id: 'settings', label: () => t('navSettings'), icon: GearSix },
];

export const PAGES: PageDef[] = [
  { id: 'dashboard', path: 'dashboard', mode: 'overview', label: () => t('navDashboard'), icon: ChartPieSlice, need: 'operator' },
  { id: 'players', path: 'players', mode: 'players', label: () => t('navPlayersList'), icon: Users, need: 'operator' },
  { id: 'restrictions', path: 'restrictions', mode: 'players', label: () => t('navRestrictions'), icon: Prohibit, need: 'operator' },
  { id: 'reports', path: 'reports', mode: 'players', label: () => t('navReports'), icon: Flag, need: 'operator' },
  { id: 'economy', path: 'economy', mode: 'economy', label: () => t('navEcoOverview'), icon: ChartBar, need: 'operator' },
  { id: 'currencies', path: 'currencies', mode: 'economy', label: () => t('navCurrencies'), icon: CurrencyCircleDollar, need: 'operator' },
  { id: 'metas', path: 'metas', mode: 'economy', label: () => t('navMetas'), icon: SlidersHorizontal, need: 'operator' },
  { id: 'prizes', path: 'prizes', mode: 'economy', label: () => t('navPrizes'), icon: Gift, need: 'operator' },
  { id: 'prize-groups', path: 'prize-groups', mode: 'economy', label: () => t('navPrizeGroups'), icon: Stack, need: 'operator' },
  { id: 'products', path: 'products', mode: 'economy', label: () => t('navProducts'), icon: Storefront, need: 'operator' },
  { id: 'gifts', path: 'gifts', mode: 'economy', label: () => t('navGifts'), icon: Ticket, need: 'operator' },
  { id: 'payments', path: 'payments', mode: 'economy', label: () => t('navPayments'), icon: Receipt, need: 'operator' },
  { id: 'admins', path: 'admins', mode: 'access', label: () => t('navAdmins'), icon: IdentificationBadge, need: 'operator' },
  { id: 'audit', path: 'audit', mode: 'access', label: () => t('navAudit'), icon: ClockCounterClockwise, need: 'admin' },
];

export type SectionDef = { id: string; group: 'project' | 'content' | 'login' | 'players' | 'economy'; label: () => string; icon: Icon; need: Need };

export const SECTIONS: SectionDef[] = [
  { id: 'brand', group: 'project', label: () => t('stBrand'), icon: Palette, need: 'operator' },
  { id: 'languages', group: 'project', label: () => t('stLanguages'), icon: Translate, need: 'operator' },
  { id: 'setup', group: 'project', label: () => t('stSetup'), icon: MagicWand, need: 'admin' },
  { id: 'key-types', group: 'content', label: () => t('stKeyTypes'), icon: Key, need: 'operator' },
  { id: 'categories', group: 'content', label: () => t('stCategories'), icon: FolderSimple, need: 'operator' },
  { id: 'tags', group: 'content', label: () => t('stTags'), icon: Tag, need: 'operator' },
  { id: 'sms', group: 'login', label: () => t('stSms'), icon: ChatCircleText, need: 'admin' },
  { id: 'test-phones', group: 'login', label: () => t('stTestPhones'), icon: DeviceMobile, need: 'admin' },
  { id: 'sandbox', group: 'login', label: () => t('stSandbox'), icon: Tray, need: 'admin' },
  { id: 'otp', group: 'login', label: () => t('stOtp'), icon: Password, need: 'operator' },
  { id: 'admin-login', group: 'login', label: () => t('stAdminLogin'), icon: LockKey, need: 'admin' },
  { id: 'account-rules', group: 'players', label: () => t('stAccountRules'), icon: UserGear, need: 'operator' },
  { id: 'app-versions', group: 'players', label: () => t('stAppVersions'), icon: DeviceMobileCamera, need: 'operator' },
  { id: 'countries', group: 'players', label: () => t('stCountries'), icon: GlobeHemisphereEast, need: 'operator' },
  { id: 'report-titles', group: 'players', label: () => t('stReportTitles'), icon: ListBullets, need: 'operator' },
  { id: 'report-rules', group: 'players', label: () => t('stReportRules'), icon: Scales, need: 'operator' },
  { id: 'payment-methods', group: 'economy', label: () => t('stPaymentMethods'), icon: CreditCard, need: 'admin' },
  { id: 'economy-settings', group: 'economy', label: () => t('stEconomySettings'), icon: Wallet, need: 'admin' },
];

export const GROUPS: { id: SectionDef['group']; label: () => string }[] = [
  { id: 'project', label: () => t('stGroupProject') },
  { id: 'content', label: () => t('stGroupContent') },
  { id: 'login', label: () => t('stGroupLogin') },
  { id: 'players', label: () => t('stGroupPlayers') },
  { id: 'economy', label: () => t('stGroupEconomy') },
];

export function pageMode(page: string): ModeId {
  if (page === 'player') return 'players';
  return PAGES.find(p => p.id === page)?.mode ?? 'overview';
}
