import { ECONOMY_QUERIES, PLAYER_QUERIES, DB, check, connect, done, loginOwner, panelUser, errorOf, login, tr, uniquePhone, waitFor, type Client } from './src/lib.ts';

const BASE = process.env.STG_HTTP ?? 'http://127.0.0.1:7500';
const PW = process.env.PLAYWRIGHT_CORE ?? new URL('../node_modules/playwright-core/index.mjs', import.meta.url).pathname;
const c = (token?: string) => connect(token, [...PLAYER_QUERIES, ...ECONOMY_QUERIES]);
const rows = <T>(it: Iterable<T>) => [...it];

function bal(cl: Client, key: string) {
  return rows(cl.conn.db.myWallet.iter()).find(w => w.currencyKey === key)?.balance ?? -1n;
}
function meta(cl: Client, key: string) {
  return rows(cl.conn.db.myMetas.iter()).find(m => m.metaKey === key)?.value;
}

async function upsertCurrency(o: Client, key: string, type: string, def: bigint) {
  const old = rows(o.conn.db.currency.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSaveCurrency({ id: old?.id ?? 0n, key, name: tr(key), type, defaultValue: def, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.currency.iter()).some(x => x.key === key));
}
async function upsertMeta(o: Client, key: string, def: number, serverOnly: boolean) {
  const old = rows(o.conn.db.meta.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSaveMeta({ id: old?.id ?? 0n, key, name: tr(key), defaultValue: def, serverOnly });
  await waitFor(() => rows(o.conn.db.meta.iter()).some(x => x.key === key));
}
async function upsertPrize(o: Client, key: string, items: { type: string; key: string; action: string; value: number }[], isRepeatable = true) {
  const old = rows(o.conn.db.prize.iter()).find(x => x.key === key);
  await o.conn.reducers.adminSavePrize({ id: old?.id ?? 0n, key, name: tr(key), message: [], categoryId: 0n, tagIds: [], isRepeatable, items });
  await waitFor(() => rows(o.conn.db.prize.iter()).some(x => x.key === key));
  return rows(o.conn.db.prize.iter()).find(x => x.key === key)!.id;
}
async function upsertProduct(o: Client, key: string, prizeId: bigint, p: Partial<{ priceToman: bigint; coinCurrency: string; coinAmount: bigint; paymentMethods: string[]; skuBazaar: string; audienceTagIds: bigint[]; discountPercent: number }>) {
  const list = await o.conn.procedures.adminProducts({ query: key, categoryId: 0n, isActive: '', page: 1, pageSize: 50 });
  const old = list.rows.find(r => r.key === key);
  await o.conn.reducers.adminSaveProduct({
    id: old?.id ?? 0n,
    key,
    name: tr(key),
    description: [],
    isActive: true,
    categoryId: 0n,
    tagIds: [],
    audienceTagIds: p.audienceTagIds ?? [],
    priceToman: p.priceToman ?? 0n,
    coinCurrency: p.coinCurrency ?? '',
    coinAmount: p.coinAmount ?? 0n,
    discountPercent: p.discountPercent ?? 0,
    paymentMethods: p.paymentMethods ?? ['in_app'],
    skuBazaar: p.skuBazaar ?? '',
    skuMyket: '',
    prizeId,
    iconUrl: '',
    coverUrl: '',
    sort: 0,
  });
  const after = await o.conn.procedures.adminProducts({ query: key, categoryId: 0n, isActive: '', page: 1, pageSize: 50 });
  return after.rows.find(r => r.key === key)!.id;
}

async function payInBrowser(url: string, button: 'پرداخت' | 'انصراف') {
  const { chromium } = await import(PW);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: button }).first().click({ timeout: 20000 });
    await page.waitForURL(/example\.com/, { timeout: 30000 });
    return page.url();
  } finally {
    await browser.close();
  }
}

async function main() {
  const o = await c();
  const ownerLogin = await loginOwner(o);

  await upsertCurrency(o, 'coin', 'soft', 100n);
  await upsertCurrency(o, 'gem', 'hard', 0n);
  await upsertMeta(o, 'xp', 0, false);
  await upsertMeta(o, 'cheat_score', 0, true);
  check('bad currency key refused', (await errorOf(o.conn.reducers.adminSaveCurrency({ id: 0n, key: 'Bad Key', name: tr('x'), type: 'soft', defaultValue: 0n, iconUrl: '', categoryId: 0n, tagIds: [], sort: 0, isActive: true }))).includes('INVALID_KEY'));

  const pSmall = await upsertPrize(o, 'p_small', [{ type: 'currency', key: 'coin', action: 'add', value: 50 }, { type: 'meta', key: 'xp', action: 'add', value: 10 }]);
  const pGem = await upsertPrize(o, 'p_gem', [{ type: 'currency', key: 'gem', action: 'add', value: 5 }]);
  const pOnce = await upsertPrize(o, 'p_once', [{ type: 'currency', key: 'gem', action: 'add', value: 1 }], false);
  check('prize with unknown currency refused', (await errorOf(o.conn.reducers.adminSavePrize({ id: 0n, key: 'p_bad', name: tr('x'), message: [], categoryId: 0n, tagIds: [], isRepeatable: true, items: [{ type: 'currency', key: 'nope', action: 'add', value: 1 }] }))).includes('CURRENCY_NOT_FOUND'));
  const g = rows(o.conn.db.prizeGroup.iter()).find(x => x.key === 'g_box');
  await o.conn.reducers.adminSavePrizeGroup({ id: g?.id ?? 0n, key: 'g_box', name: tr('جعبه'), entries: [{ prizeId: pSmall, weight: 1 }, { prizeId: pGem, weight: 1 }], isActive: true });
  await waitFor(() => rows(o.conn.db.prizeGroup.iter()).some(x => x.key === 'g_box'));
  const pBox = await upsertPrize(o, 'p_box', [{ type: 'prize_group', key: 'g_box', action: 'give', value: 1 }]);

  await o.conn.reducers.adminSavePaymentMethod({ method: 'in_app', isActive: true, config: '{}' });
  check('zarinpal live needs a merchant', (await errorOf(o.conn.reducers.adminSavePaymentMethod({ method: 'zarinpal', isActive: true, config: JSON.stringify({ merchantId: '', sandbox: false }) }))).includes('PAYMENT_METHOD_NOT_CONFIGURED'));
  await o.conn.reducers.adminSavePaymentMethod({ method: 'zarinpal', isActive: true, config: JSON.stringify({ merchantId: 'secret-merchant-0000000000000000000', sandbox: true }) });
  await o.conn.reducers.adminSavePaymentMethod({ method: 'bazaar', isActive: true, config: JSON.stringify({ packageName: 'ir.example.game', apiSecret: 'very-secret-api', rsaPublicKey: '', sandbox: true }) });
  check('method secrets are masked', await waitFor(() => {
    const z = rows(o.conn.db.adminPaymentMethods.iter()).find(m => m.method === 'zarinpal');
    return !!z && z.isActive && z.configured && JSON.parse(z.config).merchantId === '********';
  }));
  check('no view carries a secret', !rows(o.conn.db.adminPaymentMethods.iter()).some(m => m.config.includes('very-secret') || m.config.includes('secret-merchant')));
  await o.conn.reducers.adminSavePaymentMethod({ method: 'zarinpal', isActive: true, config: JSON.stringify({ merchantId: '********', sandbox: true }) });
  await o.conn.reducers.adminSaveEconomySettings({ publicBaseUrl: BASE, redirectUrl: 'https://example.com/pay?ok={success}&p={paymentId}', pendingTtlMinutes: 45 });

  const prodCoins = await upsertProduct(o, 'gems_for_coins', pGem, { coinCurrency: 'coin', coinAmount: 30n, paymentMethods: ['in_app'] });
  const prodZarin = await upsertProduct(o, 'starter_pack', pSmall, { priceToman: 1000n, paymentMethods: ['zarinpal'] });
  const prodFree = await upsertProduct(o, 'free_pack', pSmall, { priceToman: 0n, paymentMethods: ['zarinpal'] });
  const prodBazaar = await upsertProduct(o, 'gems_10', pGem, { priceToman: 5000n, paymentMethods: ['bazaar'], skuBazaar: 'gems_10' });
  check('bazaar product without sku refused', (await errorOf(upsertProduct(o, 'bad_bazaar', pGem, { priceToman: 5000n, paymentMethods: ['bazaar'] }))).includes('SKU_REQUIRED'));
  const vipKey = `vip_${Date.now() % 100000}`;
  await o.conn.reducers.adminSaveTag({ id: 0n, keyType: 'user', key: vipKey, title: tr('ویژه'), color: '', sort: 0, isActive: true });
  await waitFor(() => rows(o.conn.db.tag.iter()).some(x => x.key === vipKey));
  const vipTag = rows(o.conn.db.tag.iter()).find(x => x.key === vipKey)!;
  const prodVip = await upsertProduct(o, 'vip_pack', pGem, { coinCurrency: 'coin', coinAmount: 1n, paymentMethods: ['in_app'], audienceTagIds: [vipTag.id] });

  const p = await c();
  const phone = uniquePhone('0938');
  const pl = await login(p, phone);
  check('default balance arrives at login', await waitFor(() => bal(p, 'coin') === 100n && bal(p, 'gem') === 0n));
  check('server-only metas stay hidden', meta(p, 'xp') === 0 && meta(p, 'cheat_score') === undefined);
  check('shop lists products for the player', await waitFor(() => rows(p.conn.db.shop.iter()).some(x => x.id === prodCoins) && rows(p.conn.db.shop.iter()).some(x => x.id === prodZarin)));
  check('audience product hidden', !rows(p.conn.db.shop.iter()).some(x => x.id === prodVip));
  check('hidden product cannot be bought', (await errorOf(p.conn.procedures.purchaseStart({ productId: prodVip, method: 'in_app', giftCode: '' }))).includes('PRODUCT_NOT_FOUND'));

  const r1 = await p.conn.procedures.purchaseStart({ productId: prodCoins, method: 'in_app', giftCode: '' });
  check('coin purchase settles at once', r1.status === 'success' && JSON.parse(r1.rewards)[0]?.key === 'gem', r1);
  check('coins debited and gems granted', await waitFor(() => bal(p, 'coin') === 70n && bal(p, 'gem') === 5n));
  await o.conn.reducers.adminAdjust({ accountId: pl.accountId, kind: 'currency', key: 'coin', action: 'set', value: 10, note: 'test' });
  check('admin set balance', await waitFor(() => bal(p, 'coin') === 10n));
  check('not enough coins', (await errorOf(p.conn.procedures.purchaseStart({ productId: prodCoins, method: 'in_app', giftCode: '' }))).includes('INSUFFICIENT_BALANCE'));
  check('failed coin purchase left no trace', bal(p, 'coin') === 10n && bal(p, 'gem') === 5n);

  const rf = await p.conn.procedures.purchaseStart({ productId: prodFree, method: 'zarinpal', giftCode: '' });
  check('free product settles without a gateway', rf.status === 'success' && (await waitFor(() => bal(p, 'coin') === 60n && meta(p, 'xp') === 10)));

  const code = `GIFT${Date.now() % 1000000}`;
  await o.conn.reducers.adminSaveGift({ id: 0n, name: tr('هدیهٔ تست'), type: 'reward', code, prizeId: pGem, discountPercent: 0, perUserLimit: 1, maxTotalUses: 0, validFrom: 0n, expireAt: 0n, isActive: true, categoryId: 0n, tagIds: [] });
  const red = await p.conn.procedures.redeemGift({ code: code.toLowerCase() });
  check('gift code redeems', red.rewards.length === 1 && (await waitFor(() => bal(p, 'gem') === 10n)), red);
  check('gift code once per player', (await errorOf(p.conn.procedures.redeemGift({ code }))).includes('GIFT_ALREADY_USED'));
  check('unknown gift code', (await errorOf(p.conn.procedures.redeemGift({ code: 'NOPE-123' }))).includes('GIFT_NOT_FOUND'));
  const expired = `OLD${Date.now() % 1000000}`;
  await o.conn.reducers.adminSaveGift({ id: 0n, name: tr('قدیمی'), type: 'reward', code: expired, prizeId: pGem, discountPercent: 0, perUserLimit: 1, maxTotalUses: 0, validFrom: 1n, expireAt: 2n, isActive: true, categoryId: 0n, tagIds: [] });
  check('expired gift code', (await errorOf(p.conn.procedures.redeemGift({ code: expired }))).includes('GIFT_EXPIRED'));

  await o.conn.procedures.adminGrantPrize({ accountId: pl.accountId, prizeId: pOnce, note: '' });
  check('one-time prize cannot repeat', (await errorOf(o.conn.procedures.adminGrantPrize({ accountId: pl.accountId, prizeId: pOnce, note: '' }))).includes('PRIZE_ALREADY_GRANTED'));
  const box = await o.conn.procedures.adminGrantPrize({ accountId: pl.accountId, prizeId: pBox, note: '' });
  check('prize group picks one prize', box.length >= 1 && ['p_small', 'p_gem'].includes(box[0].prizeKey), box);

  const s1 = await p.conn.procedures.purchaseStart({ productId: prodBazaar, method: 'bazaar', giftCode: '' });
  check('store purchase returns sku and payload', s1.status === 'store' && s1.sku === 'gems_10' && s1.developerPayload === String(s1.paymentId), s1);
  const gemsBefore = bal(p, 'gem');
  const sub = await p.conn.procedures.purchaseSubmit({ paymentId: s1.paymentId, token: `sandbox-${s1.paymentId}-abc` });
  check('sandbox store token settles', sub.status === 'success' && sub.rewardGranted && (await waitFor(() => bal(p, 'gem') === gemsBefore + 5n)), sub);
  const s2 = await p.conn.procedures.purchaseStart({ productId: prodBazaar, method: 'bazaar', giftCode: '' });
  check('token reuse refused', (await errorOf(p.conn.procedures.purchaseSubmit({ paymentId: s2.paymentId, token: `sandbox-${s1.paymentId}-abc` }))).includes('TOKEN_ALREADY_USED'));
  const bad = await p.conn.procedures.purchaseSubmit({ paymentId: s2.paymentId, token: `forged-${Date.now()}` });
  check('bad store token fails the payment', bad.status === 'failed' && bad.error === 'PURCHASE_INVALID', bad);

  const disc = `HALF${Date.now() % 1000000}`;
  await o.conn.reducers.adminSaveGift({ id: 0n, name: tr('نصف قیمت'), type: 'discount', code: disc, prizeId: 0n, discountPercent: 50, perUserLimit: 1, maxTotalUses: 0, validFrom: 0n, expireAt: 0n, isActive: true, categoryId: 0n, tagIds: [] });
  const z1 = await p.conn.procedures.purchaseStart({ productId: prodZarin, method: 'zarinpal', giftCode: disc });
  check('zarinpal sandbox gives a pay url', z1.status === 'redirect' && z1.redirectUrl.startsWith('https://sandbox.zarinpal.com/pg/StartPay/'), z1);
  const pending = await p.conn.procedures.purchaseStatus({ paymentId: z1.paymentId });
  check('payment waits as pending', pending.status === 'pending');
  const d1 = await o.conn.procedures.adminPayment({ id: z1.paymentId });
  check('discount applied to the gateway amount', d1.row.payment.finalToman === 500n && d1.row.payment.amountRial === 5000n, d1.row.payment);
  check('request log hides the merchant', d1.logs.length === 1 && !d1.logs[0].request.includes('secret-merchant'), d1.logs[0]?.request);
  check('discount code is reserved meanwhile', (await errorOf(p.conn.procedures.purchaseStart({ productId: prodZarin, method: 'zarinpal', giftCode: disc }))).includes('GIFT_ALREADY_USED'));

  const forged = await fetch(`${BASE}/v1/database/${DB}/route/economy/callback?t=${z1.paymentId}.99999999999.deadbeef&Authority=x&Status=OK`, { redirect: 'manual' });
  check('forged ticket refused', forged.status === 400);

  const xpBefore = meta(p, 'xp')!;
  const landed = await payInBrowser(z1.redirectUrl, 'پرداخت');
  check('browser returns to the game with success', landed.includes('ok=true') && landed.includes(`p=${z1.paymentId}`), landed);
  const st1 = await p.conn.procedures.purchaseStatus({ paymentId: z1.paymentId });
  check('zarinpal payment verified and granted', st1.status === 'success' && st1.rewardGranted && (await waitFor(() => meta(p, 'xp') === xpBefore + 10)), st1);
  const d2 = await o.conn.procedures.adminPayment({ id: z1.paymentId });
  check('payment has ref id, card and logs', d2.row.payment.refId !== '' && d2.logs.map(l => l.action).join(',') === 'request,callback,verify', d2.logs.map(l => l.action));
  const replay = await fetch(d2.logs[1] ? `${BASE}/v1/database/${DB}/route/economy/callback?${new URLSearchParams({ t: 'x' })}` : '', { redirect: 'manual' });
  check('callback without a valid ticket changes nothing', replay.status === 400 && (await p.conn.procedures.purchaseStatus({ paymentId: z1.paymentId })).status === 'success');

  const z2 = await p.conn.procedures.purchaseStart({ productId: prodZarin, method: 'zarinpal', giftCode: '' });
  const landed2 = await payInBrowser(z2.redirectUrl, 'انصراف');
  check('cancel returns with failure', landed2.includes('ok=false'), landed2);
  const st2 = await p.conn.procedures.purchaseStatus({ paymentId: z2.paymentId });
  check('cancelled payment failed', st2.status === 'failed' && st2.error === 'CANCELLED', st2);

  await o.conn.reducers.adminSetPlayerTags({ accountId: pl.accountId, tagIds: [vipTag.id] });
  check('audience product shows after tagging', await waitFor(() => rows(p.conn.db.shop.iter()).some(x => x.id === prodVip && x.exclusive)));

  const mine = await p.conn.procedures.myPayments({ page: 1, pageSize: 50 });
  check('player payment history hides authority', mine.total >= 5 && mine.rows.every(r => r.payment.authority === ''), mine.total);
  const list = await o.conn.procedures.adminPayments({ query: phone, status: 'success', method: '', accountId: 0n, page: 1, pageSize: 50 });
  check('admin payment search', list.total >= 4 && list.rows.every(r => r.phone === phone && r.payment.status === 'success'), list.total);
  const ue = await o.conn.procedures.adminUserEconomy({ accountId: pl.accountId });
  check('admin sees wallet, metas, prizes and ledger', ue.wallet.some(w => w.currencyKey === 'gem') && ue.metas.some(m => m.metaKey === 'cheat_score') && ue.prizes.length >= 4 && ue.ledger.length >= 4);
  const sum = await o.conn.procedures.adminEconomySummary();
  check('economy summary', sum.products >= 4 && sum.revenueDaily.length === 30 && sum.paymentsDay >= 1, sum.paymentsDay);
  check('used prize cannot be deleted', (await errorOf(o.conn.reducers.adminDeletePrize({ id: pGem }))).includes('IN_USE'));
  check('player cannot list payments', (await errorOf(p.conn.procedures.adminPayments({ query: '', status: '', method: '', accountId: 0n, page: 1, pageSize: 5 }))).includes('FORBIDDEN'));

  done('economy');
}

main().catch(e => {
  console.error('ERROR', e);
  process.exit(1);
});
