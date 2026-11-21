import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getConn, markMutation, useRows, useSnap } from './conn.ts';
import { errorText, getLocale, parseError, type ErrInfo } from './i18n.ts';

export type Tr = { lang: string; text: string };

const RANK: Record<string, number> = { support: 1, operator: 2, admin: 3, owner: 4 };

export function useSession() {
  const me = useRows('me')[0];
  const roleRow = useRows('myRole')[0];
  const role = roleRow?.role ?? '';
  const admins = useRows('adminAdmins');
  const self = me ? admins.find(a => a.accountId === me.id) : undefined;
  return {
    me,
    role,
    username: self?.username ?? '',
    isEnv: !!self?.isEnv,
    can: (need: 'support' | 'operator' | 'admin' | 'owner') => (RANK[role] ?? 0) >= RANK[need],
  };
}

export function useLanguages() {
  const all = useRows('language');
  return useMemo(() => {
    const sorted = [...all].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code));
    const active = sorted.filter(l => l.isActive);
    const def = sorted.find(l => l.isDefault)?.code ?? active[0]?.code ?? 'fa';
    return { all: sorted, active, def };
  }, [all]);
}

export function trText(list: Tr[] | undefined, def?: string): string {
  if (!list?.length) return '';
  const l = getLocale();
  return list.find(x => x.lang === l)?.text ?? (def ? list.find(x => x.lang === def)?.text : undefined) ?? list[0].text;
}

export function useBrand() {
  const brand = useRows('brand')[0];
  const { def } = useLanguages();
  const name = trText(brand?.name, def);
  return { brand, name, mark: (brand?.shortName || name || 'G').trim().slice(0, 2) };
}

export type Toast = { id: number; kind: 'ok' | 'bad'; text: string };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
let toastId = 0;

export function toast(kind: Toast['kind'], text: string) {
  const id = ++toastId;
  toasts = [...toasts, { id, kind, text }].slice(-4);
  toastListeners.forEach(f => f());
  window.setTimeout(() => {
    toasts = toasts.filter(x => x.id !== id);
    toastListeners.forEach(f => f());
  }, kind === 'bad' ? 6000 : 3000);
}

export function useToasts() {
  return useSyncExternalStore(
    f => {
      toastListeners.add(f);
      return () => toastListeners.delete(f);
    },
    () => toasts
  );
}

export async function run<T>(fn: (conn: ReturnType<typeof getConn>) => Promise<T>, ok?: string): Promise<{ ok: true; value: T } | { ok: false; err: ErrInfo }> {
  try {
    const value = await fn(getConn());
    markMutation();
    if (ok) toast('ok', ok);
    return { ok: true, value };
  } catch (e) {
    const err = parseError(e);
    return { ok: false, err };
  }
}

export async function runToast<T>(fn: (conn: ReturnType<typeof getConn>) => Promise<T>, ok?: string): Promise<boolean> {
  const r = await run(fn, ok);
  if (!r.ok) toast('bad', errorText(r.err));
  return r.ok;
}

export function useFetch<T>(fn: () => Promise<T>, deps: unknown[]) {
  const snap = useSnap();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ErrInfo | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!snap.conn) return;
    let live = true;
    setLoading(true);
    fn()
      .then(v => {
        if (!live) return;
        setData(v);
        setError(null);
      })
      .catch(e => {
        if (live) setError(parseError(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [snap.conn, snap.mut, ...deps]);
  return { data, error, loading };
}

export function useDebounced<T>(v: T, ms = 300): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(id);
  }, [v, ms]);
  return d;
}

export function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export type Theme = 'light' | 'dark';
let theme: Theme = localStorage.getItem('stg.theme') === 'dark' ? 'dark' : 'light';
const themeListeners = new Set<() => void>();

function applyTheme() {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
applyTheme();

export function setTheme(t: Theme) {
  theme = t;
  localStorage.setItem('stg.theme', t);
  applyTheme();
  themeListeners.forEach(f => f());
}

window.addEventListener('storage', e => {
  if (e.key === 'stg.theme' && (e.newValue === 'light' || e.newValue === 'dark') && e.newValue !== theme) setTheme(e.newValue);
});

export function useTheme() {
  return useSyncExternalStore(
    f => {
      themeListeners.add(f);
      return () => themeListeners.delete(f);
    },
    () => theme
  );
}

export type Route = { page: string; query: URLSearchParams; settings: string | null };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const query = new URLSearchParams(qs ?? '');
  if (parts[0] === 'settings') {
    const [lp, lq] = (sessionStorage.getItem('stg.lastPage') ?? 'dashboard').split('?');
    return { page: lp || 'dashboard', query: new URLSearchParams(lq ?? ''), settings: parts[1] ?? '' };
  }
  return { page: parts[0] || 'dashboard', query, settings: null };
}

let route = parseHash();
const routeListeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  route = parseHash();
  if (route.settings === null) sessionStorage.setItem('stg.lastPage', route.page + (route.query.toString() ? `?${route.query}` : ''));
  routeListeners.forEach(f => f());
});

export function useRoute() {
  return useSyncExternalStore(
    f => {
      routeListeners.add(f);
      return () => routeListeners.delete(f);
    },
    () => route
  );
}

export function go(path: string) {
  location.hash = `#/${path}`;
}

export function openSettings(section: string) {
  if (route.settings === null) sessionStorage.setItem('stg.lastPage', route.page + (route.query.toString() ? `?${route.query}` : ''));
  location.hash = `#/settings/${section}`;
}

export function pageQuery(page: string, q: Record<string, string>) {
  const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v));
  const s = p.toString();
  history.replaceState(null, '', `#/${page}${s ? `?${s}` : ''}`);
  route = parseHash();
  sessionStorage.setItem('stg.lastPage', page + (s ? `?${s}` : ''));
  routeListeners.forEach(f => f());
}

export function closeSettings() {
  location.hash = `#/${sessionStorage.getItem('stg.lastPage') ?? 'dashboard'}`;
}
