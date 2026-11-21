import { Router, SyncResponse, t } from 'spacetimedb/server';
import { TimeDuration, Timestamp } from 'spacetimedb';
import { bytesToHex } from '@noble/hashes/utils.js';
import { audit, fail, maskSecret, requireAccount, requireRole, sign, toLatinDigits, type Tx } from '@stg/base';
import { economyRows, economyTables, type EconomySchema } from './schema';
import { changeBalance, grantPrize, type EProc, type ETx } from './engine';
import { GATEWAYS, METHODS, STORES, activeMethods, checkGift, discounted, productVisible } from './catalog';

type Cfg = Record<string, string | boolean>;
type Http = { http: { fetch: (url: string, init?: any) => { status: number; text(): string } } };

const FIELDS: Record<string, { name: string; type: 'text' | 'secret' | 'bool' | 'textarea'; required: boolean }[]> = {
  zarinpal: [
    { name: 'merchantId', type: 'secret', required: true },
    { name: 'sandbox', type: 'bool', required: false },
  ],
  zibal: [
    { name: 'merchant', type: 'secret', required: true },
    { name: 'sandbox', type: 'bool', required: false },
  ],
  bazaar: [
    { name: 'packageName', type: 'text', required: true },
    { name: 'apiSecret', type: 'secret', required: true },
    { name: 'rsaPublicKey', type: 'textarea', required: false },
    { name: 'sandbox', type: 'bool', required: false },
  ],
  myket: [
    { name: 'packageName', type: 'text', required: true },
    { name: 'accessToken', type: 'secret', required: true },
    { name: 'rsaPublicKey', type: 'textarea', required: false },
    { name: 'sandbox', type: 'bool', required: false },
  ],
  in_app: [],
};

const MASK = '********';

const MethodField = t.object('PaymentMethodField', { name: t.string(), type: t.string(), required: t.bool() });
const MethodView = t.row('PaymentMethodView', {
  method: t.string().primaryKey(),
  isActive: t.bool(),
  configured: t.bool(),
  fields: t.array(MethodField),
  config: t.string(),
  updatedAt: t.timestamp(),
});

export const StartResult = t.object('PurchaseStartResult', {
  paymentId: t.u64(),
  status: t.string(),
  redirectUrl: t.string(),
  sku: t.string(),
  developerPayload: t.string(),
  rewards: t.string(),
});

const StatusResult = t.object('PurchaseStatusResult', { paymentId: t.u64(), status: t.string(), rewardGranted: t.bool(), error: t.string(), rewards: t.string() });

const PaymentListRow = t.object('PaymentListRow', { payment: economyRows.payment, phone: t.string(), productKey: t.string() });
const PaymentPage = t.object('PaymentPage', { total: t.u32(), rows: t.array(PaymentListRow) });
const PaymentDetail = t.object('PaymentDetail', { row: PaymentListRow, logs: t.array(economyRows.paymentLog) });
const Summary = t.object('EconomySummary', {
  currencies: t.u32(),
  metas: t.u32(),
  prizes: t.u32(),
  products: t.u32(),
  activeProducts: t.u32(),
  gifts: t.u32(),
  activeGifts: t.u32(),
  paymentsDay: t.u32(),
  pending: t.u32(),
  grantErrors: t.u32(),
  revenueToman30: t.i64(),
  revenueDaily: t.array(t.object('RevenueDay', { day: t.string(), toman: t.i64(), success: t.u32(), payments: t.u32() })),
});

function base(ctx: ETx) {
  return ctx as unknown as Tx;
}

function cfgOf(ctx: { db: ETx['db'] }, method: string): Cfg {
  const m = ctx.db.paymentMethod.method.find(method);
  try {
    return m ? (JSON.parse(m.config) as Cfg) : {};
  } catch {
    return {};
  }
}

function configured(method: string, cfg: Cfg) {
  return (FIELDS[method] ?? []).every(f => !f.required || (f.type === 'bool' ? true : typeof cfg[f.name] === 'string' && cfg[f.name] !== '') || (f.type === 'secret' && cfg.sandbox === true && GATEWAYS.includes(method)));
}

function maskCfg(method: string, cfg: Cfg) {
  const out: Cfg = {};
  for (const f of FIELDS[method] ?? []) {
    const v = cfg[f.name];
    if (f.type === 'secret') out[f.name] = v ? MASK : '';
    else out[f.name] = v ?? (f.type === 'bool' ? false : '');
  }
  return out;
}

function ticketFor(secret: string, paymentId: bigint, expiresSec: bigint) {
  const body = `${paymentId}.${expiresSec}`;
  return `${body}.${bytesToHex(sign(secret, `ticket|${body}`)).slice(0, 40)}`;
}

function readTicket(secret: string, ticket: string, nowSec: bigint) {
  const [id, exp, mac] = ticket.split('.');
  if (!id || !exp || !mac || !/^\d+$/.test(id) || !/^\d+$/.test(exp)) return undefined;
  const want = bytesToHex(sign(secret, `ticket|${id}.${exp}`)).slice(0, 40);
  let diff = want.length ^ mac.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (mac.charCodeAt(i) || 0);
  if (diff !== 0 || BigInt(exp) < nowSec) return undefined;
  return BigInt(id);
}

function query(url: string) {
  const out: Record<string, string> = {};
  const i = url.indexOf('?');
  if (i < 0) return out;
  for (const part of url.slice(i + 1).split('&')) {
    if (!part) continue;
    const [k, v = ''] = part.split('=');
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {}
  }
  return out;
}

function logCall(tx: ETx, paymentId: bigint, action: string, url: string, req: string, res: string, status: number) {
  tx.db.paymentLog.insert({ id: 0n, paymentId, action, url: url.replace(/\/v1\/[^/]{8,}\//, '/v1/********/'), request: req.slice(0, 2000), response: res.slice(0, 2000), httpStatus: status, at: tx.timestamp });
}

function call(ctx: Http, url: string, init: any) {
  try {
    const r = ctx.http.fetch(url, { ...init, timeout: TimeDuration.fromMillis(10000) });
    return { status: r.status, text: r.text() };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function zarinHost(cfg: Cfg) {
  return cfg.sandbox ? 'https://sandbox.zarinpal.com' : 'https://payment.zarinpal.com';
}

function zarinMerchant(cfg: Cfg) {
  const m = String(cfg.merchantId || '');
  if (cfg.sandbox && m.length !== 36) return '00000000-0000-4000-8000-000000000000';
  return m;
}

function zibalMerchant(cfg: Cfg) {
  return String(cfg.sandbox ? 'zibal' : cfg.merchant || '');
}

type GatewayRequest = { ok: boolean; authority: string; redirectUrl: string; log: { url: string; req: string; res: string; status: number } };

function gatewayRequest(ctx: Http, method: string, cfg: Cfg, amountRial: bigint, callbackUrl: string, paymentId: bigint, description: string): GatewayRequest {
  if (method === 'zarinpal') {
    const url = `${zarinHost(cfg)}/pg/v4/payment/request.json`;
    const req = JSON.stringify({ merchant_id: zarinMerchant(cfg), amount: Number(amountRial), currency: 'IRR', callback_url: callbackUrl, description, metadata: { order_id: String(paymentId) } });
    const r = call(ctx, url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: req });
    const d = parse(r.text)?.data;
    const ok = r.status === 200 && d?.code === 100 && typeof d.authority === 'string';
    return { ok, authority: ok ? d.authority : '', redirectUrl: ok ? `${zarinHost(cfg)}/pg/StartPay/${d.authority}` : '', log: { url, req: req.replace(zarinMerchant(cfg), MASK), res: r.text, status: r.status } };
  }
  const url = 'https://gateway.zibal.ir/v1/request';
  const req = JSON.stringify({ merchant: zibalMerchant(cfg), amount: Number(amountRial), callbackUrl, description, orderId: String(paymentId) });
  const r = call(ctx, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req });
  const d = parse(r.text);
  const ok = r.status === 200 && d?.result === 100 && d.trackId !== undefined;
  return { ok, authority: ok ? String(d.trackId) : '', redirectUrl: ok ? `https://gateway.zibal.ir/start/${d.trackId}` : '', log: { url, req: req.replace(zibalMerchant(cfg), MASK), res: r.text, status: r.status } };
}

type VerifyResult = { state: 'paid' | 'failed' | 'unknown'; refId: string; cardMask: string; error: string; log: { url: string; req: string; res: string; status: number } };

function gatewayVerify(ctx: Http, method: string, cfg: Cfg, authority: string, amountRial: bigint): VerifyResult {
  if (method === 'zarinpal') {
    const url = `${zarinHost(cfg)}/pg/v4/payment/verify.json`;
    const req = JSON.stringify({ merchant_id: zarinMerchant(cfg), amount: Number(amountRial), authority });
    const r = call(ctx, url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: req });
    const j = parse(r.text);
    const code = j?.data?.code ?? j?.errors?.code;
    const log = { url, req: req.replace(zarinMerchant(cfg), MASK), res: r.text, status: r.status };
    if (code === 100 || code === 101) return { state: 'paid', refId: String(j.data.ref_id ?? ''), cardMask: String(j.data.card_pan ?? ''), error: '', log };
    if (typeof code === 'number' && r.status !== 0 && r.status < 500) return { state: 'failed', refId: '', cardMask: '', error: `ZARINPAL_${code}`, log };
    return { state: 'unknown', refId: '', cardMask: '', error: 'GATEWAY_UNAVAILABLE', log };
  }
  const url = 'https://gateway.zibal.ir/v1/verify';
  const req = JSON.stringify({ merchant: zibalMerchant(cfg), trackId: Number(authority) });
  const r = call(ctx, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req });
  const j = parse(r.text);
  const log = { url, req: req.replace(zibalMerchant(cfg), MASK), res: r.text, status: r.status };
  if (j && (j.result === 100 || j.result === 201)) {
    if (j.amount !== undefined && BigInt(j.amount) !== amountRial) return { state: 'failed', refId: '', cardMask: '', error: 'AMOUNT_MISMATCH', log };
    return { state: 'paid', refId: String(j.refNumber ?? ''), cardMask: String(j.cardNumber ?? ''), error: '', log };
  }
  if (j && j.result === 202) return { state: 'failed', refId: '', cardMask: '', error: 'ZIBAL_202', log };
  return { state: 'unknown', refId: '', cardMask: '', error: 'GATEWAY_UNAVAILABLE', log };
}

function storeVerify(ctx: Http, method: string, cfg: Cfg, sku: string, token: string, paymentId: bigint): VerifyResult {
  const empty = { url: '', req: '', res: '', status: 0 };
  if (cfg.sandbox) {
    if (token.startsWith(`sandbox-${paymentId}-`)) return { state: 'paid', refId: token, cardMask: '', error: '', log: { ...empty, res: 'sandbox' } };
    return { state: 'failed', refId: '', cardMask: '', error: 'PURCHASE_INVALID', log: { ...empty, res: 'sandbox' } };
  }
  const pkg = encodeURIComponent(String(cfg.packageName));
  let r: { status: number; text: string };
  let url: string;
  if (method === 'bazaar') {
    url = `https://pardakht.cafebazaar.ir/devapi/v2/api/validate/${pkg}/inapp/${encodeURIComponent(sku)}/purchases/${encodeURIComponent(token)}/`;
    r = call(ctx, url, { method: 'GET', headers: { 'CAFEBAZAAR-PISHKHAN-API-SECRET': String(cfg.apiSecret) } });
  } else {
    url = `https://developer.myket.ir/api/partners/applications/${pkg}/purchases/products/${encodeURIComponent(sku)}/verify`;
    r = call(ctx, url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access-Token': String(cfg.accessToken) }, body: JSON.stringify({ tokenId: token }) });
  }
  const log = { url, req: '', res: r.text, status: r.status };
  const j = parse(r.text);
  if (r.status >= 200 && r.status < 300) {
    if (j?.purchaseState !== 0) return { state: 'failed', refId: '', cardMask: '', error: 'PURCHASE_INVALID', log };
    if (String(j?.developerPayload ?? '') !== String(paymentId)) return { state: 'failed', refId: '', cardMask: '', error: 'DEVELOPER_PAYLOAD_MISMATCH', log };
    return { state: 'paid', refId: String(j?.orderId ?? token), cardMask: '', error: '', log };
  }
  if (r.status === 401 || r.status === 403 || (r.status === 404 && j?.error === 'invalid_value')) return { state: 'unknown', refId: '', cardMask: '', error: 'STORE_CONFIGURATION_REJECTED', log };
  if (r.status === 400 || r.status === 404 || r.status === 410) return { state: 'failed', refId: '', cardMask: '', error: 'PURCHASE_INVALID', log };
  return { state: 'unknown', refId: '', cardMask: '', error: 'STORE_UNAVAILABLE', log };
}

function settings(ctx: { db: ETx['db'] }) {
  const s = ctx.db.economySettings.id.find(0);
  if (!s) fail('NOT_INITIALIZED');
  return s;
}

function releaseGift(tx: ETx, p: { id: bigint; giftId: bigint }) {
  if (!p.giftId) return;
  for (const u of tx.db.giftUse.giftId.filter(p.giftId)) {
    if (u.paymentId === p.id && u.status === 'reserved') tx.db.giftUse.id.update({ ...u, status: 'released', updatedAt: tx.timestamp });
  }
}

function markPaid(tx: ETx, paymentId: bigint, refId: string, cardMask: string) {
  const p = tx.db.payment.id.find(paymentId);
  if (!p || p.status !== 'pending') return false;
  tx.db.payment.id.update({ ...p, status: 'success', refId: refId || p.refId, cardMask, error: '', verifiedAt: tx.timestamp, updatedAt: tx.timestamp });
  if (p.giftId) {
    for (const u of tx.db.giftUse.giftId.filter(p.giftId)) {
      if (u.paymentId === p.id && u.status === 'reserved') tx.db.giftUse.id.update({ ...u, status: 'used', updatedAt: tx.timestamp });
    }
    const g = tx.db.gift.id.find(p.giftId);
    if (g) tx.db.gift.id.update({ ...g, totalUsed: g.totalUsed + 1 });
  }
  return true;
}

function markFailed(tx: ETx, paymentId: bigint, status: 'failed' | 'expired', error: string) {
  const p = tx.db.payment.id.find(paymentId);
  if (!p || p.status !== 'pending') return;
  tx.db.payment.id.update({ ...p, status, error, updatedAt: tx.timestamp });
  releaseGift(tx, p);
}

export function grantPayment(ctx: { withTx: EProc['withTx'] }, paymentId: bigint) {
  try {
    return ctx.withTx(tx => {
      const p = tx.db.payment.id.find(paymentId);
      if (!p || p.status !== 'success' || p.rewardGranted) return p?.rewards ?? '[]';
      const product = tx.db.product.id.find(p.productId);
      if (!product) fail('PRODUCT_NOT_FOUND');
      for (const h of settleChecks) {
        const refused = h(tx, p, product);
        if (!refused) continue;
        if (p.method === 'in_app' && p.coinAmount > 0n) changeBalance(tx, p.accountId, p.coinCurrency, p.coinAmount, `refund:${product.key}`, 'payment', String(p.id));
        tx.db.payment.id.update({ ...p, status: 'refused', error: refused, rewardError: refused, updatedAt: tx.timestamp });
        return '[]';
      }
      const rewards = JSON.stringify(grantPrize(tx, p.accountId, product.prizeId, 'payment', String(p.id)));
      tx.db.payment.id.update({ ...p, rewardGranted: true, rewardError: '', rewards, updatedAt: tx.timestamp });
      for (const h of paymentHooks) h(tx, p.accountId, p.id, p.productId);
      return rewards;
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    ctx.withTx(tx => {
      const p = tx.db.payment.id.find(paymentId);
      if (p) tx.db.payment.id.update({ ...p, rewardError: msg, updatedAt: tx.timestamp });
    });
    return '[]';
  }
}

export const paymentHooks: ((ctx: ETx, accountId: bigint, paymentId: bigint, productId: bigint) => void)[] = [];

export type ProductRow = NonNullable<ReturnType<ETx['db']['product']['id']['find']>>;
export type PaymentRow = NonNullable<ReturnType<ETx['db']['payment']['id']['find']>>;
export type PurchaseRequest = { accountId: bigint; product: ProductRow; method: string; context: string };
export type PurchaseQuote = { available: boolean; originalToman: bigint; priceToman: bigint; discountPercent: number; coinCurrency: string; coinAmount: bigint; methods: string[]; giftAllowed: boolean };
export const purchaseChecks: ((ctx: ETx, req: PurchaseRequest, quote: PurchaseQuote) => PurchaseQuote | void)[] = [];
export const purchaseCreatedHooks: ((ctx: ETx, paymentId: bigint, req: PurchaseRequest) => void)[] = [];
export const settleChecks: ((ctx: ETx, payment: PaymentRow, product: ProductRow) => string | undefined)[] = [];

function verifyAndSettle(ctx: Http & { withTx: EProc['withTx'] }, paymentId: bigint, action: string) {
  const p = ctx.withTx(tx => {
    const row = tx.db.payment.id.find(paymentId);
    if (row && row.status === 'pending') tx.db.payment.id.update({ ...row, inquiryCount: row.inquiryCount + 1, inquiredAt: tx.timestamp });
    return row ? { ...row, cfg: cfgOf(tx, row.method) } : undefined;
  });
  if (!p || p.status !== 'pending' || !GATEWAYS.includes(p.method) || !p.authority) return p?.status ?? 'unknown';
  const v = gatewayVerify(ctx, p.method, p.cfg, p.authority, p.amountRial);
  const paid = ctx.withTx(tx => {
    logCall(tx, p.id, action, v.log.url, v.log.req, v.log.res, v.log.status);
    if (v.state === 'paid') return markPaid(tx, p.id, v.refId, v.cardMask);
    if (v.state === 'failed') markFailed(tx, p.id, 'failed', v.error);
    else {
      const row = tx.db.payment.id.find(p.id);
      if (row) tx.db.payment.id.update({ ...row, error: v.error, updatedAt: tx.timestamp });
    }
    return false;
  });
  if (paid) grantPayment(ctx, p.id);
  return v.state;
}

function redirectTo(url: string, paymentId: bigint, success: boolean) {
  const target = (url || 'stg://payment?success={success}&paymentId={paymentId}').replace('{success}', String(success)).replace('{paymentId}', String(paymentId));
  return new SyncResponse('', { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
}

export function startPurchase(ctx: EProc, a: { productId: bigint; method: string; giftCode: string }, context: string) {
    const salt = bytesToHex(ctx.random.fill(new Uint8Array(8)));
    const plan = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const product = tx.db.product.id.find(a.productId);
      if (!product) fail('PRODUCT_NOT_FOUND');
      const req = { accountId: me.id, product, method: a.method, context };
      let quote: PurchaseQuote = {
        available: !context && product.isActive && productVisible(tx, me.id, product.audienceTagIds),
        originalToman: product.priceToman,
        priceToman: discounted(product.priceToman, product.discountPercent),
        discountPercent: product.discountPercent,
        coinCurrency: product.coinCurrency,
        coinAmount: product.coinAmount,
        methods: product.paymentMethods,
        giftAllowed: true,
      };
      for (const h of purchaseChecks) quote = h(tx, req, quote) ?? quote;
      if (!quote.available) fail('PRODUCT_NOT_FOUND');
      if (!quote.methods.includes(a.method)) fail('METHOD_NOT_ALLOWED');
      if (!activeMethods(tx).has(a.method)) fail('METHOD_NOT_ACTIVE');
      const cfg = cfgOf(tx, a.method);
      if (!configured(a.method, cfg)) fail('PAYMENT_METHOD_NOT_CONFIGURED');
      const s = settings(tx);
      const original = quote.priceToman;
      let giftId = 0n;
      let giftPercent = 0;
      if (a.giftCode.trim()) {
        if (!GATEWAYS.includes(a.method) || !quote.giftAllowed) fail('GIFT_NOT_ALLOWED');
        const g = checkGift(tx, me.id, a.giftCode, 'discount');
        giftId = g.id;
        giftPercent = g.discountPercent;
      }
      const final = a.method === 'in_app' ? 0n : discounted(original, giftPercent);
      const pay = tx.db.payment.insert({
        id: 0n,
        accountId: me.id,
        productId: product.id,
        method: a.method,
        sandbox: cfg.sandbox === true,
        status: 'pending',
        originalToman: quote.originalToman,
        finalToman: final,
        amountRial: final * 10n,
        coinCurrency: a.method === 'in_app' ? quote.coinCurrency : '',
        coinAmount: a.method === 'in_app' ? quote.coinAmount : 0n,
        giftId,
        discountPercent: quote.discountPercent,
        authority: '',
        refId: '',
        storeToken: '',
        cardMask: '',
        error: '',
        rewardGranted: false,
        rewardError: '',
        rewards: '[]',
        inquiryCount: 0,
        inquiredAt: undefined,
        verifiedAt: undefined,
        createdAt: tx.timestamp,
        updatedAt: tx.timestamp,
      });
      if (giftId) tx.db.giftUse.insert({ id: 0n, giftId, accountId: me.id, paymentId: pay.id, status: 'reserved', createdAt: tx.timestamp, updatedAt: tx.timestamp });
      for (const h of purchaseCreatedHooks) h(tx, pay.id, req);
      if (a.method === 'in_app') {
        changeBalance(tx, me.id, quote.coinCurrency, -quote.coinAmount, `buy:${product.key}`, 'payment', String(pay.id));
        markPaid(tx, pay.id, `in_app-${pay.id}`, '');
        return { kind: 'settled' as const, pay, product, cfg, s };
      }
      if (GATEWAYS.includes(a.method) && final === 0n) {
        markPaid(tx, pay.id, `free-${pay.id}`, '');
        return { kind: 'settled' as const, pay, product, cfg, s };
      }
      if (STORES.includes(a.method)) return { kind: 'store' as const, pay, product, cfg, s };
      if (!s.publicBaseUrl) fail('PUBLIC_BASE_URL_MISSING');
      return { kind: 'gateway' as const, pay, product, cfg, s, db: tx.databaseIdentity.toHexString() };
    });

    if (plan.kind === 'settled') {
      const rewards = grantPayment(ctx, plan.pay.id);
      const after = ctx.withTx(tx => tx.db.payment.id.find(plan.pay.id));
      if (after?.status === 'refused') fail(after.error);
      return { paymentId: plan.pay.id, status: 'success', redirectUrl: '', sku: '', developerPayload: '', rewards };
    }
    if (plan.kind === 'store') {
      return { paymentId: plan.pay.id, status: 'store', redirectUrl: '', sku: a.method === 'bazaar' ? plan.product.skuBazaar : plan.product.skuMyket, developerPayload: String(plan.pay.id), rewards: '[]' };
    }
    const expires = ctx.timestamp.microsSinceUnixEpoch / 1_000_000n + 48n * 3600n;
    const ticket = ticketFor(ctx.env.OTP_SECRET, plan.pay.id, expires);
    const dbId = plan.db;
    const callbackUrl = `${plan.s.publicBaseUrl}/v1/database/${dbId}/route/economy/callback?t=${ticket}&n=${salt}`;
    const r = gatewayRequest(ctx, a.method, plan.cfg, plan.pay.amountRial, callbackUrl, plan.pay.id, `${plan.product.key} #${plan.pay.id}`);
    ctx.withTx(tx => {
      logCall(tx, plan.pay.id, 'request', r.log.url, r.log.req, r.log.res, r.log.status);
      const row = tx.db.payment.id.find(plan.pay.id);
      if (!row) return;
      if (r.ok) tx.db.payment.id.update({ ...row, authority: r.authority, updatedAt: tx.timestamp });
      else markFailed(tx, row.id, 'failed', 'GATEWAY_REQUEST_FAILED');
    });
    if (!r.ok) fail('GATEWAY_REQUEST_FAILED');
    return { paymentId: plan.pay.id, status: 'redirect', redirectUrl: r.redirectUrl, sku: '', developerPayload: '', rewards: '[]' };
  }

export function definePayments(st: EconomySchema) {
  const adminPaymentMethods = st.view({ name: 'admin_payment_methods', public: true }, t.array(MethodView), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    const role = s ? ctx.db.admin.accountId.find(s.accountId)?.role : undefined;
    if (role !== 'admin' && role !== 'owner') return [];
    return METHODS.map(method => {
      const m = ctx.db.paymentMethod.method.find(method);
      const cfg = cfgOf(ctx as any, method);
      return {
        method,
        isActive: m?.isActive ?? false,
        configured: configured(method, cfg),
        fields: FIELDS[method],
        config: JSON.stringify(maskCfg(method, cfg)),
        updatedAt: m?.updatedAt ?? new Timestamp(0n),
      };
    });
  });

  const adminSavePaymentMethod = st.reducer({ method: t.string(), isActive: t.bool(), config: t.string() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    if (!(METHODS as readonly string[]).includes(a.method)) fail('INVALID_PAYMENT_METHOD');
    let incoming: Cfg;
    try {
      incoming = JSON.parse(a.config || '{}');
    } catch {
      fail('INVALID_CONFIG');
    }
    const old = cfgOf(ctx, a.method);
    const next: Cfg = {};
    for (const f of FIELDS[a.method]) {
      const v = incoming[f.name];
      if (f.type === 'bool') next[f.name] = v === true;
      else if (f.type === 'secret' && v === MASK) next[f.name] = old[f.name] ?? '';
      else next[f.name] = typeof v === 'string' ? v.trim().slice(0, 4000) : '';
    }
    if (a.isActive && !configured(a.method, next)) fail('PAYMENT_METHOD_NOT_CONFIGURED');
    const row = { method: a.method, isActive: a.isActive, config: JSON.stringify(next), updatedAt: ctx.timestamp };
    if (ctx.db.paymentMethod.method.find(a.method)) ctx.db.paymentMethod.method.update(row);
    else ctx.db.paymentMethod.insert(row);
    audit(base(ctx), me.id, 'payment_method.save', a.method, `active=${a.isActive} sandbox=${next.sandbox === true}`);
  });

  const adminEconomySettings = st.view({ name: 'admin_economy_settings', public: true }, t.option(economyRows.settings), ctx => {
    const s = ctx.db.session.identity.find(ctx.sender);
    if (!s || !ctx.db.admin.accountId.find(s.accountId)) return undefined;
    return ctx.db.economySettings.id.find(0) ?? undefined;
  });

  const adminSaveEconomySettings = st.reducer({ publicBaseUrl: t.string(), redirectUrl: t.string(), pendingTtlMinutes: t.u32() }, (ctx, a) => {
    const me = requireRole(base(ctx), 'admin');
    const baseUrl = a.publicBaseUrl.trim().replace(/\/+$/, '');
    if (baseUrl && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(baseUrl)) fail('INVALID_URL');
    const redirect = a.redirectUrl.trim();
    if (redirect && !/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(redirect)) fail('INVALID_URL');
    if (a.pendingTtlMinutes < 5 || a.pendingTtlMinutes > 24 * 60) fail('INVALID_RULE:pendingTtlMinutes');
    ctx.db.economySettings.id.update({ id: 0, publicBaseUrl: baseUrl, redirectUrl: redirect, pendingTtlMinutes: a.pendingTtlMinutes, updatedAt: ctx.timestamp });
    audit(base(ctx), me.id, 'economy_settings.save', 'settings');
  });

  const purchaseStart = st.procedure({ productId: t.u64(), method: t.string(), giftCode: t.string() }, StartResult, (ctx, a) => startPurchase(ctx as unknown as EProc, a, ''));

  const purchaseSubmit = st.procedure({ paymentId: t.u64(), token: t.string() }, StatusResult, (ctx, a) => {
    const token = a.token.trim();
    if (!token || token.length > 1024) fail('INVALID_TOKEN');
    const p = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const row = tx.db.payment.id.find(a.paymentId);
      if (!row || row.accountId !== me.id) fail('PAYMENT_NOT_FOUND');
      if (!STORES.includes(row.method)) fail('METHOD_NOT_ALLOWED');
      for (const other of tx.db.payment.storeToken.filter(token)) if (other.method === row.method && other.id !== row.id) fail('TOKEN_ALREADY_USED');
      const product = tx.db.product.id.find(row.productId);
      return { ...row, cfg: cfgOf(tx, row.method), sku: row.method === 'bazaar' ? product?.skuBazaar ?? '' : product?.skuMyket ?? '' };
    });
    if (p.status === 'pending') {
      if (p.sandbox !== (p.cfg.sandbox === true)) {
        ctx.withTx(tx => markFailed(tx, p.id, 'failed', 'STORE_MODE_CHANGED'));
      } else {
        const v = storeVerify(ctx, p.method, p.cfg, p.sku, token, p.id);
        const paid = ctx.withTx(tx => {
          logCall(tx, p.id, 'store_validate', v.log.url, v.log.req, v.log.res, v.log.status);
          const row = tx.db.payment.id.find(p.id);
          if (row && row.status === 'pending') tx.db.payment.id.update({ ...row, storeToken: token, updatedAt: tx.timestamp });
          if (v.state === 'paid') return markPaid(tx, p.id, v.refId, '');
          if (v.state === 'failed') markFailed(tx, p.id, 'failed', v.error);
          else if (row) tx.db.payment.id.update({ ...row, storeToken: token, error: v.error, updatedAt: tx.timestamp });
          return false;
        });
        if (paid) grantPayment(ctx, p.id);
      }
    }
    return ctx.withTx(tx => {
      const row = tx.db.payment.id.find(p.id)!;
      return { paymentId: row.id, status: row.status, rewardGranted: row.rewardGranted, error: row.error || row.rewardError, rewards: row.rewards };
    });
  });

  const purchaseStatus = st.procedure({ paymentId: t.u64() }, StatusResult, (ctx, a) => {
    const row = ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const p = tx.db.payment.id.find(a.paymentId);
      if (!p || p.accountId !== me.id) fail('PAYMENT_NOT_FOUND');
      return p;
    });
    if (row.status === 'success' && !row.rewardGranted) grantPayment(ctx, row.id);
    return ctx.withTx(tx => {
      const p = tx.db.payment.id.find(a.paymentId)!;
      return { paymentId: p.id, status: p.status, rewardGranted: p.rewardGranted, error: p.error || p.rewardError, rewards: p.rewards };
    });
  });

  const myPayments = st.procedure({ page: t.u32(), pageSize: t.u32() }, PaymentPage, (ctx, a) =>
    ctx.withTx(tx => {
      const me = requireAccount(base(tx));
      const list = [...tx.db.payment.accountId.filter(me.id)].sort((x, y) => (x.id < y.id ? 1 : -1));
      const size = Math.min(Math.max(a.pageSize || 20, 1), 50);
      const start = (Math.max(a.page || 1, 1) - 1) * size;
      return { total: list.length, rows: list.slice(start, start + size).map(p => ({ payment: { ...p, authority: '', storeToken: '' }, phone: '', productKey: tx.db.product.id.find(p.productId)?.key ?? '' })) };
    })
  );

  const paymentCallback = st.httpHandler((ctx, req) => {
    const q = query(req.url);
    const now = ctx.timestamp.microsSinceUnixEpoch / 1_000_000n;
    const paymentId = readTicket(ctx.env.OTP_SECRET, q.t ?? '', now);
    const s = ctx.withTx(tx => tx.db.economySettings.id.find(0));
    if (paymentId === undefined) return new SyncResponse('invalid ticket', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    const p = ctx.withTx(tx => tx.db.payment.id.find(paymentId));
    if (!p) return new SyncResponse('unknown payment', { status: 404 });
    const authority = q.Authority ?? q.trackId ?? '';
    const statusOk = q.Status ? q.Status === 'OK' : q.success ? q.success === '1' : true;
    if (p.status === 'pending' && authority && authority === p.authority) {
      ctx.withTx(tx => logCall(tx, p.id, 'callback', '', JSON.stringify({ ...q, t: '***' }), '', 0));
      if (!statusOk) ctx.withTx(tx => markFailed(tx, p.id, 'failed', 'CANCELLED'));
      else verifyAndSettle(ctx as any, p.id, 'verify');
    }
    const after = ctx.withTx(tx => tx.db.payment.id.find(paymentId));
    return redirectTo(s?.redirectUrl ?? '', paymentId, after?.status === 'success');
  });

  const routes = st.httpRouter(new Router().get('/economy/callback', paymentCallback).post('/economy/callback', paymentCallback));

  const reconcilePayments = st.procedure({ onSchedule: economyTables.reconcileTimer }, { timer: economyTables.reconcileTimer.rowType }, t.unit(), ctx => {
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const work = ctx.withTx(tx => {
      const s = tx.db.economySettings.id.find(0);
      const ttl = BigInt(s?.pendingTtlMinutes ?? 45) * 60_000_000n;
      const expire: bigint[] = [];
      const inquire: bigint[] = [];
      for (const p of tx.db.payment.status.filter('pending')) {
        const age = now - p.createdAt.microsSinceUnixEpoch;
        if (age > ttl) expire.push(p.id);
        else if (GATEWAYS.includes(p.method) && p.authority && age > 180_000_000n && (!p.inquiredAt || now - p.inquiredAt.microsSinceUnixEpoch > 60_000_000n)) inquire.push(p.id);
      }
      for (const id of expire) markFailed(tx, id, 'expired', 'PAYMENT_EXPIRED');
      const regrant = [...tx.db.payment.status.filter('success')].filter(p => !p.rewardGranted).map(p => p.id).slice(0, 20);
      return { inquire: inquire.slice(0, 20), regrant };
    });
    for (const id of work.inquire) verifyAndSettle(ctx as any, id, 'inquiry');
    for (const id of work.regrant) grantPayment(ctx, id);
    return {};
  });

  const adminPayments = st.procedure(
    { query: t.string(), status: t.string(), method: t.string(), accountId: t.u64(), page: t.u32(), pageSize: t.u32() },
    PaymentPage,
    (ctx, a) =>
      ctx.withTx(tx => {
        requireRole(base(tx), 'operator');
        const q = toLatinDigits(a.query).trim();
        const list = [...(a.accountId ? tx.db.payment.accountId.filter(a.accountId) : tx.db.payment.iter())]
          .filter(p => (!a.status || p.status === a.status) && (!a.method || p.method === a.method))
          .filter(p => !q || String(p.id) === q || p.refId.includes(q) || p.authority === q || (tx.db.account.id.find(p.accountId)?.phone.includes(q) ?? false))
          .sort((x, y) => (x.id < y.id ? 1 : -1));
        const size = Math.min(Math.max(a.pageSize || 20, 1), 100);
        const start = (Math.max(a.page || 1, 1) - 1) * size;
        return {
          total: list.length,
          rows: list.slice(start, start + size).map(p => ({ payment: p, phone: tx.db.account.id.find(p.accountId)?.phone ?? '', productKey: tx.db.product.id.find(p.productId)?.key ?? '' })),
        };
      })
  );

  const adminPayment = st.procedure({ id: t.u64() }, PaymentDetail, (ctx, a) =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const p = tx.db.payment.id.find(a.id);
      if (!p) fail('NOT_FOUND');
      return {
        row: { payment: p, phone: tx.db.account.id.find(p.accountId)?.phone ?? '', productKey: tx.db.product.id.find(p.productId)?.key ?? '' },
        logs: [...tx.db.paymentLog.paymentId.filter(p.id)].sort((x, y) => (x.id < y.id ? -1 : 1)),
      };
    })
  );

  const adminInquirePayment = st.procedure({ id: t.u64() }, t.string(), (ctx, a) => {
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      audit(base(tx), me.id, 'payment.inquire', String(a.id));
    });
    return verifyAndSettle(ctx as any, a.id, 'inquiry');
  });

  const adminRetryGrant = st.procedure({ id: t.u64() }, t.string(), (ctx, a) => {
    ctx.withTx(tx => {
      const me = requireRole(base(tx), 'admin');
      const p = tx.db.payment.id.find(a.id);
      if (!p) fail('NOT_FOUND');
      if (p.status !== 'success' || p.rewardGranted) fail('NOTHING_TO_RETRY');
      audit(base(tx), me.id, 'payment.retry_grant', String(a.id));
    });
    return grantPayment(ctx, a.id);
  });

  const adminEconomySummary = st.procedure(Summary, ctx =>
    ctx.withTx(tx => {
      requireRole(base(tx), 'operator');
      const now = tx.timestamp.microsSinceUnixEpoch;
      const dayUs = 86_400_000_000n;
      const days = new Map<string, { toman: bigint; success: number; payments: number }>();
      const dayOf = (us: bigint) => new Date(Number((us + 12_600_000_000n) / 1000n)).toISOString().slice(0, 10);
      for (let i = 29; i >= 0; i--) days.set(dayOf(now - BigInt(i) * dayUs), { toman: 0n, success: 0, payments: 0 });
      let paymentsDay = 0;
      let pending = 0;
      let grantErrors = 0;
      let revenue = 0n;
      for (const p of tx.db.payment.iter()) {
        const at = p.createdAt.microsSinceUnixEpoch;
        if (now - at < dayUs) paymentsDay++;
        if (p.status === 'pending') pending++;
        if (p.status === 'success' && !p.rewardGranted && p.rewardError) grantErrors++;
        const d = days.get(dayOf(at));
        if (d) {
          d.payments++;
          if (p.status === 'success') {
            d.success++;
            if (!p.sandbox && p.method !== 'in_app') {
              d.toman += p.finalToman;
              revenue += p.finalToman;
            }
          }
        }
      }
      const products = [...tx.db.product.iter()];
      const gifts = [...tx.db.gift.iter()];
      return {
        currencies: Number(tx.db.currency.count()),
        metas: Number(tx.db.meta.count()),
        prizes: Number(tx.db.prize.count()),
        products: products.length,
        activeProducts: products.filter(p => p.isActive).length,
        gifts: gifts.length,
        activeGifts: gifts.filter(g => g.isActive).length,
        paymentsDay,
        pending,
        grantErrors,
        revenueToman30: revenue,
        revenueDaily: [...days].map(([day, v]) => ({ day, ...v })),
      };
    })
  );

  return {
    adminPaymentMethods,
    adminSavePaymentMethod,
    adminEconomySettings,
    adminSaveEconomySettings,
    purchaseStart,
    purchaseSubmit,
    purchaseStatus,
    myPayments,
    paymentCallback,
    routes,
    reconcilePayments,
    adminPayments,
    adminPayment,
    adminInquirePayment,
    adminRetryGrant,
    adminEconomySummary,
  };
}

export { maskSecret };
