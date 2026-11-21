import { TimeDuration } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { fail } from './util';

export const SMS_KINDS = ['sandbox', 'kavenegar', 'smsir'] as const;

export type SmsProviderRow = {
  id: bigint;
  kind: string;
  name: string;
  apiKey: string;
  sender: string;
  otpTemplate: string;
  otpCodeVar: string;
};

type Http = { http: { fetch: (url: string, init?: any) => { status: number; text(): string } } };

export type SmsResult = { mode: string; sandboxText: string };

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function parse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function kavenegar(ctx: Http, p: SmsProviderRow, phone: string, code: string | null, text: string): string {
  const useLookup = code !== null && p.otpTemplate !== '';
  const path = useLookup ? 'verify/lookup.json' : 'sms/send.json';
  const body = useLookup
    ? form({ receptor: phone, template: p.otpTemplate, token: code! })
    : form({ receptor: phone, message: text, sender: p.sender });
  const res = ctx.http.fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(p.apiKey)}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    timeout: TimeDuration.fromMillis(8000),
  });
  const raw = res.text();
  const status = parse(raw)?.return?.status;
  if (res.status !== 200 || status !== 200) {
    console.error(`sms kavenegar provider=${p.id} http=${res.status} body=${raw.slice(0, 300)}`);
    fail('SMS_FAILED');
  }
  return useLookup ? 'kavenegar-lookup' : 'kavenegar-text';
}

function smsir(ctx: Http, p: SmsProviderRow, phone: string, code: string | null, text: string): string {
  const useVerify = code !== null && p.otpTemplate !== '';
  let url: string;
  let body: string;
  if (useVerify) {
    const templateId = Number(p.otpTemplate);
    if (!Number.isFinite(templateId)) fail('SMS_TEMPLATE_INVALID');
    url = 'https://api.sms.ir/v1/send/verify';
    body = JSON.stringify({ mobile: phone, templateId, parameters: [{ name: p.otpCodeVar || 'CODE', value: code }] });
  } else {
    url = 'https://api.sms.ir/v1/send/bulk';
    body = JSON.stringify({ lineNumber: Number(p.sender) || p.sender, messageText: text, mobiles: [phone] });
  }
  const res = ctx.http.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain', 'X-API-KEY': p.apiKey },
    body,
    timeout: TimeDuration.fromMillis(8000),
  });
  const raw = res.text();
  const status = parse(raw)?.status;
  if (res.status !== 200 || status !== 1) {
    console.error(`sms smsir provider=${p.id} http=${res.status} body=${raw.slice(0, 300)}`);
    fail('SMS_FAILED');
  }
  return useVerify ? 'smsir-verify' : 'smsir-text';
}

export function sendSms(ctx: Http, p: SmsProviderRow, phone: string, code: string | null, text: string): SmsResult {
  if (p.kind === 'sandbox') {
    console.info(`SANDBOX_SMS phone=${phone} text=${text}`);
    return { mode: 'sandbox', sandboxText: text };
  }
  if (!p.apiKey) fail('SMS_NOT_CONFIGURED');
  try {
    const mode = p.kind === 'kavenegar' ? kavenegar(ctx, p, phone, code, text) : p.kind === 'smsir' ? smsir(ctx, p, phone, code, text) : fail('SMS_KIND_UNKNOWN');
    return { mode, sandboxText: '' };
  } catch (e) {
    if (e instanceof SenderError) throw e;
    console.error(`sms provider=${p.id} request error ${e}`);
    fail('SMS_FAILED');
  }
}
