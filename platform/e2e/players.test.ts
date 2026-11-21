import { PLAYER_QUERIES, check, connect, done, errorOf, login, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const OWNER = '09120000001';
const c = (token?: string) => connect(token, PLAYER_QUERIES);
const rows = <T>(it: Iterable<T>) => [...it];

async function main() {
  const owner = await c();
  await login(owner, OWNER);
  const a = await c();
  const aPhone = uniquePhone('0936');
  const aLogin = await login(a, aPhone);
  const b = await c();
  const bPhone = uniquePhone('0937');
  const bLogin = await login(b, bPhone);
  const db = owner.conn.db;

  check('countries are seeded', rows(a.conn.db.country.iter()).length === 243 && a.conn.db.country.code.find('IR')?.sort === 1);
  check('report titles are seeded', rows(a.conn.db.reportTitle.iter()).some(t => t.key === 'abuse'));
  check('account rules are public', rows(a.conn.db.accountRules.iter())[0]?.displayNameMax === 40);

  await owner.conn.reducers.adminSaveAccountRules({ displayNameMin: 3, displayNameMax: 12, displayNameCharset: 'persian', displayNameUnique: true });
  check('rules reach players live', await waitFor(() => rows(a.conn.db.accountRules.iter())[0]?.displayNameMin === 3));
  check('short name refused', (await errorOf(a.conn.reducers.updateProfile({ displayName: 'ab', lang: 'fa' }))).includes('DISPLAY_NAME_TOO_SHORT'));
  check('latin name refused under persian charset', (await errorOf(a.conn.reducers.updateProfile({ displayName: 'Alice', lang: 'fa' }))).includes('DISPLAY_NAME_INVALID_CHARACTERS'));
  const uniqueName = `علی ${String(Date.now()).slice(-4).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])}`;
  await a.conn.reducers.updateProfile({ displayName: uniqueName, lang: 'fa' });
  check('valid persian name saved', await waitFor(() => rows(a.conn.db.me.iter())[0]?.displayName === uniqueName));
  check('same name with other spacing is taken', (await errorOf(b.conn.reducers.updateProfile({ displayName: uniqueName.replace(' ', '  '), lang: 'fa' }))).includes('DISPLAY_NAME_TAKEN'));
  check('bad rule refused', (await errorOf(owner.conn.reducers.adminSaveAccountRules({ displayNameMin: 20, displayNameMax: 10, displayNameCharset: 'any', displayNameUnique: false }))).includes('INVALID_RULE'));
  await owner.conn.reducers.adminSaveAccountRules({ displayNameMin: 0, displayNameMax: 40, displayNameCharset: 'any', displayNameUnique: false });

  await owner.conn.reducers.adminSaveAppVersion({
    platform: 'android',
    latestVersion: '2.0.0',
    minVersion: '1.5',
    storeLinks: [
      { store: 'google_play', url: 'https://play.google.com/store/apps/details?id=x', label: [] },
      { store: 'bazaar', url: 'bazaar://details?id=x', label: tr('بازار ما') },
    ],
    updateMessage: tr('نسخهٔ تازه آمده', 'New version'),
    forceMessage: tr('باید به‌روز کنید', 'Update required'),
    isActive: true,
  });
  check('app version is public', await waitFor(() => a.conn.db.appVersion.platform.find('android')?.latestVersion === '2.0.0'));
  const v1 = await a.conn.procedures.checkAppVersion({ platform: 'android', version: '1.4.9', store: 'bazaar', lang: 'fa' });
  check('old version must update', v1.status === 'update_required' && v1.message === 'باید به‌روز کنید' && v1.storeUrl.startsWith('bazaar://'), v1);
  check('store label and built-in names', v1.stores[0].name === 'گوگل‌پلی' && v1.stores[1].name === 'بازار ما', v1.stores);
  const v2 = await a.conn.procedures.checkAppVersion({ platform: 'android', version: 'v1.9.9', store: '', lang: 'en' });
  check('newer exists', v2.status === 'update_available' && v2.message === 'New version' && v2.storeUrl.startsWith('https://'), v2);
  check('latest is ok', (await a.conn.procedures.checkAppVersion({ platform: 'android', version: '2.0.0+77', store: '', lang: 'fa' })).status === 'ok');
  check('pre-release is older', (await a.conn.procedures.checkAppVersion({ platform: 'android', version: '2.0.0-beta', store: '', lang: 'fa' })).status === 'update_available');
  check('no row means ok', (await a.conn.procedures.checkAppVersion({ platform: 'ios', version: '0.1', store: '', lang: 'fa' })).status === 'ok');
  check('bad version refused', (await errorOf(a.conn.procedures.checkAppVersion({ platform: 'android', version: '1.x', store: '', lang: 'fa' }))).includes('INVALID_VERSION'));
  check('min above latest refused', (await errorOf(owner.conn.reducers.adminSaveAppVersion({ platform: 'android', latestVersion: '1.0', minVersion: '1.1', storeLinks: [], updateMessage: [], forceMessage: [], isActive: true }))).includes('MIN_ABOVE_LATEST'));
  check('bad store url refused', (await errorOf(owner.conn.reducers.adminSaveAppVersion({ platform: 'android', latestVersion: '1.0', minVersion: '', storeLinks: [{ store: 'web', url: 'javascript:alert(1)', label: [] }], updateMessage: [], forceMessage: [], isActive: true }))).includes('INVALID_URL'));
  await owner.conn.reducers.adminDeleteAppVersion({ platform: 'android' });

  await a.conn.reducers.setMyCountry({ code: 'ir' });
  check('player country saved', await waitFor(() => rows(a.conn.db.myProfile.iter())[0]?.countryCode === 'IR'));
  await owner.conn.reducers.adminSetCountryActive({ code: 'AD', isActive: false });
  check('inactive country refused', (await errorOf(a.conn.reducers.setMyCountry({ code: 'AD' }))).includes('COUNTRY_NOT_AVAILABLE'));
  await owner.conn.reducers.adminSetCountryActive({ code: 'AD', isActive: true });
  check('bad dial code refused', (await errorOf(owner.conn.reducers.adminSaveCountry({ code: 'ZZ', name: tr('زد'), dialCode: '98', flagUrl: '', isActive: true, sort: 100 }))).includes('INVALID_DIAL_CODE'));

  const k1 = `pub${Date.now() % 100000}`;
  const k2 = `hid${Date.now() % 100000}`;
  await owner.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key: k1, title: tr('قهرمان'), color: '#00aa00', sort: 0, isActive: true });
  await owner.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key: k2, title: tr('مشکوک'), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(db.tag.iter()).filter(t => t.key === k1 || t.key === k2).length === 2);
  const t1 = rows(db.tag.iter()).find(t => t.key === k1)!;
  const t2 = rows(db.tag.iter()).find(t => t.key === k2)!;
  await owner.conn.reducers.adminSetTagVisibility({ tagId: t1.id, isPublic: true });
  await owner.conn.reducers.adminSetPlayerTags({ accountId: aLogin.accountId, tagIds: [t1.id, t2.id] });
  check('player sees only public tags', await waitFor(() => rows(a.conn.db.myTags.iter()).length === 1 && rows(a.conn.db.myTags.iter())[0].key === k1));
  const general = rows(db.tag.iter()).find(t => t.keyType === 'general');
  if (general) check('non-player tag refused', (await errorOf(owner.conn.reducers.adminSetPlayerTags({ accountId: aLogin.accountId, tagIds: [general.id] }))).includes('TAG_KIND_MISMATCH'));
  await owner.conn.reducers.adminBulkPlayerTags({ accountIds: [aLogin.accountId, bLogin.accountId], tagIds: [t2.id], op: 'add' });
  const byTag = await owner.conn.procedures.adminPlayers({ query: '', tagId: t2.id, status: '', page: 1, pageSize: 50 });
  check('tag filter finds both', byTag.total === 2 && byTag.rows.every(r => r.tags.some(x => x.id === t2.id)), byTag.total);
  await owner.conn.reducers.adminBulkPlayerTags({ accountIds: [aLogin.accountId, bLogin.accountId], tagIds: [t2.id], op: 'remove' });
  check('bulk remove', (await owner.conn.procedures.adminPlayers({ query: '', tagId: t2.id, status: '', page: 1, pageSize: 50 })).total === 0);

  await owner.conn.reducers.adminRestrict({ accountId: aLogin.accountId, kind: 'mute', minutes: 60, endsAt: 0n, reason: tr('بی‌احترامی در چت', 'Rude chat'), note: 'internal' });
  check('player sees the mute', await waitFor(() => rows(a.conn.db.myStatus.iter())[0]?.mute?.reason === 'بی‌احترامی در چت'));
  check('muted filter', (await owner.conn.procedures.adminPlayers({ query: aPhone, tagId: 0n, status: 'muted', page: 1, pageSize: 10 })).total === 1);
  check('restriction needs an end', (await errorOf(owner.conn.reducers.adminRestrict({ accountId: aLogin.accountId, kind: 'suspend', minutes: 0, endsAt: 0n, reason: tr('x'), note: '' }))).includes('END_REQUIRED'));
  check('restriction needs a reason', (await errorOf(owner.conn.reducers.adminRestrict({ accountId: aLogin.accountId, kind: 'suspend', minutes: 5, endsAt: 0n, reason: [], note: '' }))).includes('TITLE_REQUIRED'));
  check('owner cannot be restricted', (await errorOf(owner.conn.reducers.adminRestrict({ accountId: aLogin.accountId === 0n ? 1n : (await owner.conn.procedures.adminAccounts({ query: OWNER, status: '', page: 1, pageSize: 1 })).rows[0].id, kind: 'mute', minutes: 5, endsAt: 0n, reason: tr('x'), note: '' }))).includes('CANNOT_CHANGE_SELF'));

  await owner.conn.reducers.adminRestrict({ accountId: aLogin.accountId, kind: 'suspend', minutes: 30, endsAt: 0n, reason: tr('تقلب', 'Cheating'), note: '' });
  check('suspension logs the player out live', await waitFor(() => rows(a.conn.db.me.iter()).length === 0));
  check('suspended player cannot ask for a code', (await errorOf(a.conn.procedures.requestOtp({ phone: aPhone }))).includes('ACCOUNT_SUSPENDED'));
  const detail = await owner.conn.procedures.adminPlayer({ accountId: aLogin.accountId });
  check('player detail shows both', !!detail.player.suspension && !!detail.player.mute && detail.history.length >= 2, detail.player);
  await owner.conn.reducers.adminLiftRestriction({ id: detail.player.suspension!.id, note: 'mistake' });
  await login(a, aPhone);
  check('lifted player logs in again', rows(a.conn.db.me.iter()).length === 1);
  check('lift twice refused', (await errorOf(owner.conn.reducers.adminLiftRestriction({ id: detail.player.suspension!.id, note: '' }))).includes('NOT_ACTIVE'));

  const soon = BigInt(Date.now() + 2500) * 1000n;
  await owner.conn.reducers.adminRestrict({ accountId: bLogin.accountId, kind: 'suspend', minutes: 0, endsAt: soon, reason: tr('کوتاه'), note: '' });
  check('short suspension blocks', (await errorOf(b.conn.procedures.requestOtp({ phone: bPhone }))).includes('ACCOUNT_SUSPENDED'));
  await new Promise(r => setTimeout(r, 3500));
  const bAgain = await c();
  await login(bAgain, bPhone);
  check('suspension ends exactly on time', rows(bAgain.conn.db.me.iter()).length === 1);
  const expiredList = await owner.conn.procedures.adminRestrictions({ query: bPhone, kind: 'suspend', status: 'expired', accountId: 0n, page: 1, pageSize: 10 });
  check('ended suspension listed as expired', expiredList.total === 1, expiredList);

  await owner.conn.reducers.adminRestrict({ accountId: aLogin.accountId, kind: 'warn', minutes: 0, endsAt: 0n, reason: tr('اخطار اول'), note: '' });
  check('warning shows to the player', await waitFor(() => rows(a.conn.db.myStatus.iter())[0]?.warnings.some(w => w.reason === 'اخطار اول')));

  const r1 = await bAgain.conn.procedures.reportPlayer({ targetId: aLogin.accountId, titleKey: 'abuse', note: 'فحش داد', matchId: 'm-1', contentId: '', gameKey: 'chess' });
  check('report created', r1.reportId > 0n && !r1.duplicate);
  const r1b = await bAgain.conn.procedures.reportPlayer({ targetId: aLogin.accountId, titleKey: 'abuse', note: 'باز هم', matchId: '', contentId: '', gameKey: '' });
  check('repeat within the window is a duplicate', r1b.duplicate && r1b.reportId === r1.reportId);
  check('self report refused', (await errorOf(bAgain.conn.procedures.reportPlayer({ targetId: bLogin.accountId, titleKey: 'abuse', note: '', matchId: '', contentId: '', gameKey: '' }))).includes('CANNOT_REPORT_SELF'));
  check('unknown reason refused', (await errorOf(bAgain.conn.procedures.reportPlayer({ targetId: aLogin.accountId, titleKey: 'nope', note: '', matchId: '', contentId: '', gameKey: '' }))).includes('REPORT_TITLE_NOT_FOUND'));

  await owner.conn.reducers.adminSaveReportRules({ perHour: 2, duplicateHours: 24, minAccountHours: 0, noteRequired: true, trustedTagIds: [], trustedPerHour: 30 });
  check('note required', (await errorOf(bAgain.conn.procedures.reportPlayer({ targetId: aLogin.accountId, titleKey: 'spam', note: '', matchId: '', contentId: '', gameKey: '' }))).includes('NOTE_REQUIRED'));
  const r2 = await bAgain.conn.procedures.reportPlayer({ targetId: aLogin.accountId, titleKey: 'spam', note: 'تبلیغ', matchId: '', contentId: '', gameKey: '' });
  check('hourly limit', (await errorOf(bAgain.conn.procedures.reportPlayer({ targetId: aLogin.accountId, titleKey: 'cheating', note: 'x', matchId: '', contentId: '', gameKey: '' }))).includes('TOO_MANY_REPORTS'));
  const mine = await bAgain.conn.procedures.myReports({ page: 1, pageSize: 10 });
  check('my reports with limits', mine.total >= 2 && mine.remaining === 0 && mine.noteRequired && mine.rows[0].title === 'هرزنامه', mine);
  await owner.conn.reducers.adminSaveReportRules({ perHour: 10, duplicateHours: 24, minAccountHours: 0, noteRequired: false, trustedTagIds: [], trustedPerHour: 30 });

  const list = await owner.conn.procedures.adminReports({ query: '', status: 'active', titleId: 0n, targetId: aLogin.accountId, reporterId: 0n, gameKey: '', page: 1, pageSize: 20 });
  check('admin sees active reports', list.total >= 2 && list.rows.every(r => r.targetPhone === aPhone), list.total);
  await owner.conn.reducers.adminReportStatus({ id: r1.reportId, status: 'reviewing' });
  await owner.conn.reducers.adminReportNote({ id: r1.reportId, text: 'بررسی شد' });
  const rd = await owner.conn.procedures.adminReport({ id: r1.reportId });
  check('report detail', rd.row.report.status === 'reviewing' && rd.row.report.notes.length === 1 && rd.others.some(o => o.id === r2.reportId) && rd.warns >= 1, rd.row.report);
  await owner.conn.reducers.adminResolveReport({ id: r1.reportId, action: 'mute', minutes: 120, endsAt: 0n, reason: tr('گزارش تأیید شد'), note: 'ok', closeOthers: true });
  const after = await owner.conn.procedures.adminReports({ query: '', status: 'active', titleId: 0n, targetId: aLogin.accountId, reporterId: 0n, gameKey: '', page: 1, pageSize: 20 });
  check('close others closes every active report', after.total === 0, after.total);
  check('resolution mutes the player', await waitFor(() => rows(a.conn.db.myStatus.iter())[0]?.mute?.reason === 'گزارش تأیید شد'));
  check('closed report cannot be resolved again', (await errorOf(owner.conn.reducers.adminResolveReport({ id: r1.reportId, action: 'dismiss', minutes: 0, endsAt: 0n, reason: [], note: '', closeOthers: false }))).includes('REPORT_CLOSED'));
  const mine2 = await bAgain.conn.procedures.myReports({ page: 1, pageSize: 10 });
  check('reporter sees resolved, never the action', mine2.rows.find(r => r.id === r1.reportId)?.status === 'resolved');

  const tk = `t${Date.now() % 100000}`;
  await owner.conn.reducers.adminSaveReportTitle({ id: 0n, key: tk, name: tr('عنوان تست'), description: [], isActive: true, sort: 9 });
  check('report title add', await waitFor(() => rows(a.conn.db.reportTitle.iter()).some(t => t.key === tk)));
  const abuse = rows(db.reportTitle.iter()).find(t => t.key === 'abuse')!;
  check('used title cannot be deleted', (await errorOf(owner.conn.reducers.adminDeleteReportTitle({ id: abuse.id }))).includes('IN_USE'));
  await owner.conn.reducers.adminDeleteReportTitle({ id: rows(db.reportTitle.iter()).find(t => t.key === tk)!.id });

  const sum = await owner.conn.procedures.adminModerationSummary();
  check('moderation summary', sum.muted >= 1, sum);

  const op = await c();
  const opPhone = uniquePhone('0912');
  await owner.conn.reducers.adminSetAdmin({ phone: opPhone, role: 'operator' });
  await login(op, opPhone);
  check('operator can moderate', (await errorOf(op.conn.reducers.adminRestrict({ accountId: bLogin.accountId, kind: 'warn', minutes: 0, endsAt: 0n, reason: tr('از اپراتور'), note: '' }))) === '');
  check('operator cannot change account rules', (await errorOf(op.conn.reducers.adminSaveAccountRules({ displayNameMin: 0, displayNameMax: 40, displayNameCharset: 'any', displayNameUnique: false }))).includes('FORBIDDEN'));
  const opRow = rows(owner.conn.db.adminAdmins.iter()).find(x => x.phone === opPhone)!;
  check('operator cannot restrict another admin', (await errorOf(op.conn.reducers.adminRestrict({ accountId: (await owner.conn.procedures.adminAccounts({ query: OWNER, status: '', page: 1, pageSize: 1 })).rows[0].id, kind: 'warn', minutes: 0, endsAt: 0n, reason: tr('x'), note: '' }))).match(/FORBIDDEN|CANNOT_RESTRICT_OWNER/) !== null);
  await owner.conn.reducers.adminRemoveAdmin({ accountId: opRow.accountId });

  const mute = (await owner.conn.procedures.adminPlayer({ accountId: aLogin.accountId })).player.mute;
  if (mute) await owner.conn.reducers.adminLiftRestriction({ id: mute.id, note: 'test cleanup' });
  done('players');
}

main().catch(e => {
  console.error('ERROR', e);
  process.exit(1);
});
