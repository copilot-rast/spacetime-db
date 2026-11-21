const VOID = new Set(['br', 'hr', 'input']);
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'select', 'option', 'title', 'head', 'xmp', 'noembed', 'noframes', 'plaintext', 'applet', 'canvas', 'audio', 'video', 'form', 'button']);
const ALLOWED = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'hr', 'br', 'ol', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'input', 'label', 'div']);
const ALIAS: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's' };
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});?/g, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return String.fromCharCode(0xfffd);
      return String.fromCodePoint(n);
    }
    const v = NAMED[e.toLowerCase()];
    return v ?? m;
  });
}

export function safeHref(raw: string) {
  const v = [...decodeEntities(raw)].filter(ch => { const c = ch.codePointAt(0)!; return c > 0x20 && !(c >= 0x7f && c <= 0x9f) && !(c >= 0x200b && c <= 0x200f) && c !== 0x2028 && c !== 0x2029 && c !== 0xfeff; }).join('');
  if (!v) return '';
  if (/^\/(?!\/)/.test(v)) return v;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  return '';
}

function parseAttrs(src: string) {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function cleanAttrs(tag: string, a: Record<string, string>) {
  const parts: string[] = [];
  const put = (k: string, v: string) => parts.push(`${k}="${escapeHtml(v)}"`);
  if (/^(p|h[1-6])$/.test(tag) && a.style) {
    const m = a.style.match(/^\s*text-align\s*:\s*(left|right|center|justify)\s*;?\s*$/i);
    if (m) put('style', `text-align: ${m[1].toLowerCase()}`);
  }
  if (tag === 'ol' && a.start && /^\d{1,6}$/.test(a.start)) put('start', a.start);
  if (tag === 'ul' && a['data-type'] === 'taskList') put('data-type', 'taskList');
  if (tag === 'li' && a['data-type'] === 'taskItem') {
    put('data-type', 'taskItem');
    put('data-checked', a['data-checked'] === 'true' ? 'true' : 'false');
  }
  if (tag === 'th' || tag === 'td') {
    for (const k of ['colspan', 'rowspan']) if (a[k] && /^\d{1,3}$/.test(a[k])) put(k, a[k]);
    if (a.colwidth && /^\d{1,5}(,\d{1,5})*$/.test(a.colwidth)) put('colwidth', a.colwidth);
  }
  if (tag === 'a') {
    const href = safeHref(a.href ?? '');
    if (href) put('href', href);
    put('target', '_blank');
    put('rel', 'noopener noreferrer nofollow');
  }
  if (tag === 'input') {
    parts.length = 0;
    parts.push('type="checkbox"', 'disabled');
    if ('checked' in a) parts.push('checked');
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function sanitizeHtml(input: string, maxLen = 200_000) {
  const src = input.slice(0, maxLen * 2);
  const out: string[] = [];
  const stack: string[] = [];
  let drop = '';
  let dropDepth = 0;
  let i = 0;
  const text = (s: string) => {
    if (!drop && s) out.push(escapeHtml(decodeEntities(s)));
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      text(src.slice(i));
      break;
    }
    text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(src.slice(lt, lt + 4000));
    if (!m) {
      text('<');
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const closing = m[1] === '/';
    let tag = m[2].toLowerCase();
    tag = ALIAS[tag] ?? tag;
    if (drop) {
      if (tag === drop) dropDepth += closing ? -1 : 1;
      if (dropDepth <= 0) drop = '';
      continue;
    }
    if (DROP.has(tag)) {
      if (!closing && !/\/\s*$/.test(m[3])) {
        drop = tag;
        dropDepth = 1;
      }
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (tag === 'input') {
      const a = parseAttrs(m[3]);
      if (closing || (a.type ?? '').toLowerCase() !== 'checkbox' || !stack.includes('li')) continue;
      out.push(`<input${cleanAttrs('input', a)}>`);
      continue;
    }
    if (VOID.has(tag)) {
      if (!closing) out.push(`<${tag}>`);
      continue;
    }
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (stack.length >= 64) continue;
    out.push(`<${tag}${cleanAttrs(tag, parseAttrs(m[3]))}>`);
    stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('').slice(0, maxLen);
}

export function htmlToText(html: string) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h[1-6]|li|tr|blockquote|pre|div)>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inline(s: string) {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => {
      const href = safeHref(u);
      return href ? `<a href="${href}">${t}</a>` : t;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(md: string) {
  const out: string[] = [];
  let list: string | undefined;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = undefined;
  };
  for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
      closeList();
    } else if (h) {
      flush();
      closeList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flush();
  closeList();
  return sanitizeHtml(out.join(''));
}

export function textToHtml(s: string) {
  return s
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function looksLikeHtml(s: string) {
  return /<\/?[a-zA-Z][a-zA-Z0-9]*(\s[^>]*)?>/.test(s);
}

export function xmlEscape(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
