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
  UserCircleCheck,
  UserCircleMinus,
  Users,
  UsersThree,
  Password,
} from '@phosphor-icons/react';
import { t } from './i18n.ts';

export type Need = 'operator' | 'admin' | 'owner';

export type ModeId = 'overview' | 'players' | 'access' | 'settings';

export type PageDef = { id: string; path: string; mode: ModeId; label: () => string; icon: Icon; need: Need };

export const MODES: { id: ModeId; label: () => string; icon: Icon }[] = [
  { id: 'overview', label: () => t('navOverview'), icon: ChartPieSlice },
  { id: 'players', label: () => t('navPlayers'), icon: UsersThree },
  { id: 'access', label: () => t('navAccess'), icon: ShieldCheck },
  { id: 'settings', label: () => t('navSettings'), icon: GearSix },
];

export const PAGES: PageDef[] = [
  { id: 'dashboard', path: 'dashboard', mode: 'overview', label: () => t('navDashboard'), icon: ChartPieSlice, need: 'operator' },
  { id: 'players', path: 'players', mode: 'players', label: () => t('navAllPlayers'), icon: Users, need: 'operator' },
  { id: 'players-active', path: 'players?status=active', mode: 'players', label: () => t('navActivePlayers'), icon: UserCircleCheck, need: 'operator' },
  { id: 'players-blocked', path: 'players?status=blocked', mode: 'players', label: () => t('navBlockedPlayers'), icon: UserCircleMinus, need: 'operator' },
  { id: 'admins', path: 'admins', mode: 'access', label: () => t('navAdmins'), icon: IdentificationBadge, need: 'operator' },
  { id: 'audit', path: 'audit', mode: 'access', label: () => t('navAudit'), icon: ClockCounterClockwise, need: 'admin' },
];

export type SectionDef = { id: string; group: 'project' | 'content' | 'login'; label: () => string; icon: Icon; need: Need };

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
];

export const GROUPS: { id: SectionDef['group']; label: () => string }[] = [
  { id: 'project', label: () => t('stGroupProject') },
  { id: 'content', label: () => t('stGroupContent') },
  { id: 'login', label: () => t('stGroupLogin') },
];

export function pageMode(page: string): ModeId {
  return PAGES.find(p => p.id === page)?.mode ?? 'overview';
}
