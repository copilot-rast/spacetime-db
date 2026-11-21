import { useState } from 'react';
import {
  HandCoins,
  Lightning,
  ListChecks,
  Medal,
  Key,
  LockKey,
  ChartBar,
  Flag,
  Receipt,
  SpeakerSlash,
  Storefront,
  Warning,
  ArrowsClockwise,
  ChatCircleText,
  ClockCounterClockwise,
  DeviceMobile,
  FolderSimple,
  IdentificationBadge,
  MagicWand,
  MagnifyingGlass,
  Plus,
  Prohibit,
  ShieldCheck,
  Tag,
  Translate,
  Trash,
  UserCircleCheck,
  UserCirclePlus,
  UserCircleMinus,
  Users,
  UsersThree,
} from '@phosphor-icons/react';
import { getConn, markMutation, useRows } from './conn.ts';
import { actionGroups, actionLabel, date, digits, errorText, num, phone as fmtPhone, roleLabel, t, useLocale } from './i18n.ts';
import { go, openSettings, pageQuery, runToast, useDebounced, useFetch, useRoute, useSession } from './app.ts';
import { ConfirmHost, Empty, ErrBox, Notice, Pager, Seg, Skel, Switch, TableSkeleton, confirmAsk } from './ui.tsx';
import { CreateUserDialog, ResetPasswordDialog, kindLabel } from './dialogs.tsx';
import { openWizard } from './shell.tsx';

export { ConfirmHost };

function tsDate(ts: { toDate(): Date }) {
  return date(ts.toDate());
}

function RoleBadge(props: { role: string }) {
  if (!props.role) return <span className="muted small">—</span>;
  const cls = props.role === 'owner' ? 'b-violet' : props.role === 'admin' ? 'b-info' : 'b-teal';
  return <span className={`badge ${cls}`}>{roleLabel(props.role)}</span>;
}

function StatusBadge(props: { status: string }) {
  return props.status === 'blocked' ? (
    <span className="badge b-bad">
      <span className="dot" />
      {t('plStatusBlocked')}
    </span>
  ) : (
    <span className="badge b-ok">
      <span className="dot" />
      {t('plStatusActive')}
    </span>
  );
}

function TileGrid(props: { tiles: { key: string; label: string; value: string; icon: React.ReactNode; tint: string; go: () => void }[]; loading: boolean; n: number; testId: string }) {
  return (
    <div className="tiles" data-testid={props.testId}>
      {props.loading
        ? Array.from({ length: props.n }).map((_, i) => (
            <div className="tile" key={i} style={{ cursor: 'default' }}>
              <Skel w={40} h={40} r={8} style={{ gridRow: '1 / span 2' }} />
              <Skel w="55%" h={10} />
              <Skel w="35%" h={18} style={{ marginTop: 6 }} />
            </div>
          ))
        : props.tiles.map(x => (
            <button type="button" key={x.key} className="tile" onClick={x.go} data-testid={`tile-${x.key}`}>
              <span className={`tile-ic badge ${x.tint}`} style={{ height: 40, padding: 0, justifyContent: 'center' }}>
                {x.icon}
              </span>
              <span className="tile-label">{x.label}</span>
              <span className={`tile-value ${x.key === 'sms' ? 'tile-value-text' : ''}`}>{x.value}</span>
            </button>
          ))}
    </div>
  );
}

export function Dashboard() {
  const { can } = useSession();
  useLocale();
  if (!can('operator')) return <SupportHome />;
  return <StaffDashboard />;
}

function SupportHome() {
  const { me, role } = useSession();
  return (
    <main className="page" data-testid="page-dashboard">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('dashTitle')}</div>
          <div className="page-sub">{me?.displayName || roleLabel(role)}</div>
        </div>
      </div>
      <Notice title={t('supHomeTitle')} text={t('supHomeText')} />
    </main>
  );
}

function StaffDashboard() {
  const { can } = useSession();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminDashboard({}), []);
  const mod = useFetch(() => getConn().procedures.adminModerationSummary({}), []);
  const eco = useFetch(() => getConn().procedures.adminEconomySummary({}), []);
  const gam = useFetch(() => getConn().procedures.adminGamificationSummary({}), []);
  type Tile = { key: string; label: string; value: string; icon: React.ReactNode; tint: string; go: () => void };
  const modTiles: Tile[] = mod.data
    ? [
        { key: 'reportsOpen', label: t('dashReportsOpen'), value: num(mod.data.reportsOpen), icon: <Flag className="ic" weight="duotone" />, tint: mod.data.reportsOpen ? 'b-warn' : '', go: () => go('reports?status=open') },
        { key: 'reportsReviewing', label: t('dashReportsReviewing'), value: num(mod.data.reportsReviewing), icon: <MagnifyingGlass className="ic" weight="duotone" />, tint: 'b-info', go: () => go('reports?status=reviewing') },
        { key: 'suspended', label: t('dashSuspended'), value: num(mod.data.suspended), icon: <Prohibit className="ic" weight="duotone" />, tint: 'b-bad', go: () => go('players?status=suspended') },
        { key: 'muted', label: t('dashMuted'), value: num(mod.data.muted), icon: <SpeakerSlash className="ic" weight="duotone" />, tint: 'b-warn', go: () => go('players?status=muted') },
        { key: 'tagged', label: t('dashTagged'), value: num(mod.data.tagged), icon: <Tag className="ic" weight="duotone" />, tint: 'b-teal', go: () => go('players?status=tagged') },
      ]
    : [];
  const ecoTiles: Tile[] = eco.data
    ? [
        { key: 'revenue', label: t('dashRevenue'), value: num(eco.data.revenueToman30), icon: <ChartBar className="ic" weight="duotone" />, tint: 'b-ok', go: () => go('economy') },
        { key: 'paymentsDay', label: t('dashPaymentsDay'), value: num(eco.data.paymentsDay), icon: <Receipt className="ic" weight="duotone" />, tint: 'b-info', go: () => go('payments') },
        { key: 'pending', label: t('dashPending'), value: num(eco.data.pending), icon: <ArrowsClockwise className="ic" weight="duotone" />, tint: eco.data.pending ? 'b-warn' : '', go: () => go('payments?status=pending') },
        { key: 'grantErrors', label: t('dashGrantErrors'), value: num(eco.data.grantErrors), icon: <Warning className="ic" weight="duotone" />, tint: eco.data.grantErrors ? 'b-bad' : '', go: () => go('payments?status=success') },
        { key: 'products', label: t('dashProducts'), value: num(eco.data.activeProducts), icon: <Storefront className="ic" weight="duotone" />, tint: 'b-teal', go: () => go('products') },
      ]
    : [];
  const tiles: { key: string; label: string; value: string; icon: React.ReactNode; tint: string; go: () => void }[] = data
    ? [
        { key: 'accounts', label: t('dashAccounts'), value: num(data.accounts), icon: <UsersThree className="ic" weight="duotone" />, tint: 'b-info', go: () => go('players') },
        { key: 'newToday', label: t('dashNewToday'), value: num(data.newToday), icon: <UserCirclePlus className="ic" weight="duotone" />, tint: 'b-teal', go: () => go('players') },
        { key: 'activeToday', label: t('dashActiveToday'), value: num(data.activeToday), icon: <UserCircleCheck className="ic" weight="duotone" />, tint: 'b-ok', go: () => go('players') },
        { key: 'blocked', label: t('dashBlocked'), value: num(data.blocked), icon: <UserCircleMinus className="ic" weight="duotone" />, tint: 'b-bad', go: () => go('players?status=blocked') },
        { key: 'admins', label: t('dashAdmins'), value: num(data.admins), icon: <IdentificationBadge className="ic" weight="duotone" />, tint: 'b-violet', go: () => go('admins') },
        { key: 'sessions', label: t('dashSessions'), value: num(data.sessions), icon: <DeviceMobile className="ic" weight="duotone" />, tint: '', go: () => go('players') },
        { key: 'languages', label: t('dashLanguages'), value: num(data.languages), icon: <Translate className="ic" weight="duotone" />, tint: 'b-info', go: () => openSettings('languages') },
        { key: 'categories', label: t('dashCategories'), value: num(data.categories), icon: <FolderSimple className="ic" weight="duotone" />, tint: 'b-warn', go: () => openSettings('categories') },
        { key: 'tags', label: t('dashTags'), value: num(data.tags), icon: <Tag className="ic" weight="duotone" />, tint: 'b-teal', go: () => openSettings('tags') },
        {
          key: 'sms',
          label: t('dashSms'),
          value: data.smsKind ? kindLabel(data.smsKind) : t('dashSmsNone'),
          icon: <ChatCircleText className="ic" weight="duotone" />,
          tint: data.smsKind ? 'b-ok' : 'b-bad',
          go: () => (can('admin') ? openSettings('sms') : undefined),
        },
      ]
    : [];
  const gamTiles: Tile[] = gam.data
    ? [
        { key: 'eventsToday', label: t('dashEventsToday'), value: num(gam.data.eventsToday), icon: <Lightning className="ic" weight="duotone" />, tint: 'b-info', go: () => go('event-log') },
        { key: 'claimsReady', label: t('dashClaimsReady'), value: num(gam.data.claimsReady), icon: <HandCoins className="ic" weight="duotone" />, tint: 'b-warn', go: () => go('claims?status=ready') },
        { key: 'claimsFailed', label: t('dashClaimsFailed'), value: num(gam.data.claimsFailed), icon: <Warning className="ic" weight="duotone" />, tint: gam.data.claimsFailed ? 'b-bad' : '', go: () => go('claims?status=failed') },
        { key: 'tasksCount', label: t('navTasks'), value: num(gam.data.tasks), icon: <ListChecks className="ic" weight="duotone" />, tint: 'b-teal', go: () => go('tasks') },
        { key: 'achievementsCount', label: t('navAchievements'), value: num(gam.data.achievements), icon: <Medal className="ic" weight="duotone" />, tint: 'b-violet', go: () => go('achievements') },
      ]
    : [];
  return (
    <main className="page" data-testid="page-dashboard">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('dashTitle')}</div>
        </div>
      </div>
      {data && !data.setupDone && (
        <Notice
          title={t('dashSetupTitle')}
          text={t('dashSetupText')}
          icon={<MagicWand className="ic" weight="duotone" />}
          action={
            can('admin') ? (
              <button type="button" className="btn btn-primary" onClick={openWizard} data-testid="dash-setup">
                {t('dashSetupGo')}
              </button>
            ) : undefined
          }
        />
      )}
      <ErrBox text={error ? errorText(error) : null} />
      <div className="section-label">{t('dashProject')}</div>
      <TileGrid tiles={tiles} loading={loading && !data} n={10} testId="tiles" />
      <div className="section-label">{t('dashModeration')}</div>
      <TileGrid tiles={modTiles} loading={!mod.data} n={5} testId="tiles-mod" />
      <div className="section-label">{t('dashEconomy')}</div>
      <TileGrid tiles={ecoTiles} loading={!eco.data} n={5} testId="tiles-eco" />
      <div className="section-label">{t('navProgress')}</div>
      {gam.data && gam.data.clockOffsetSec !== 0n && <Notice kind="warn" title={t('ckTitle')} text={t('dashClockOff')} />}
      <TileGrid tiles={gamTiles} loading={!gam.data} n={5} testId="tiles-gam" />
    </main>
  );
}

const PAGE_SIZE = 20;

export function Admins() {
  const { can, me } = useSession();
  useLocale();
  const list = useRows('adminAdmins');
  const loaded = list.length > 0;
  const [adding, setAdding] = useState(false);
  const [reset, setReset] = useState<{ id: bigint; name: string } | null>(null);
  const owner = can('owner');
  const rows = [...list].sort((a, b) => Number(b.isEnv) - Number(a.isEnv) || (a.createdAt.toDate().getTime() < b.createdAt.toDate().getTime() ? -1 : 1));
  type R = (typeof rows)[number];
  const editable = (r: R) => owner && !r.isEnv && r.accountId !== me?.id;
  async function remove(r: R) {
    if (!(await confirmAsk(t('puDeleteConfirm', { name: r.username }), { danger: true, ok: t('puDelete') }))) return;
    await runToast(c => c.reducers.adminDeleteUser({ accountId: r.accountId }), t('deleted'));
  }
  const roleCell = (r: R, card = false) =>
    editable(r) ? (
      <select
        className="select"
        style={{ height: 30, width: 'auto', minWidth: 120, fontSize: 13 }}
        value={r.role}
        onChange={e => runToast(c => c.reducers.adminSetUserRole({ accountId: r.accountId, role: e.target.value }), t('adRoleChanged'))}
        aria-label={t('puRole')}
        data-testid={`${card ? 'pu-crole' : 'pu-role'}-${r.username}`}
      >
        <option value="owner">{t('roleOwner')}</option>
        <option value="admin">{t('roleAdmin')}</option>
        <option value="operator">{t('roleOperator')}</option>
        <option value="support">{t('roleSupport')}</option>
      </select>
    ) : (
      <RoleBadge role={r.role} />
    );
  const statusCell = (r: R, card = false) =>
    editable(r) ? (
      <label className="check small">
        <Switch
          checked={r.isActive}
          label={t('puActive')}
          testId={`${card ? 'pu-cactive' : 'pu-active'}-${r.username}`}
          onChange={v => runToast(c => c.reducers.adminSetUserActive({ accountId: r.accountId, isActive: v }), v ? t('puActivated') : t('puDeactivated'))}
        />
        {r.isActive ? t('puActive') : t('puInactive')}
      </label>
    ) : (
      <span className={`badge ${r.isActive ? 'b-ok' : ''}`}>{r.isActive ? t('puActive') : t('puInactive')}</span>
    );
  const actions = (r: R, card = false) =>
    editable(r) ? (
      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm" onClick={() => setReset({ id: r.accountId, name: r.username })} data-testid={`${card ? 'pu-creset' : 'pu-reset'}-${r.username}`}>
          <Key className="ic" />
          {t('puReset')}
        </button>
        <button type="button" className="btn btn-sm btn-icon btn-danger-ghost" onClick={() => remove(r)} aria-label={t('puDelete')} title={t('puDelete')} data-testid={`${card ? 'pu-cdel' : 'pu-del'}-${r.username}`}>
          <Trash className="ic" />
        </button>
      </span>
    ) : r.isEnv ? (
      <span className="badge" title={t('puEnvHint')}>
        <LockKey className="ic" />
        {t('puEnv')}
      </span>
    ) : null;
  const userCell = (r: R) => (
    <span className="stack" style={{ gap: 0 }}>
      <span className="row primary">
        <span className="mono" style={{ fontSize: 13 }}>
          {r.username}
        </span>
        {r.accountId === me?.id && <span className="badge b-info">{t('adYou')}</span>}
      </span>
      {r.displayName && <span className="small muted">{r.displayName}</span>}
    </span>
  );
  return (
    <main className="page" data-testid="page-admins">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('adTitle')}</div>
          <div className="page-sub">{loaded ? num(rows.length) : <Skel w={40} h={10} />}</div>
        </div>
        {owner && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} data-testid="pu-add">
            <Plus className="ic" />
            {t('puAdd')}
          </button>
        )}
      </div>
      {!owner && <Notice kind="plain" text={t('puReadOnly')} icon={<ShieldCheck className="ic" />} />}
      <div className="table-wrap responsive">
        <table className="table" data-testid="pu-table">
          <thead>
            <tr>
              <th>{t('puUsername')}</th>
              <th>{t('puRole')}</th>
              <th>{t('puStatus')}</th>
              <th>{t('puLastLogin')}</th>
              <th>{t('plColCreated')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <TableSkeleton cols={6} rows={3} />
            ) : (
              rows.map(r => (
                <tr key={String(r.accountId)} data-testid={`pu-row-${r.username}`}>
                  <td>{userCell(r)}</td>
                  <td>{roleCell(r)}</td>
                  <td>{statusCell(r)}</td>
                  <td className="nowrap">{r.lastLoginAt ? tsDate(r.lastLoginAt) : <span className="muted">{t('puNever')}</span>}</td>
                  <td className="nowrap">{tsDate(r.createdAt)}</td>
                  <td className="end">{actions(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(r => (
            <div className="pcard" key={String(r.accountId)}>
              <div className="row">
                <span className="grow">{userCell(r)}</span>
                {statusCell(r, true)}
              </div>
              <div className="pcard-meta">
                <span>{t('puLastLogin')}</span>
                <span>{r.lastLoginAt ? tsDate(r.lastLoginAt) : t('puNever')}</span>
              </div>
              <div className="row">
                {roleCell(r, true)}
                <span className="grow" />
                {actions(r, true)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {adding && <CreateUserDialog onClose={() => setAdding(false)} />}
      {reset && <ResetPasswordDialog accountId={reset.id} name={reset.name} onClose={() => setReset(null)} />}
    </main>
  );
}

const WORDS: Record<string, () => string> = {
  owner: () => t('roleOwner'),
  admin: () => t('roleAdmin'),
  operator: () => t('roleOperator'),
  support: () => t('roleSupport'),
  active: () => t('plStatusActive'),
  blocked: () => t('plStatusBlocked'),
  true: () => t('yes'),
  false: () => t('no'),
  sandbox: () => t('smKindSandbox'),
  kavenegar: () => t('smKindKavenegar'),
  smsir: () => t('smKindSmsir'),
};

function auditText(raw: string) {
  if (!raw) return '';
  let s = raw;
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') s = Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(' · ');
  } catch {}
  s = s.replace(/\b(owner|admin|operator|active|blocked|true|false|sandbox|kavenegar|smsir)\b/g, w => WORDS[w]());
  return digits(s);
}

export function Audit() {
  useLocale();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminAudit({ action, page, pageSize: PAGE_SIZE }), [action, page]);
  const rows = data?.rows ?? [];
  const detail = (s: string) => auditText(s);
  return (
    <main className="page" data-testid="page-audit">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('auTitle')}</div>
          <div className="page-sub">{data ? num(data.total) : <Skel w={40} h={10} />}</div>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => markMutation()} aria-label={t('refresh')} data-testid="au-refresh">
          <ArrowsClockwise className="ic" />
        </button>
      </div>
      <div className="toolbar">
        <select
          className="select"
          style={{ width: 'auto', minWidth: 200 }}
          value={action}
          onChange={e => {
            setAction(e.target.value);
            setPage(1);
          }}
          aria-label={t('auAction')}
          data-testid="au-action"
        >
          <option value="">{t('all')}</option>
          {actionGroups().map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="au-table">
          <thead>
            <tr>
              <th>{t('auColTime')}</th>
              <th>{t('auColWho')}</th>
              <th>{t('auColAction')}</th>
              <th>{t('auColTarget')}</th>
              <th>{t('auColDetail')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={5} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <Empty icon={<ClockCounterClockwise className="ic" weight="duotone" />} title={t('auEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.id)}>
                  <td className="nowrap">{tsDate(r.at)}</td>
                  <td className="nowrap">
                    <span className="ltr">{r.phone ? fmtPhone(r.phone) : t('auSystem')}</span>
                  </td>
                  <td>
                    <span className="stack" style={{ gap: 0 }}>
                      <span className="primary">{actionLabel(r.action)}</span>
                      <span className="mono muted">{r.action}</span>
                    </span>
                  </td>
                  <td className="nowrap">{detail(r.target) || '—'}</td>
                  <td className="cell-detail" title={r.detail}>
                    {detail(r.detail) || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(r => (
            <div className="pcard" key={String(r.id)}>
              <div className="row">
                <b className="grow ellipsis">{actionLabel(r.action)}</b>
                <span className="small muted">{tsDate(r.at)}</span>
              </div>
              <div className="pcard-meta">
                <span>{t('auColWho')}</span>
                <span>{r.phone ? fmtPhone(r.phone) : t('auSystem')}</span>
                <span>{t('auColTarget')}</span>
                <span>{detail(r.target) || '—'}</span>
                {r.detail && (
                  <>
                    <span>{t('auColDetail')}</span>
                    <span className="ellipsis">{detail(r.detail)}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}
