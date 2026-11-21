import { useState } from 'react';
import {
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
import { ConfirmHost, Empty, ErrBox, Notice, Pager, Seg, Skel, TableSkeleton, confirmAsk } from './ui.tsx';
import { AddAdminDialog, kindLabel } from './dialogs.tsx';
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

export function Dashboard() {
  const { can } = useSession();
  useLocale();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminDashboard({}), []);
  const tiles: { key: string; label: string; value: string; icon: React.ReactNode; tint: string; go: () => void }[] = data
    ? [
        { key: 'accounts', label: t('dashAccounts'), value: num(data.accounts), icon: <UsersThree className="ic" weight="duotone" />, tint: 'b-info', go: () => go('players') },
        { key: 'newToday', label: t('dashNewToday'), value: num(data.newToday), icon: <UserCirclePlus className="ic" weight="duotone" />, tint: 'b-teal', go: () => go('players') },
        { key: 'activeToday', label: t('dashActiveToday'), value: num(data.activeToday), icon: <UserCircleCheck className="ic" weight="duotone" />, tint: 'b-ok', go: () => go('players?status=active') },
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
      <div className="tiles" data-testid="tiles">
        {loading && !data
          ? Array.from({ length: 10 }).map((_, i) => (
              <div className="tile" key={i} style={{ cursor: 'default' }}>
                <Skel w={40} h={40} r={8} style={{ gridRow: '1 / span 2' }} />
                <Skel w="55%" h={10} />
                <Skel w="35%" h={18} style={{ marginTop: 6 }} />
              </div>
            ))
          : tiles.map(x => (
              <button type="button" key={x.key} className="tile" onClick={x.go} data-testid={`tile-${x.key}`}>
                <span className={`tile-ic badge ${x.tint}`} style={{ height: 40, padding: 0, justifyContent: 'center' }}>
                  {x.icon}
                </span>
                <span className="tile-label">{x.label}</span>
                <span className={`tile-value ${x.key === 'sms' ? 'tile-value-text' : ''}`}>{x.value}</span>
              </button>
            ))}
      </div>
    </main>
  );
}

const PAGE_SIZE = 20;

export function Players() {
  const route = useRoute();
  const { can, me } = useSession();
  useLocale();
  const status = route.query.get('status') ?? '';
  const [query, setQuery] = useState(route.query.get('q') ?? '');
  const [page, setPage] = useState(1);
  const q = useDebounced(query, 300);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminAccounts({ query: q, status, page, pageSize: PAGE_SIZE }), [q, status, page]);
  const setStatus = (s: string) => {
    setPage(1);
    pageQuery('players', { status: s, q: query });
  };
  async function toggle(id: bigint, phone: string, blocked: boolean) {
    const ok = await confirmAsk(blocked ? t('plUnblockConfirm', { phone: fmtPhone(phone) }) : t('plBlockConfirm', { phone: fmtPhone(phone) }), {
      danger: !blocked,
      ok: blocked ? t('plUnblock') : t('plBlock'),
    });
    if (!ok) return;
    await runToast(c => c.reducers.adminSetAccountStatus({ accountId: id, status: blocked ? 'active' : 'blocked' }), blocked ? t('plUnblocked') : t('plBlocked'));
  }
  const rows = data?.rows ?? [];
  const canEdit = can('admin');
  const action = (r: (typeof rows)[number], card = false) =>
    canEdit && r.id !== me?.id && r.role !== 'owner' && (!r.role || can('owner')) ? (
      <button
        type="button"
        className={`btn btn-sm ${r.status === 'blocked' ? 'btn-outline' : 'btn-danger-ghost'}`}
        onClick={() => toggle(r.id, r.phone, r.status === 'blocked')}
        data-testid={`${card ? 'pl-ctoggle' : 'pl-toggle'}-${r.phone}`}
      >
        {r.status === 'blocked' ? <UserCircleCheck className="ic" /> : <Prohibit className="ic" />}
        {r.status === 'blocked' ? t('plUnblock') : t('plBlock')}
      </button>
    ) : null;
  return (
    <main className="page" data-testid="page-players">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('plTitle')}</div>
          <div className="page-sub" data-testid="pl-total">
            {data ? t('plTotal', { n: data.total }) : <Skel w={80} h={10} />}
          </div>
        </div>
      </div>
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input
            className="input"
            name="q"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={t('plSearch')}
            aria-label={t('plSearch')}
            data-testid="pl-search"
          />
        </div>
        <Seg
          value={status}
          label={t('plStatus')}
          onChange={setStatus}
          options={[
            { value: '', label: t('all') },
            { value: 'active', label: t('plStatusActive') },
            { value: 'blocked', label: t('plStatusBlocked') },
          ]}
        />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="pl-table">
          <thead>
            <tr>
              <th>{t('plColPlayer')}</th>
              <th>{t('plColPhone')}</th>
              <th>{t('plColRole')}</th>
              <th>{t('plColStatus')}</th>
              <th>{t('plColLang')}</th>
              <th>{t('plColCreated')}</th>
              <th>{t('plColLastLogin')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={8} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <Empty icon={<Users className="ic" weight="duotone" />} title={t('plEmpty')} />
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={String(r.id)} data-testid={`pl-row-${r.phone}`}>
                  <td className="primary">
                    <div className="stack" style={{ gap: 0 }}>
                      <span>{r.displayName || <span className="muted">{t('plNoName')}</span>}</span>
                      <span className="small muted">#{digits(String(r.id))}</span>
                    </div>
                  </td>
                  <td className="nowrap">
                    <span className="ltr">{fmtPhone(r.phone)}</span>
                  </td>
                  <td>
                    <RoleBadge role={r.role} />
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <span className="badge">{r.lang}</span>
                  </td>
                  <td className="nowrap">{tsDate(r.createdAt)}</td>
                  <td className="nowrap">{tsDate(r.lastLoginAt)}</td>
                  <td className="end">{action(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="pl-cards">
          {loading && !data
            ? Array.from({ length: 5 }).map((_, i) => (
                <div className="pcard" key={i}>
                  <Skel w="50%" h={12} />
                  <Skel w="80%" h={10} />
                </div>
              ))
            : rows.length === 0
              ? <Empty icon={<Users className="ic" weight="duotone" />} title={t('plEmpty')} />
              : rows.map(r => (
                  <div className="pcard" key={String(r.id)} data-testid={`pl-card-${r.phone}`}>
                    <div className="row">
                      <b className="grow ellipsis">{r.displayName || t('plNoName')}</b>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="pcard-meta">
                      <span>{t('plColPhone')}</span>
                      <span>{fmtPhone(r.phone)}</span>
                      <span>{t('plColRole')}</span>
                      <span>{r.role ? roleLabel(r.role) : '—'}</span>
                      <span>{t('plColLastLogin')}</span>
                      <span>{tsDate(r.lastLoginAt)}</span>
                    </div>
                    {action(r, true) && <div className="row">{action(r, true)}</div>}
                  </div>
                ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

export function Admins() {
  const { can, me } = useSession();
  useLocale();
  const list = useRows('adminAdmins');
  const loaded = list.length > 0;
  const [adding, setAdding] = useState(false);
  const owner = can('owner');
  const rows = [...list].sort((a, b) => (a.createdAt.toDate().getTime() < b.createdAt.toDate().getTime() ? -1 : 1));
  async function changeRole(phone: string, role: string) {
    await runToast(c => c.reducers.adminSetAdmin({ phone, role }), t('adRoleChanged'));
  }
  async function remove(accountId: bigint, phone: string) {
    if (!(await confirmAsk(t('adRemoveConfirm', { phone: fmtPhone(phone) }), { danger: true, ok: t('adRemove') }))) return;
    await runToast(c => c.reducers.adminRemoveAdmin({ accountId }), t('adRemoved'));
  }
  const roleSelect = (r: (typeof rows)[number], card = false) =>
    owner ? (
      <select className="select" style={{ height: 30, width: 'auto', minWidth: 120, fontSize: 13 }} value={r.role} onChange={e => changeRole(r.phone, e.target.value)} aria-label={t('adRole')} data-testid={`${card ? 'ad-crole' : 'ad-role'}-${r.phone}`}>
        <option value="owner">{t('roleOwner')}</option>
        <option value="admin">{t('roleAdmin')}</option>
        <option value="operator">{t('roleOperator')}</option>
      </select>
    ) : (
      <RoleBadge role={r.role} />
    );
  const removeBtn = (r: (typeof rows)[number], card = false) =>
    owner ? (
      <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => remove(r.accountId, r.phone)} data-testid={`${card ? 'ad-cremove' : 'ad-remove'}-${r.phone}`}>
        <Trash className="ic" />
        {t('adRemove')}
      </button>
    ) : null;
  return (
    <main className="page" data-testid="page-admins">
      <div className="page-head">
        <div className="grow">
          <div className="page-title">{t('adTitle')}</div>
          <div className="page-sub">{loaded ? num(rows.length) : <Skel w={40} h={10} />}</div>
        </div>
        {owner && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} data-testid="ad-add">
            <Plus className="ic" />
            {t('adAdd')}
          </button>
        )}
      </div>
      {!owner && <Notice kind="plain" text={t('adReadOnly')} icon={<ShieldCheck className="ic" />} />}
      <div className="table-wrap responsive">
        <table className="table" data-testid="ad-table">
          <thead>
            <tr>
              <th>{t('plColPlayer')}</th>
              <th>{t('plColPhone')}</th>
              <th>{t('adRole')}</th>
              <th>{t('plColCreated')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {!loaded ? (
              <TableSkeleton cols={5} rows={3} />
            ) : (
              rows.map(r => (
                <tr key={String(r.accountId)} data-testid={`ad-row-${r.phone}`}>
                  <td className="primary">
                    <span className="row">
                      {r.displayName || <span className="muted">{t('plNoName')}</span>}
                      {r.accountId === me?.id && <span className="badge b-info">{t('adYou')}</span>}
                    </span>
                  </td>
                  <td className="nowrap">
                    <span className="ltr">{fmtPhone(r.phone)}</span>
                  </td>
                  <td>{roleSelect(r)}</td>
                  <td className="nowrap">{tsDate(r.createdAt)}</td>
                  <td className="end">{removeBtn(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards">
          {rows.map(r => (
            <div className="pcard" key={String(r.accountId)}>
              <div className="row">
                <b className="grow ellipsis">{r.displayName || t('plNoName')}</b>
                {r.accountId === me?.id && <span className="badge b-info">{t('adYou')}</span>}
              </div>
              <div className="pcard-meta">
                <span>{t('plColPhone')}</span>
                <span>{fmtPhone(r.phone)}</span>
                <span>{t('plColCreated')}</span>
                <span>{tsDate(r.createdAt)}</span>
              </div>
              <div className="row">
                {roleSelect(r, true)}
                <span className="grow" />
                {removeBtn(r, true)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {adding && <AddAdminDialog onClose={() => setAdding(false)} />}
    </main>
  );
}

const WORDS: Record<string, () => string> = {
  owner: () => t('roleOwner'),
  admin: () => t('roleAdmin'),
  operator: () => t('roleOperator'),
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
