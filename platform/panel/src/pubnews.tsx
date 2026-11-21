import { useEffect, useRef, useState } from 'react';
import {
  ArrowsClockwise,
  ChatCircleText,
  Check,
  Code,
  CodeBlock,
  Eraser,
  Eye,
  EyeSlash,
  LinkSimple,
  ListBullets,
  ListNumbers,
  MagnifyingGlass,
  Minus,
  Newspaper,
  PushPin,
  Question,
  Quotes,
  TerminalWindow,
  TextB,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  TextUnderline,
  Trash,
  WebhooksLogo,
  ClockCounterClockwise,
} from '@phosphor-icons/react';
import { getConn, useRows, useSnap, type RowOf } from './conn.ts';
import { codeText, date, digits, errorText, num, t, useLocale, type StrKey } from './i18n.ts';
import { pageQuery, run, runToast, toast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, Empty, ErrBox, Field, NumInput, Pager, Pop, Seg, Skel, SwitchRow, TableSkeleton, TrInputs, confirmAsk } from './ui.tsx';
import { TagPicker } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, PageHead, del, needTitle, save, useCatName } from './economy.tsx';
import { CatalogTable, Choice, WindowFields, useLoaded } from './kit.tsx';
import { CategoryPicker, PasswordInput } from './dialogs.tsx';
import { NotifyCategoryPick } from './pubnotify.tsx';

const PAGE = 20;

type NewsRow = RowOf<'adminNews'>;

export const NEWS_STATUS: [string, StrKey][] = [
  ['draft', 'nsDraft'],
  ['pending_review', 'nsPending'],
  ['published', 'nsPublished'],
  ['archived', 'nsArchived'],
  ['rejected', 'nsRejected'],
];

const MOVES: Record<string, string[]> = {
  draft: ['pending_review', 'published', 'archived'],
  pending_review: ['published', 'rejected', 'draft'],
  published: ['archived', 'draft'],
  rejected: ['draft', 'pending_review'],
  archived: ['draft', 'published'],
};

const MOVE_LABEL: Record<string, StrKey> = {
  pending_review: 'nmReview',
  published: 'nmPublish',
  archived: 'nmArchive',
  draft: 'nmDraft',
  rejected: 'nmReject',
};

const NOTIFY: [string, StrKey][] = [
  ['none', 'nnNone'],
  ['inbox', 'nnInbox'],
  ['push', 'nnPush'],
  ['both', 'nnBoth'],
];

export function newsBadge(s: string) {
  const cls = s === 'published' ? 'b-ok' : s === 'pending_review' ? 'b-warn' : s === 'rejected' ? 'b-bad' : s === 'archived' ? 'b-info' : '';
  const k = NEWS_STATUS.find(x => x[0] === s)?.[1];
  return <span className={`badge ${cls}`}>{k ? t(k) : s}</span>;
}

function usDate(v: bigint, withTime = true) {
  return v ? date(new Date(Number(v / 1000n)), withTime) : '—';
}

function microsInput(v: bigint) {
  if (!v) return 0n;
  return v;
}

export function RichEditor(props: { value: string; onChange: (v: string) => void; dir: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const [source, setSource] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (!source && ref.current && ref.current.innerHTML !== props.value) ref.current.innerHTML = props.value;
  }, [source]);
  const emit = () => props.onChange(ref.current?.innerHTML === '<br>' ? '' : (ref.current?.innerHTML ?? ''));
  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const tools: [string, React.ReactNode, () => void][] = [
    ['bold', <TextB className="ic" />, () => cmd('bold')],
    ['italic', <TextItalic className="ic" />, () => cmd('italic')],
    ['underline', <TextUnderline className="ic" />, () => cmd('underline')],
    ['strike', <TextStrikethrough className="ic" />, () => cmd('strikeThrough')],
    ['h2', <TextHTwo className="ic" />, () => cmd('formatBlock', 'h2')],
    ['h3', <TextHThree className="ic" />, () => cmd('formatBlock', 'h3')],
    ['ul', <ListBullets className="ic" />, () => cmd('insertUnorderedList')],
    ['ol', <ListNumbers className="ic" />, () => cmd('insertOrderedList')],
    ['quote', <Quotes className="ic" />, () => cmd('formatBlock', 'blockquote')],
    ['code', <CodeBlock className="ic" />, () => cmd('formatBlock', 'pre')],
    ['hr', <Minus className="ic" />, () => cmd('insertHorizontalRule')],
    ['clear', <Eraser className="ic" />, () => cmd('removeFormat')],
  ];
  const label: Record<string, StrKey> = {
    bold: 'edBold',
    italic: 'edItalic',
    underline: 'edUnderline',
    strike: 'edStrike',
    h2: 'edH2',
    h3: 'edH3',
    ul: 'edUl',
    ol: 'edOl',
    quote: 'edQuote',
    code: 'edCode',
    hr: 'edHr',
    clear: 'edClear',
  };
  return (
    <div className="editor" data-testid={props.testId}>
      <div className="editor-bar" role="toolbar" aria-label={t('edToolbar')}>
        {tools.map(([k, ic, fn]) => (
          <button
            type="button"
            key={k}
            className="btn btn-sm btn-icon"
            onMouseDown={keep}
            onClick={fn}
            disabled={source}
            aria-label={t(label[k])}
            title={t(label[k])}
            data-testid={props.testId ? `${props.testId}-${k}` : undefined}
          >
            {ic}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-sm btn-icon"
          onMouseDown={keep}
          disabled={source}
          aria-label={t('edLink')}
          title={t('edLink')}
          onClick={() => {
            const sel = window.getSelection();
            range.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
            setLink('https://');
          }}
        >
          <LinkSimple className="ic" />
        </button>
        <span className="grow" />
        <button type="button" className="btn btn-sm" aria-pressed={source} onClick={() => setSource(!source)} data-testid={props.testId ? `${props.testId}-source` : undefined}>
          <Code className="ic" />
          {t('edSource')}
        </button>
      </div>
      {link !== null && (
        <div className="editor-link">
          <input className="input ltr grow" value={link} onChange={e => setLink(e.target.value)} aria-label={t('edLink')} autoFocus />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              const sel = window.getSelection();
              ref.current?.focus();
              if (range.current && sel) {
                sel.removeAllRanges();
                sel.addRange(range.current);
              }
              if (link.trim()) cmd('createLink', link.trim());
              setLink(null);
            }}
          >
            {t('edApply')}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setLink(null)}>
            {t('cancel')}
          </button>
        </div>
      )}
      {source ? (
        <textarea
          className="editor-source ltr"
          value={props.value}
          onChange={e => props.onChange(e.target.value)}
          spellCheck={false}
          aria-label={t('edSource')}
          data-testid={props.testId ? `${props.testId}-html` : undefined}
        />
      ) : (
        <div
          ref={ref}
          className="editor-area prose"
          contentEditable
          suppressContentEditableWarning
          dir={props.dir}
          onInput={emit}
          onBlur={emit}
          role="textbox"
          aria-multiline="true"
          aria-label={t('nwBody')}
          data-testid={props.testId ? `${props.testId}-area` : undefined}
        />
      )}
    </div>
  );
}

function trGet(list: Tr[], lang: string) {
  return list.find(x => x.lang === lang)?.text ?? '';
}

function trSet(list: Tr[], lang: string, text: string) {
  const rest = list.filter(x => x.lang !== lang);
  return text ? [...rest, { lang, text }] : rest;
}

function NewsDialog(props: { row?: NewsRow; onClose: () => void }) {
  const r = props.row;
  const { def, active } = useLanguages();
  const langs = [...active].sort((a, b) => (a.code === def ? -1 : b.code === def ? 1 : 0));
  const [tab, setTab] = useState<'content' | 'publish' | 'seo'>('content');
  const [lang, setLang] = useState(def);
  const [status, setStatus] = useState(r?.status ?? 'draft');
  const [title, setTitle] = useState<Tr[]>(r?.title ?? []);
  const [summary, setSummary] = useState<Tr[]>(r?.summary ?? []);
  const [body, setBody] = useState<Tr[]>(r?.body ?? []);
  const [categoryId, setCategory] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [coverUrl, setCover] = useState(r?.coverUrl ?? '');
  const [isPinned, setPinned] = useState(r?.isPinned ?? false);
  const [win, setWin] = useState<[bigint, bigint]>([r?.publishedAt ?? 0n, r?.expiresAt ?? 0n]);
  const [allowComment, setAllowComment] = useState(r?.allowComment ?? true);
  const [freeComment, setFreeComment] = useState(r?.freeComment ?? false);
  const [allowReaction, setAllowReaction] = useState(r?.allowReaction ?? true);
  const [notifyMode, setNotify] = useState(r?.notifyMode ?? 'none');
  const [notifyTagIds, setNotifyTags] = useState<bigint[]>(r?.notifyTagIds ?? []);
  const [slug, setSlug] = useState(r?.slug ?? '');
  const [metaTitle, setMetaTitle] = useState<Tr[]>(r?.metaTitle ?? []);
  const [metaDescription, setMetaDescription] = useState<Tr[]>(r?.metaDescription ?? []);
  const [keywords, setKeywords] = useState((r?.keywords ?? []).join('، '));
  const [canonicalUrl, setCanonical] = useState(r?.canonicalUrl ?? '');
  const [ogImage, setOg] = useState(r?.ogImage ?? '');
  const [noindex, setNoindex] = useState(r?.noindex ?? false);
  const dir = active.find(l => l.code === lang)?.dir ?? 'rtl';
  const plain = (html: string) =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const seoTitle = trGet(metaTitle, def) || trGet(title, def);
  const seoDesc = trGet(metaDescription, def) || trGet(summary, def) || plain(trGet(body, def)).slice(0, 160);
  return (
    <FormDialog
      title={r ? t('nwEdit') : t('nwNew')}
      testId="nw-dialog"
      width={900}
      onClose={props.onClose}
      submit={async () =>
        needTitle(title, def) ??
        save(() =>
          getConn().reducers.adminSaveNews({
            id: r?.id ?? 0n,
            slug: slug.trim(),
            status,
            categoryId,
            tagIds,
            title,
            summary,
            body,
            coverUrl: coverUrl.trim(),
            isPinned,
            publishedAt: microsInput(win[0]),
            expiresAt: microsInput(win[1]),
            allowComment,
            freeComment,
            allowReaction,
            notifyMode,
            notifyTagIds,
            metaTitle,
            metaDescription,
            keywords: keywords
              .split(/[,،\n]+/)
              .map(x => x.trim())
              .filter(Boolean),
            canonicalUrl: canonicalUrl.trim(),
            ogImage: ogImage.trim(),
            noindex,
          })
        )
      }
    >
      <div className="span-2">
        <Seg
          value={tab}
          onChange={setTab}
          label={t('nwTabs')}
          options={[
            { value: 'content', label: t('nwTabContent') },
            { value: 'publish', label: t('nwTabPublish') },
            { value: 'seo', label: t('nwTabSeo') },
          ]}
        />
      </div>
      {tab === 'content' && (
        <div className="span-2 form-grid">
          <Field label={t('nwTitle')} required className="span-2">
            <TrInputs value={title} onChange={setTitle} required name="title" />
          </Field>
          <Field label={t('nwSummary')} className="span-2" hint={t('nwSummaryHint')}>
            <TrInputs value={summary} onChange={setSummary} multiline name="summary" />
          </Field>
          <Field label={t('nwBody')} className="span-2" hint={t('nwBodyHint')}>
            <div className="stack stack-sm">
              {langs.length > 1 && <Seg value={lang} onChange={setLang} label={t('stLanguages')} options={langs.map(l => ({ value: l.code, label: l.name }))} />}
              <RichEditor key={lang} value={trGet(body, lang)} onChange={v => setBody(trSet(body, lang, v))} dir={dir} testId="nw-body" />
            </div>
          </Field>
          <Field label={t('nwCover')} hint={t('brUrlHint')} className="span-2">
            <input className="input ltr" name="coverUrl" value={coverUrl} onChange={e => setCover(e.target.value)} placeholder="https://" />
          </Field>
        </div>
      )}
      {tab === 'publish' && (
        <div className="span-2 form-grid">
          {!r ? (
            <Field label={t('nwStartAs')}>
              <Choice
                value={status}
                onChange={setStatus}
                name="status"
                testId="nw-status"
                options={[
                  ['draft', 'nsDraft'],
                  ['pending_review', 'nsPending'],
                  ['published', 'nsPublished'],
                ]}
              />
            </Field>
          ) : (
            <Field label={t('status')} hint={t('nwStatusHint')}>
              <div>{newsBadge(r.status)}</div>
            </Field>
          )}
          <Field label={t('nwCategory')}>
            <CategoryPicker keyType="news" value={categoryId} onChange={setCategory} none={t('none')} label={t('nwCategory')} testId="nw-category" />
          </Field>
          <Field label={t('tags')} className="span-2">
            <TagPicker keyType="news" value={tagIds} onChange={setTags} testId="nw-tags" />
          </Field>
          <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
          <div className="span-2 stack stack-sm">
            <SwitchRow checked={isPinned} onChange={setPinned} label={t('nwPinned')} />
            <SwitchRow checked={allowReaction} onChange={setAllowReaction} label={t('nwAllowReaction')} />
            <SwitchRow checked={allowComment} onChange={setAllowComment} label={t('nwAllowComment')} />
            {allowComment && <SwitchRow checked={freeComment} onChange={setFreeComment} label={t('nwFreeComment')} />}
          </div>
          <div className="span-2 section-label" style={{ marginTop: 6 }}>
            {t('nwNotify')}
          </div>
          <Field label={t('nwNotifyMode')} hint={t('nwNotifyHint')}>
            <Choice value={notifyMode} onChange={setNotify} name="notifyMode" options={NOTIFY} testId="nw-notify" />
          </Field>
          {notifyMode !== 'none' ? (
            <Field label={t('nwNotifyTags')} hint={t('nwNotifyTagsHint')}>
              <TagPicker keyType="user" value={notifyTagIds} onChange={setNotifyTags} />
            </Field>
          ) : (
            <span />
          )}
        </div>
      )}
      {tab === 'seo' && (
        <div className="span-2 form-grid">
          <Field label={t('nwSlug')} hint={r ? t('nwSlugEditHint') : t('nwSlugHint')} className="span-2">
            <input className="input ltr" name="slug" value={slug} onChange={e => setSlug(e.target.value)} data-testid="nw-slug" />
          </Field>
          <Field label={t('nwMetaTitle')} className="span-2" hint={t('nwMetaTitleHint')}>
            <TrInputs value={metaTitle} onChange={setMetaTitle} name="metaTitle" />
          </Field>
          <Field label={t('nwMetaDesc')} className="span-2" hint={t('nwMetaDescHint')}>
            <TrInputs value={metaDescription} onChange={setMetaDescription} multiline name="metaDescription" />
          </Field>
          <Field label={t('nwKeywords')} hint={t('nwKeywordsHint')} className="span-2">
            <input className="input" name="keywords" value={keywords} onChange={e => setKeywords(e.target.value)} />
          </Field>
          <Field label={t('nwCanonical')} hint="https://">
            <input className="input ltr" name="canonicalUrl" value={canonicalUrl} onChange={e => setCanonical(e.target.value)} />
          </Field>
          <Field label={t('nwOgImage')} hint={t('nwOgHint')}>
            <input className="input ltr" name="ogImage" value={ogImage} onChange={e => setOg(e.target.value)} placeholder="https://" />
          </Field>
          <div className="span-2">
            <SwitchRow checked={noindex} onChange={setNoindex} label={t('nwNoindex')} />
          </div>
          <div className="span-2 serp" data-testid="nw-serp">
            <span className="serp-url ltr">/{slug || r?.slug || t('nwSlugAuto')}</span>
            <span className="serp-title">{seoTitle || t('nwTitle')}</span>
            <span className="serp-desc">{seoDesc || '—'}</span>
          </div>
        </div>
      )}
    </FormDialog>
  );
}

function RejectDialog(props: { rows: NewsRow[]; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog
      title={t('nmRejectTitle')}
      width={480}
      onClose={props.onClose}
      testId="nw-reject"
      foot={
        <>
          <span className="grow" />
          <button type="button" className="btn btn-outline" onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            data-testid="nw-reject-go"
            onClick={async () => {
              setBusy(true);
              const r = await run(c => c.reducers.adminReviewNews({ ids: props.rows.map(x => x.id), status: 'rejected', reason }), t('nmRejected'));
              setBusy(false);
              if (r.ok) props.onClose();
              else setErr(errorText(r.err));
            }}
          >
            {t('nmReject')}
          </button>
        </>
      }
    >
      <Field label={t('nmReason')} required hint={t('nmReasonHint')}>
        <textarea className="textarea" name="reason" value={reason} onChange={e => setReason(e.target.value)} autoFocus data-testid="nw-reason" />
      </Field>
      <ErrBox text={err} />
    </Dialog>
  );
}

function PreviewDialog(props: { row: NewsRow; onClose: () => void }) {
  const { def, active } = useLanguages();
  const langs = active.filter(l => props.row.title.some(x => x.lang === l.code) || props.row.body.some(x => x.lang === l.code));
  const [lang, setLang] = useState(langs.find(l => l.code === def)?.code ?? langs[0]?.code ?? def);
  const dir = active.find(l => l.code === lang)?.dir ?? 'rtl';
  return (
    <Dialog title={t('nwPreview')} width={760} onClose={props.onClose} testId="nw-preview">
      <div className="stack">
        {langs.length > 1 && <Seg value={lang} onChange={setLang} options={langs.map(l => ({ value: l.code, label: l.name }))} />}
        <span className="small muted">{t('nwPreviewHint')}</span>
        <article className="prose card card-pad" dir={dir} data-testid="nw-preview-body">
          {props.row.coverUrl && <img src={props.row.coverUrl} alt="" className="prose-cover" />}
          <h1>{trGet(props.row.title, lang)}</h1>
          {trGet(props.row.summary, lang) && <p className="muted">{trGet(props.row.summary, lang)}</p>}
          <div dangerouslySetInnerHTML={{ __html: trGet(props.row.body, lang) }} />
        </article>
      </div>
    </Dialog>
  );
}

function StatusMenu(props: { row: NewsRow; anchor: HTMLElement; onClose: () => void; onReject: () => void }) {
  const moves = MOVES[props.row.status] ?? [];
  return (
    <Pop anchor={props.anchor} onClose={props.onClose} align="end" testId="nw-moves">
      {moves.map(s => (
        <button
          type="button"
          key={s}
          className="pop-item"
          data-testid={`nw-move-${s}`}
          onClick={async () => {
            props.onClose();
            if (s === 'rejected') {
              props.onReject();
              return;
            }
            await runToast(c => c.reducers.adminReviewNews({ ids: [props.row.id], status: s, reason: '' }), t('nmDone'));
          }}
        >
          {newsBadge(s)}
          <span className="grow">{t(MOVE_LABEL[s])}</span>
        </button>
      ))}
    </Pop>
  );
}

export function News() {
  useLocale();
  const route = useRoute();
  const { can } = useSession();
  const { def } = useLanguages();
  const list = useRows('adminNews');
  const loaded = useLoaded();
  const catName = useCatName();
  const status = route.query.get('status') ?? '';
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 200).trim().toLowerCase();
  const [edit, setEdit] = useState<NewsRow | 'new' | null>(null);
  const [menu, setMenu] = useState<{ row: NewsRow; el: HTMLElement } | null>(null);
  const [reject, setReject] = useState<NewsRow | null>(null);
  const [preview, setPreview] = useState<NewsRow | null>(null);
  const rows = [...list]
    .filter(n => !status || n.status === status)
    .filter(n => !q || n.slug.toLowerCase().includes(q) || n.title.some(x => x.text.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || (a.updatedAt.microsSinceUnixEpoch < b.updatedAt.microsSinceUnixEpoch ? 1 : -1));
  const count = (s: string) => list.filter(n => n.status === s).length;
  const current = (r: NewsRow) => list.find(x => x.id === r.id) ?? r;
  return (
    <main className="page" data-testid="page-news">
      <PageHead title={t('navNews')} sub={num(list.length)} action={<AddButton label={t('nwNew')} onClick={() => setEdit('new')} testId="nw-add" />} />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('nwSearch')} aria-label={t('nwSearch')} data-testid="nw-search" />
        </div>
        <Seg
          value={status}
          onChange={v => pageQuery('news', { status: v })}
          label={t('status')}
          options={[{ value: '', label: t('all') }, ...NEWS_STATUS.map(([v, k]) => ({ value: v, label: `${t(k)} ${count(v) ? digits(count(v)) : ''}`.trim() }))]}
        />
      </div>
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="nw"
        keyOf={r => r.slug}
        empty={{ icon: <Newspaper className="ic" weight="duotone" />, title: t('nwEmpty') }}
        cardTitle={r => <b>{trText(r.title, def)}</b>}
        cols={[
          {
            label: t('nwTitle'),
            render: r => (
              <span className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span className="swatch" style={{ width: 36, height: 36, borderRadius: 6, flex: 'none', background: r.coverUrl ? `center / cover url(${r.coverUrl})` : 'var(--well-2)' }} />
                <span style={{ minWidth: 0 }}>
                  <span className="primary">
                    {r.isPinned && <PushPin className="ic" weight="fill" style={{ color: 'var(--accent)', marginInlineEnd: 4, verticalAlign: '-2px' }} aria-label={t('nwPinned')} />}
                    {trText(r.title, def)}
                  </span>
                  <div className="mono muted ellipsis" style={{ maxWidth: 280 }}>
                    {r.slug}
                  </div>
                </span>
              </span>
            ),
          },
          {
            label: t('status'),
            render: r => (
              <span className="stack" style={{ gap: 2 }}>
                {newsBadge(r.status)}
                {r.status === 'rejected' && r.rejectReason && <span className="small neg cell-detail">{r.rejectReason}</span>}
              </span>
            ),
          },
          { label: t('nwCategory'), render: r => <span className="small">{catName(r.categoryId)}</span> },
          {
            label: t('nwWhen'),
            render: r => (
              <span className="small stack" style={{ gap: 0 }}>
                <span>{usDate(r.publishedAt)}</span>
                {r.expiresAt ? <span className="muted">{t('nwUntil', { d: usDate(r.expiresAt, false) })}</span> : null}
              </span>
            ),
          },
          {
            label: t('nwSource'),
            render: r => (r.source.startsWith('webhook:') ? <span className="badge b-teal">{t('nwFromWebhook', { k: r.source.slice(8) })}</span> : <span className="small muted">{t('nwFromPanel')}</span>),
          },
        ]}
        extra={(r, card) => (
          <>
            {can('admin') && (MOVES[r.status] ?? []).length > 0 && (
              <button type="button" className="btn btn-sm btn-outline" onClick={e => setMenu({ row: r, el: e.currentTarget })} data-testid={card ? undefined : `nw-status-${r.slug}`}>
                <ArrowsClockwise className="ic" />
                {t('nwChangeStatus')}
              </button>
            )}
            <a className="btn btn-sm btn-icon" href={`#/news-comments?news=${r.id}`} aria-label={t('navNewsComments')} title={t('navNewsComments')} data-testid={card ? undefined : `nw-comments-${r.slug}`}>
              <ChatCircleText className="ic" />
            </a>
            <button type="button" className="btn btn-sm btn-icon" onClick={() => setPreview(r)} aria-label={t('nwPreview')} title={t('nwPreview')} data-testid={card ? undefined : `nw-preview-${r.slug}`}>
              <Eye className="ic" />
            </button>
          </>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: trText(r.title, def) || r.slug }), () => getConn().reducers.adminDeleteNews({ id: r.id }))}
      />
      {edit && <NewsDialog row={edit === 'new' ? undefined : current(edit)} onClose={() => setEdit(null)} />}
      {menu && <StatusMenu row={current(menu.row)} anchor={menu.el} onClose={() => setMenu(null)} onReject={() => setReject(menu.row)} />}
      {reject && <RejectDialog rows={[reject]} onClose={() => setReject(null)} />}
      {preview && <PreviewDialog row={current(preview)} onClose={() => setPreview(null)} />}
    </main>
  );
}

function ReactionSummary(props: { newsId: bigint }) {
  const types = useRows('reactionType');
  const { def } = useLanguages();
  const { data } = useFetch(
    () =>
      getConn()
        .procedures.newsGet({ id: props.newsId })
        .catch(() => null),
    [String(props.newsId)]
  );
  if (!data) return null;
  return (
    <div className="chips" data-testid="nc-reactions">
      <span className="small muted">{t('rcTotal', { n: num(data.reactionCount) })}</span>
      {data.reactions.map(x => {
        const ty = types.find(y => y.key === x.key);
        return (
          <span key={x.key} className="chip" title={trText(ty?.name, def) || x.key}>
            {ty?.emoji ?? x.key} {num(x.count)}
          </span>
        );
      })}
    </div>
  );
}

export function NewsComments() {
  useLocale();
  const route = useRoute();
  const news = useRows('adminNews');
  const { def } = useLanguages();
  const newsId = route.query.get('news') ?? '';
  const status = route.query.get('status') ?? 'pending';
  const [page, setPage] = useState(1);
  const { data, error, loading } = useFetch(() => getConn().procedures.adminNewsComments({ newsId: newsId ? BigInt(newsId) : 0n, status: status === 'all' ? '' : status, page, pageSize: PAGE }), [newsId, status, page]);
  const rows = data?.rows ?? [];
  const set = (q: Record<string, string>) => {
    setPage(1);
    pageQuery('news-comments', { news: newsId, status, ...q });
  };
  const title = (id: bigint) => {
    const n = news.find(x => x.id === id);
    return n ? trText(n.title, def) || n.slug : `#${digits(String(id))}`;
  };
  const article = newsId ? news.find(x => String(x.id) === newsId) : undefined;
  const badge = (s: string) => <span className={`badge ${s === 'accepted' ? 'b-ok' : 'b-warn'}`}>{s === 'accepted' ? t('cmtAccepted') : t('cmtPending')}</span>;
  const actions = (c: (typeof rows)[number], card = false) => (
    <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
      {c.status === 'pending' ? (
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => runToast(x => x.reducers.adminModerateComment({ id: c.id, accept: true }), t('cmtAcceptedOk'))}
          data-testid={card ? undefined : `cmt-accept-${c.id}`}
        >
          <Check className="ic" />
          {t('cmtAccept')}
        </button>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => runToast(x => x.reducers.adminModerateComment({ id: c.id, accept: false }), t('cmtHiddenOk'))} data-testid={card ? undefined : `cmt-hide-${c.id}`}>
          <EyeSlash className="ic" />
          {t('cmtHide')}
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-icon btn-danger-ghost"
        aria-label={t('delete')}
        title={t('delete')}
        onClick={() => del(t('cmtDeleteConfirm'), () => getConn().reducers.adminDeleteComment({ id: c.id }))}
        data-testid={card ? undefined : `cmt-del-${c.id}`}
      >
        <Trash className="ic" />
      </button>
    </span>
  );
  return (
    <main className="page" data-testid="page-news-comments">
      <PageHead title={article ? t('cmtOf', { title: title(article.id) }) : t('navNewsComments')} sub={data ? num(data.total) : <Skel w={40} h={10} />} />
      <div className="toolbar">
        <select className="select" style={{ width: 'auto', minWidth: 220, maxWidth: 320 }} value={newsId} onChange={e => set({ news: e.target.value })} aria-label={t('navNews')} data-testid="cmt-news">
          <option value="">{t('cmtAllNews')}</option>
          {[...news]
            .sort((a, b) => (a.id < b.id ? 1 : -1))
            .map(n => (
              <option key={String(n.id)} value={String(n.id)}>
                {trText(n.title, def) || n.slug}
              </option>
            ))}
        </select>
        <Seg
          value={status}
          onChange={v => set({ status: v })}
          label={t('status')}
          options={[
            { value: 'pending', label: t('cmtPending') },
            { value: 'accepted', label: t('cmtAccepted') },
            { value: 'all', label: t('all') },
          ]}
        />
        {article && <ReactionSummary newsId={article.id} />}
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <div className="table-wrap responsive">
        <table className="table" data-testid="cmt-table">
          <thead>
            <tr>
              <th>{t('cmtMessage')}</th>
              <th>{t('pyColPlayer')}</th>
              <th>{t('navNews')}</th>
              <th>{t('auColTime')}</th>
              <th>{t('status')}</th>
              <th className="end" aria-label={t('actions')} />
            </tr>
          </thead>
          <tbody>
            {loading && !data ? (
              <TableSkeleton cols={6} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <Empty icon={<ChatCircleText className="ic" weight="duotone" />} title={status === 'pending' ? t('cmtNoPending') : t('emptyList')} />
                </td>
              </tr>
            ) : (
              rows.map(c => (
                <tr key={String(c.id)} data-testid={`cmt-row-${c.id}`}>
                  <td style={{ maxWidth: 420 }}>
                    <span className="primary" style={{ whiteSpace: 'pre-wrap' }}>
                      {c.message}
                    </span>
                    {c.parentId ? <div className="small muted">{t('cmtReplyTo', { n: digits(String(c.parentId)) })}</div> : null}
                  </td>
                  <td>
                    <a className="row-link" href={`#/player?id=${c.accountId}`}>
                      #{digits(String(c.accountId))}
                    </a>
                  </td>
                  <td className="small">{title(c.newsId)}</td>
                  <td className="nowrap">{date(c.createdAt.toDate())}</td>
                  <td>{badge(c.status)}</td>
                  <td className="end">{actions(c)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="cards" data-testid="cmt-cards">
          {rows.map(c => (
            <div className="pcard" key={String(c.id)}>
              <div className="row">
                <span className="grow" style={{ whiteSpace: 'pre-wrap' }}>
                  {c.message}
                </span>
                {badge(c.status)}
              </div>
              <div className="pcard-meta">
                <span>{t('navNews')}</span>
                <span>{title(c.newsId)}</span>
                <span>{t('pyColPlayer')}</span>
                <span>#{digits(String(c.accountId))}</span>
                <span>{t('auColTime')}</span>
                <span>{date(c.createdAt.toDate())}</span>
              </div>
              {actions(c, true)}
            </div>
          ))}
        </div>
        {data && data.total > 0 && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      </div>
    </main>
  );
}

type SourceRow = RowOf<'adminNewsSources'>;

const MAP_SAMPLE = '{\n  "title": "headline",\n  "body": "content.html",\n  "cover": "image",\n  "externalId": "id"\n}';

function SourceDialog(props: { row?: SourceRow; onClose: () => void }) {
  const r = props.row;
  const { active, def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState(r?.name ?? '');
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [authMode, setAuth] = useState(r?.authMode ?? 'hmac');
  const [tokenHeader, setTokenHeader] = useState(r?.tokenHeader ?? 'x-news-token');
  const [signatureHeader, setSigHeader] = useState(r?.signatureHeader ?? 'x-news-signature');
  const [timestampHeader, setTsHeader] = useState(r?.timestampHeader ?? 'x-news-timestamp');
  const [skewSeconds, setSkew] = useState(r?.skewSeconds ?? 300);
  const [secret, setSecret] = useState('');
  const [itemsPath, setItemsPath] = useState(r?.itemsPath ?? '');
  const [mapping, setMapping] = useState(r?.mapping && r.mapping !== '{}' ? r.mapping : '');
  const [bodyFormat, setBodyFormat] = useState(r?.bodyFormat ?? 'auto');
  const [defaultCategoryId, setCategory] = useState<bigint>(r?.defaultCategoryId ?? 0n);
  const [defaultLang, setLang] = useState(r?.defaultLang || def);
  const [defaultTagIds, setTags] = useState<bigint[]>(r?.defaultTagIds ?? []);
  const [publishMode, setPublish] = useState(r?.publishMode ?? 'review');
  const [updateMode, setUpdate] = useState(r?.updateMode ?? 'update');
  const [rateLimitPerMinute, setRate] = useState(r?.rateLimitPerMinute ?? 60);
  const [notifyMode, setNotify] = useState(r?.notifyMode ?? 'none');
  const [allowComment, setAllowComment] = useState(r?.allowComment ?? true);
  const [allowReaction, setAllowReaction] = useState(r?.allowReaction ?? true);
  return (
    <FormDialog
      title={r ? t('srEdit') : t('srNew')}
      testId="sr-dialog"
      width={820}
      onClose={props.onClose}
      submit={async () =>
        save(() =>
          getConn().reducers.adminSaveNewsSource({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            name: name.trim(),
            isActive,
            authMode,
            tokenHeader: tokenHeader.trim(),
            signatureHeader: signatureHeader.trim(),
            timestampHeader: timestampHeader.trim(),
            skewSeconds,
            secret: secret.trim(),
            itemsPath: itemsPath.trim(),
            mapping: mapping.trim() || '{}',
            bodyFormat,
            defaultCategoryId,
            defaultLang,
            defaultTagIds,
            publishMode,
            updateMode,
            rateLimitPerMinute,
            notifyMode,
            allowComment,
            allowReaction,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('srKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('name')} required>
        <input className="input" name="name" value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('srSecurity')}
      </div>
      <Field label={t('srAuth')} className="span-2">
        <Seg
          value={authMode}
          onChange={setAuth}
          label={t('srAuth')}
          options={[
            { value: 'hmac', label: t('srHmac') },
            { value: 'token', label: t('srToken') },
          ]}
        />
      </Field>
      <Field label={t('srSecret')} required={!r} hint={r ? t('srSecretKeep', { hint: r.secretHint }) : t('srSecretHint')} className="span-2">
        <PasswordInput value={secret} onChange={setSecret} name="secret" generate />
      </Field>
      {authMode === 'token' ? (
        <Field label={t('srTokenHeader')}>
          <input className="input ltr" name="tokenHeader" value={tokenHeader} onChange={e => setTokenHeader(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field label={t('srSigHeader')}>
            <input className="input ltr" name="signatureHeader" value={signatureHeader} onChange={e => setSigHeader(e.target.value)} />
          </Field>
          <Field label={t('srTsHeader')}>
            <input className="input ltr" name="timestampHeader" value={timestampHeader} onChange={e => setTsHeader(e.target.value)} />
          </Field>
          <Field label={t('srSkew')} hint={t('srSkewHint')}>
            <NumInput value={skewSeconds} onChange={setSkew} name="skewSeconds" />
          </Field>
        </>
      )}
      <Field label={t('srRate')} hint={t('zeroNoLimit')}>
        <NumInput value={rateLimitPerMinute} onChange={setRate} name="rateLimitPerMinute" />
      </Field>
      {authMode === 'token' && <span />}
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('srMapping')}
      </div>
      <Field label={t('srItemsPath')} hint={t('srItemsPathHint')}>
        <input className="input ltr" name="itemsPath" value={itemsPath} onChange={e => setItemsPath(e.target.value)} placeholder="data.items" />
      </Field>
      <Field label={t('srBodyFormat')}>
        <Choice
          value={bodyFormat}
          onChange={setBodyFormat}
          name="bodyFormat"
          options={[
            ['auto', 'bfAuto'],
            ['html', 'bfHtml'],
            ['markdown', 'bfMarkdown'],
            ['text', 'bfText'],
          ]}
        />
      </Field>
      <Field label={t('srMap')} hint={t('srMapHint')} className="span-2">
        <textarea className="textarea ltr mono" name="mapping" rows={5} value={mapping} onChange={e => setMapping(e.target.value)} placeholder={MAP_SAMPLE} spellCheck={false} />
      </Field>
      <div className="span-2 section-label" style={{ marginTop: 6 }}>
        {t('srDefaults')}
      </div>
      <Field label={t('srPublish')}>
        <Choice
          value={publishMode}
          onChange={setPublish}
          name="publishMode"
          options={[
            ['review', 'srPublishReview'],
            ['publish', 'srPublishNow'],
          ]}
        />
      </Field>
      <Field label={t('srUpdate')}>
        <Choice
          value={updateMode}
          onChange={setUpdate}
          name="updateMode"
          options={[
            ['update', 'srUpdateYes'],
            ['ignore', 'srUpdateNo'],
          ]}
        />
      </Field>
      <Field label={t('nwCategory')}>
        <CategoryPicker keyType="news" value={defaultCategoryId} onChange={setCategory} none={t('none')} label={t('nwCategory')} />
      </Field>
      <Field label={t('srLang')}>
        <select className="select" value={defaultLang} onChange={e => setLang(e.target.value)} name="defaultLang" aria-label={t('srLang')}>
          {active.map(l => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="news" value={defaultTagIds} onChange={setTags} />
      </Field>
      <Field label={t('nwNotifyMode')}>
        <Choice value={notifyMode} onChange={setNotify} name="notifyMode" options={NOTIFY} />
      </Field>
      <span />
      <div className="span-2 stack stack-sm">
        <SwitchRow checked={allowReaction} onChange={setAllowReaction} label={t('nwAllowReaction')} />
        <SwitchRow checked={allowComment} onChange={setAllowComment} label={t('nwAllowComment')} />
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function useRouteBase() {
  const cfg = useSnap().cfg;
  if (!cfg) return '';
  const http = cfg.server.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  return `${http}v1/database/${encodeURIComponent(cfg.db)}/route/publication`;
}

function nest(path: string, value: unknown): unknown {
  return path ? path.split('.').reduceRight<unknown>((acc, k) => ({ [k.replace(/\[\d+\]$/, '')]: acc }), value) : value;
}

function SampleDialog(props: { row: SourceRow; onClose: () => void }) {
  const base = useRouteBase();
  const s = props.row;
  const url = `${base}/news/ingest?source=${encodeURIComponent(s.key)}`;
  const item = { id: 'post-1', title: t('srSampleTitle'), summary: t('srSampleSummary'), body: '<p>…</p>', cover: 'https://example.com/cover.jpg', tags: ['update'], publishedAt: '2026-01-01T09:00:00Z' };
  const body = JSON.stringify(nest(s.itemsPath, [item]));
  const curl =
    s.authMode === 'hmac'
      ? `SECRET='…'\nBODY='${body}'\nTS=$(date +%s)\nSIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')\ncurl -X POST '${url}' \\\n  -H 'content-type: application/json' \\\n  -H "${s.timestampHeader}: $TS" \\\n  -H "${s.signatureHeader}: sha256=$SIG" \\\n  --data "$BODY"`
      : `SECRET='…'\ncurl -X POST '${url}' \\\n  -H 'content-type: application/json' \\\n  -H "${s.tokenHeader}: $SECRET" \\\n  --data '${body}'`;
  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      toast('ok', t('copied'));
    } catch {
      toast('bad', codeText('UNKNOWN'));
    }
  };
  return (
    <Dialog title={t('srSampleOf', { name: s.name || s.key })} width={760} onClose={props.onClose} testId="sr-sample">
      <div className="stack">
        <Field label={t('srUrl')}>
          <div className="input-group">
            <input className="input ltr mono grow" readOnly value={url} data-testid="sr-url" aria-label={t('srUrl')} />
            <button type="button" className="btn btn-outline" style={{ height: 36 }} onClick={() => copy(url)}>
              {t('copy')}
            </button>
          </div>
        </Field>
        {s.authMode === 'hmac' && <pre className="pre ltr">{'signature = hex(HMAC-SHA256(secret, timestamp + "." + body))'}</pre>}
        <span className="small sub">{s.authMode === 'hmac' ? t('srHmacHelp', { ts: s.timestampHeader, sig: s.signatureHeader, skew: s.skewSeconds }) : t('srTokenHelp', { h: s.tokenHeader })}</span>
        <div className="row">
          <span className="section-label grow">{t('srCurl')}</span>
          <button type="button" className="btn btn-sm" onClick={() => copy(curl)} data-testid="sr-copy-curl">
            {t('copy')}
          </button>
        </div>
        <pre className="pre ltr" data-testid="sr-curl">
          {curl}
        </pre>
        <span className="small muted">{t('srSecretNote', { hint: s.secretHint })}</span>
      </div>
    </Dialog>
  );
}

function logBadge(s: string) {
  const cls = s === 'created' || s === 'updated' ? 'b-ok' : s === 'error' || s === 'rejected' ? 'b-bad' : s === 'ignored' ? 'b-warn' : '';
  const k: Record<string, StrKey> = { created: 'lgCreated', updated: 'lgUpdated', unchanged: 'lgUnchanged', ignored: 'lgIgnored', error: 'lgError', rejected: 'lgRejected' };
  return <span className={`badge ${cls}`}>{k[s] ? t(k[s]) : s}</span>;
}

function LogDialog(props: { row: SourceRow; onClose: () => void }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<bigint | null>(null);
  const { data, error } = useFetch(() => getConn().procedures.adminIngestLog({ sourceId: props.row.id, status, page, pageSize: 10 }), [String(props.row.id), status, page]);
  return (
    <Dialog title={t('srLogOf', { name: props.row.name || props.row.key })} width={820} onClose={props.onClose} testId="sr-log">
      <div className="stack">
        <select
          className="select"
          style={{ width: 'auto', alignSelf: 'flex-start', minWidth: 160 }}
          value={status}
          onChange={e => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label={t('status')}
        >
          <option value="">{t('pyAllStatus')}</option>
          {['created', 'updated', 'unchanged', 'ignored', 'error', 'rejected'].map(s => (
            <option key={s} value={s}>
              {t(({ created: 'lgCreated', updated: 'lgUpdated', unchanged: 'lgUnchanged', ignored: 'lgIgnored', error: 'lgError', rejected: 'lgRejected' } as Record<string, StrKey>)[s])}
            </option>
          ))}
        </select>
        <ErrBox text={error ? errorText(error) : null} />
        <div className="card">
          {!data ? (
            <div className="card-pad">
              <Skel h={60} r={6} />
            </div>
          ) : data.rows.length === 0 ? (
            <Empty icon={<ClockCounterClockwise className="ic" weight="duotone" />} title={t('srNoLog')} />
          ) : (
            <>
              <div className="list" data-testid="sr-log-list">
                {data.rows.map(l => (
                  <div key={String(l.id)}>
                    <button
                      type="button"
                      className="list-row"
                      style={{ width: '100%', border: 0, background: 'none', textAlign: 'start', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                      onClick={() => setOpen(open === l.id ? null : l.id)}
                      aria-expanded={open === l.id}
                    >
                      {logBadge(l.status)}
                      <div className="list-main">
                        <span className="list-title">{l.code ? codeText(l.code) : t('srCounts', { c: l.created, u: l.updated, n: l.unchanged, i: l.ignored, f: l.failed })}</span>
                        <span className="list-sub">
                          HTTP {digits(l.httpStatus)} · {date(l.at.toDate())}
                        </span>
                      </div>
                    </button>
                    {open === l.id && (
                      <div className="card-pad stack stack-sm">
                        {l.results && <pre className="pre ltr">{pretty(l.results)}</pre>}
                        {l.body && (
                          <>
                            <span className="section-label">{t('srBody')}</span>
                            <pre className="pre ltr">{pretty(l.body)}</pre>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Pager page={page} pageSize={10} total={data.total} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function NewsSources() {
  useLocale();
  const list = useRows('adminNewsSources');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<SourceRow | 'new' | null>(null);
  const [sample, setSample] = useState<SourceRow | null>(null);
  const [log, setLog] = useState<SourceRow | null>(null);
  const rows = [...list].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-news-sources">
      <PageHead title={t('navNewsSources')} sub={t('srSub')} action={<AddButton label={t('srNew')} onClick={() => setEdit('new')} testId="sr-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="sr"
        keyOf={r => r.key}
        empty={{ icon: <WebhooksLogo className="ic" weight="duotone" />, title: t('srEmpty') }}
        cardTitle={r => <b>{r.name || r.key}</b>}
        cols={[
          {
            label: t('name'),
            render: r => (
              <>
                <span className="primary">{r.name || r.key}</span>
                <div className="mono muted">{r.key}</div>
              </>
            ),
          },
          {
            label: t('srAuth'),
            render: r => (
              <span className="stack" style={{ gap: 0 }}>
                <span>{r.authMode === 'hmac' ? t('srHmac') : t('srToken')}</span>
                <span className="mono small muted" data-testid={`sr-hint-${r.key}`}>
                  {r.secretHint}
                </span>
              </span>
            ),
          },
          { label: t('srPublish'), render: r => (r.publishMode === 'publish' ? t('srPublishNow') : t('srPublishReview')) },
          { label: t('srLast'), render: r => <span className="small">{r.lastReceivedAt ? date(new Date(Number(r.lastReceivedAt / 1000n))) : t('srNever')}</span> },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <>
            <button type="button" className="btn btn-sm" onClick={() => setSample(r)} data-testid={card ? undefined : `sr-sample-${r.key}`}>
              <TerminalWindow className="ic" />
              {t('srSample')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setLog(r)} data-testid={card ? undefined : `sr-log-${r.key}`}>
              <ClockCounterClockwise className="ic" />
              {t('srLog')}
            </button>
          </>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteNewsSource({ id: r.id }))}
      />
      {edit && <SourceDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {sample && <SampleDialog row={sample} onClose={() => setSample(null)} />}
      {log && <LogDialog row={log} onClose={() => setLog(null)} />}
    </main>
  );
}

type FaqRow = RowOf<'adminFaqs'>;

function FaqDialog(props: { row?: FaqRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [categoryId, setCategory] = useState<bigint>(r?.categoryId ?? 0n);
  const [question, setQuestion] = useState<Tr[]>(r?.question ?? []);
  const [answer, setAnswer] = useState<Tr[]>(r?.answer ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('fqEdit') : t('fqNew')}
      testId="fq-dialog"
      width={720}
      onClose={props.onClose}
      submit={async () => needTitle(question, def) ?? needTitle(answer, def) ?? save(() => getConn().reducers.adminSaveFaq({ id: r?.id ?? 0n, categoryId, question, answer, isActive, sort }))}
    >
      <Field label={t('fqCategory')}>
        <CategoryPicker keyType="faq" value={categoryId} onChange={setCategory} none={t('none')} label={t('fqCategory')} testId="fq-category" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <Field label={t('fqQuestion')} required className="span-2">
        <TrInputs value={question} onChange={setQuestion} required name="question" />
      </Field>
      <Field label={t('fqAnswer')} required className="span-2" hint={t('fqAnswerHint')}>
        <TrInputs value={answer} onChange={setAnswer} required multiline name="answer" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function Faq() {
  useLocale();
  const { def } = useLanguages();
  const list = useRows('adminFaqs');
  const loaded = useLoaded();
  const catName = useCatName();
  const [edit, setEdit] = useState<FaqRow | 'new' | null>(null);
  const [view, setView] = useState<FaqRow | null>(null);
  const [cat, setCat] = useState<bigint>(0n);
  const rows = [...list].filter(f => !cat || f.categoryId === cat).sort((a, b) => a.sort - b.sort || (a.id < b.id ? -1 : 1));
  return (
    <main className="page" data-testid="page-faq">
      <PageHead title={t('navFaq')} sub={num(list.length)} action={<AddButton label={t('fqNew')} onClick={() => setEdit('new')} testId="fq-add" />} />
      <div className="toolbar">
        <div style={{ width: 260 }}>
          <CategoryPicker keyType="faq" value={cat} onChange={setCat} none={t('fqAllCats')} label={t('fqCategory')} testId="fq-filter" />
        </div>
      </div>
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="fq"
        keyOf={r => String(r.id)}
        empty={{ icon: <Question className="ic" weight="duotone" />, title: t('fqEmpty') }}
        cardTitle={r => <b>{trText(r.question, def)}</b>}
        cols={[
          { label: t('fqQuestion'), render: r => <span className="primary">{trText(r.question, def)}</span> },
          { label: t('fqCategory'), render: r => <span className="small">{catName(r.categoryId)}</span> },
          {
            label: t('fqAnswer'),
            render: r => (
              <span className="small muted cell-detail" style={{ display: 'inline-block' }}>
                {trText(r.answer, def)}
              </span>
            ),
          },
          { label: t('sort'), render: r => digits(r.sort) },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        extra={(r, card) => (
          <button type="button" className="btn btn-sm btn-icon" onClick={() => setView(r)} aria-label={t('nwPreview')} title={t('nwPreview')} data-testid={card ? undefined : `fq-view-${r.id}`}>
            <Eye className="ic" />
          </button>
        )}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: trText(r.question, def) }), () => getConn().reducers.adminDeleteFaq({ id: r.id }))}
      />
      {edit && <FaqDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {view && (
        <Dialog title={trText(view.question, def)} width={640} onClose={() => setView(null)} testId="fq-preview">
          <span className="small muted">{t('fqPreviewHint')}</span>
          <div className="prose card card-pad" data-testid="fq-preview-body" dangerouslySetInnerHTML={{ __html: trText(view.answerHtml, def) }} />
        </Dialog>
      )}
    </main>
  );
}
