import { useEffect, useState } from 'react';
import { ArrowSquareOut, Lightning, PencilSimple, Plus, Smiley, Trash } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { errorText, num, t, type StrKey } from './i18n.ts';
import { run, runToast, toast, trText, useLanguages } from './app.ts';
import { Empty, ErrBox, Field, NumInput, SaveButton, Skel, Switch, SwitchRow, TrInputs, Notice } from './ui.tsx';
import { Section } from './widgets.tsx';
import { Choice } from './kit.tsx';
import { FormDialog, del, save } from './economy.tsx';
import { TestClock } from './settings3.tsx';
import { NotifyCategoryPick } from './pubnotify.tsx';
import { useRouteBase } from './pubnews.tsx';

function FormSkel(props: { n: number }) {
  return (
    <div className="form-grid">
      {Array.from({ length: props.n }).map((_, i) => (
        <div className="field" key={i}>
          <Skel w={90} h={10} />
          <Skel h={36} r={6} />
        </div>
      ))}
    </div>
  );
}

function useSaver() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go(fn: () => Promise<unknown>) {
    setBusy(true);
    const r = await run(() => fn(), t('saved'));
    setBusy(false);
    setErr(r.ok ? null : errorText(r.err));
  }
  return { busy, err, go };
}

function SaveBar(props: { busy: boolean; err: string | null; testId: string }) {
  return (
    <>
      <ErrBox text={props.err} />
      <div className="form-actions">
        <SaveButton busy={props.busy} testId={props.testId} />
      </div>
    </>
  );
}

const PUB_FIELDS: [string, StrKey, StrKey][] = [
  ['inboxKeepDays', 'psInboxKeep', 'psInboxKeepHint'],
  ['inboxMaxPerPlayer', 'psInboxMax', 'psZeroOff'],
  ['capPerDay', 'psCapDay', 'psCapDayHint'],
  ['capPerWeek', 'psCapWeek', 'psCapWeekHint'],
  ['maxDevices', 'psMaxDevices', 'psMaxDevicesHint'],
  ['pushRetries', 'psRetries', 'psRetriesHint'],
  ['smsMaxChars', 'psSmsMax', 'psSmsMaxHint'],
  ['liveNoticeMinutes', 'psLiveNotice', 'psLiveNoticeHint'],
  ['inactiveScanMinutes', 'psInactiveScan', 'psInactiveScanHint'],
  ['batchSize', 'psBatch', 'psBatchHint'],
  ['batchesPerTick', 'psBatches', 'psBatchesHint'],
  ['devicePerMinute', 'psDeviceRate', 'psRateHint'],
  ['prefsPerMinute', 'psPrefsRate', 'psRateHint'],
  ['inboxPerMinute', 'psInboxRate', 'psRateHint'],
];

export function PubSettingsSection(props: { ro: boolean }) {
  const s = useRows('adminPublicationSettings')[0];
  const [v, setV] = useState<Record<string, number> | null>(null);
  const f = useSaver();
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (s && !v) setV(Object.fromEntries(PUB_FIELDS.map(([k]) => [k, Number((s as unknown as Record<string, number>)[k])])));
  }, [s, v]);
  if (!v || !s) return <FormSkel n={8} />;
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() => Promise.resolve().then(() => getConn().reducers.adminSavePublicationSettings(v as never)));
        }}
      >
        <Section title={t('psInbox')}>
          <div className="form-grid">
            {PUB_FIELDS.slice(0, 2).map(([k, l, h]) => (
              <Field key={k} label={t(l)} hint={t(h)}>
                <NumInput value={v[k]} onChange={x => setV({ ...v, [k]: x })} disabled={props.ro} name={k} />
              </Field>
            ))}
          </div>
        </Section>
        <Section title={t('psDelivery')}>
          <div className="form-grid">
            {PUB_FIELDS.slice(2, 9).map(([k, l, h]) => (
              <Field key={k} label={t(l)} hint={t(h)}>
                <NumInput value={v[k]} onChange={x => setV({ ...v, [k]: x })} disabled={props.ro} name={k} />
              </Field>
            ))}
          </div>
        </Section>
        <Section title={t('psWorker')}>
          <div className="form-grid">
            {PUB_FIELDS.slice(9).map(([k, l, h]) => (
              <Field key={k} label={t(l)} hint={t(h)}>
                <NumInput value={v[k]} onChange={x => setV({ ...v, [k]: x })} disabled={props.ro} name={k} />
              </Field>
            ))}
          </div>
        </Section>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="pubs-save" />}
      </form>
      {!props.ro && (
        <Notice
          icon={<Lightning className="ic" />}
          title={t('psRunTitle')}
          text={t('psRunHint')}
          action={
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={running}
              data-testid="pubs-run"
              onClick={async () => {
                setRunning(true);
                const r = await run(c => c.procedures.adminPublicationRun({}));
                setRunning(false);
                if (r.ok) toast('ok', t('psRunDone', { b: r.value.batches, f: r.value.fires, o: r.value.outbox }));
                else toast('bad', errorText(r.err));
              }}
            >
              {t('psRun')}
            </button>
          }
        />
      )}
      {!props.ro && <TestClock value={s.clockOffsetSec} testId="pubs-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetPublicationClockOffset({ seconds: sec }))} />}
    </div>
  );
}

type NewsSettingsRow = RowOf<'adminNewsSettings'>;

function newsArgs(s: NewsSettingsRow) {
  return {
    commentsPerMinute: s.commentsPerMinute,
    reactionsPerMinute: s.reactionsPerMinute,
    listPerMinute: s.listPerMinute,
    unreadScope: s.unreadScope,
    showExpired: s.showExpired,
    fillDefaultLang: s.fillDefaultLang,
    realtimeOnPublish: s.realtimeOnPublish,
    notifyCategoryKey: s.notifyCategoryKey,
    logRetentionDays: s.logRetentionDays,
    logPayloadBytes: s.logPayloadBytes,
    ingestMaxKb: s.ingestMaxKb,
    slugStyle: s.slugStyle,
    publicEnabled: s.publicEnabled,
    publicBaseUrl: s.publicBaseUrl,
    publicPath: s.publicPath,
    rssEnabled: s.rssEnabled,
    publicCacheSeconds: s.publicCacheSeconds,
    siteTitle: s.siteTitle,
  };
}

type NewsArgs = ReturnType<typeof newsArgs>;

function useNewsForm() {
  const s = useRows('adminNewsSettings')[0];
  const [v, setV] = useState<NewsArgs | null>(null);
  useEffect(() => {
    if (s && !v) setV(newsArgs(s));
  }, [s, v]);
  return { s, v, setV };
}

export function NewsSettingsSection(props: { ro: boolean }) {
  const { s, v, setV } = useNewsForm();
  const f = useSaver();
  if (!v || !s) return <FormSkel n={8} />;
  const up = (p: Partial<NewsArgs>) => setV({ ...v, ...p });
  const n = (k: keyof NewsArgs, label: StrKey, hint?: StrKey) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <NumInput value={Number(v[k])} onChange={x => up({ [k]: x } as Partial<NewsArgs>)} disabled={props.ro} name={k} />
    </Field>
  );
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() => Promise.resolve().then(() => getConn().reducers.adminSaveNewsSettings(v)));
        }}
      >
        <Section title={t('nsPlayers')}>
          <div className="form-grid">
            <Field label={t('nsUnread')} hint={t('nsUnreadHint')}>
              <Choice
                value={v.unreadScope}
                onChange={x => up({ unreadScope: x })}
                name="unreadScope"
                options={[
                  ['signup', 'nsUnreadSignup'],
                  ['all', 'nsUnreadAll'],
                ]}
              />
            </Field>
            <Field label={t('nsSlug')} hint={t('nsSlugHint')}>
              <Choice
                value={v.slugStyle}
                onChange={x => up({ slugStyle: x })}
                name="slugStyle"
                options={[
                  ['native', 'nsSlugNative'],
                  ['latin', 'nsSlugLatin'],
                  ['id', 'nsSlugId'],
                ]}
              />
            </Field>
            <Field label={t('nsNotifyCat')} hint={t('nsNotifyCatHint')}>
              <NotifyCategoryPick value={v.notifyCategoryKey} onChange={x => up({ notifyCategoryKey: x })} testId="nss-category" />
            </Field>
            <span />
            <div className="span-2 stack stack-sm">
              <SwitchRow checked={v.showExpired} onChange={x => up({ showExpired: x })} disabled={props.ro} label={t('nsShowExpired')} />
              <SwitchRow checked={v.realtimeOnPublish} onChange={x => up({ realtimeOnPublish: x })} disabled={props.ro} label={t('nsRealtime')} />
              <SwitchRow checked={v.fillDefaultLang} onChange={x => up({ fillDefaultLang: x })} disabled={props.ro} label={t('nsFillDefault')} />
            </div>
          </div>
        </Section>
        <Section title={t('nsLimits')}>
          <div className="form-grid">
            {n('commentsPerMinute', 'nsComments', 'zeroNoLimit')}
            {n('reactionsPerMinute', 'nsReactions', 'zeroNoLimit')}
            {n('listPerMinute', 'nsList', 'zeroNoLimit')}
            {n('ingestMaxKb', 'nsIngestKb', 'nsIngestKbHint')}
            {n('logRetentionDays', 'nsLogDays', 'nsLogDaysHint')}
            {n('logPayloadBytes', 'nsLogBytes', 'nsLogBytesHint')}
          </div>
        </Section>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="nss-save" />}
      </form>
      <ReactionTypes ro={props.ro} />
    </div>
  );
}

type ReactionRow = RowOf<'reactionType'>;

function ReactionDialog(props: { row?: ReactionRow; onClose: () => void }) {
  const r = props.row;
  const [key, setKey] = useState(r?.key ?? '');
  const [emoji, setEmoji] = useState(r?.emoji ?? '');
  const [name, setName] = useState(r?.name ?? []);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('rxEdit') : t('rxNew')}
      testId="rt-dialog"
      width={480}
      onClose={props.onClose}
      submit={() => save(() => getConn().reducers.adminSaveReactionType({ key: key.trim().toLowerCase(), emoji: emoji.trim(), name, isActive, sort }))}
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('rxEmoji')} required>
        <input className="input" name="emoji" value={emoji} onChange={e => setEmoji(e.target.value)} style={{ fontSize: 18 }} />
      </Field>
      <Field label={t('name')} className="span-2">
        <TrInputs value={name} onChange={setName} name="name" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

function ReactionTypes(props: { ro: boolean }) {
  const list = useRows('reactionType');
  const { def } = useLanguages();
  const [edit, setEdit] = useState<ReactionRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <Section
      title={t('rxTitle')}
      pad={false}
      testId="rt-section"
      action={
        !props.ro && (
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setEdit('new')} data-testid="rt-add">
            <Plus className="ic" />
            {t('rxNew')}
          </button>
        )
      }
    >
      {rows.length === 0 ? (
        <Empty icon={<Smiley className="ic" weight="duotone" />} title={t('emptyList')} />
      ) : (
        <div className="list" data-testid="rt-list">
          {rows.map(r => (
            <div className="list-row" key={r.key} data-testid={`rt-row-${r.key}`}>
              <span style={{ fontSize: 20, width: 28, textAlign: 'center' }} aria-hidden="true">
                {r.emoji}
              </span>
              <div className="list-main">
                <span className="list-title">{trText(r.name, def) || r.key}</span>
                <span className="list-sub mono">{r.key}</span>
              </div>
              <Switch
                checked={r.isActive}
                disabled={props.ro}
                label={t('active')}
                testId={`rt-active-${r.key}`}
                onChange={x => runToast(c => c.reducers.adminSaveReactionType({ key: r.key, emoji: r.emoji, name: r.name, isActive: x, sort: r.sort }), t('saved'))}
              />
              {!props.ro && (
                <div className="row-actions">
                  <button type="button" className="btn btn-sm btn-icon" onClick={() => setEdit(r)} aria-label={t('edit')} title={t('edit')} data-testid={`rt-edit-${r.key}`}>
                    <PencilSimple className="ic" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-icon btn-danger-ghost"
                    onClick={() => del(t('rxDeleteConfirm', { name: r.key }), () => getConn().reducers.adminDeleteReactionType({ key: r.key }))}
                    aria-label={t('delete')}
                    title={t('delete')}
                    data-testid={`rt-del-${r.key}`}
                  >
                    <Trash className="ic" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {edit && <ReactionDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

export function PublicFeedsSection(props: { ro: boolean }) {
  const { s, v, setV } = useNewsForm();
  const f = useSaver();
  const base = useRouteBase();
  const { def } = useLanguages();
  const news = useRows('adminNews');
  if (!v || !s) return <FormSkel n={5} />;
  const up = (p: Partial<NewsArgs>) => setV({ ...v, ...p });
  const sample = news.find(n => n.status === 'published' && !n.noindex);
  const links: [StrKey, string, boolean][] = [
    ['pfJson', `${base}/public/news?lang=${def}&limit=20`, s.publicEnabled],
    ['pfArticle', `${base}/public/article?slug=${encodeURIComponent(sample?.slug ?? 'slug')}&lang=${def}`, s.publicEnabled],
    ['pfSitemap', `${base}/public/sitemap`, s.publicEnabled],
    ['pfRss', `${base}/public/rss`, s.publicEnabled && s.rssEnabled],
  ];
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() =>
            Promise.resolve().then(() =>
              getConn().reducers.adminSaveNewsSettings({
                ...newsArgs(s),
                publicEnabled: v.publicEnabled,
                publicBaseUrl: v.publicBaseUrl.trim(),
                publicPath: v.publicPath.trim(),
                rssEnabled: v.rssEnabled,
                publicCacheSeconds: v.publicCacheSeconds,
                siteTitle: v.siteTitle,
              })
            )
          );
        }}
      >
        <Section title={t('pfSite')}>
          <div className="form-grid">
            <div className="span-2 stack stack-sm">
              <SwitchRow checked={v.publicEnabled} onChange={x => up({ publicEnabled: x })} disabled={props.ro} label={t('pfEnabled')} testId="pf-enabled" />
              <span className="hint">{t('pfEnabledHint')}</span>
            </div>
            <Field label={t('pfBase')} hint={t('pfBaseHint')} required={v.publicEnabled}>
              <input className="input ltr" name="publicBaseUrl" value={v.publicBaseUrl} onChange={e => up({ publicBaseUrl: e.target.value })} disabled={props.ro} placeholder="https://example.com" data-testid="pf-base" />
            </Field>
            <Field label={t('pfPath')} hint={t('pfPathHint')}>
              <input className="input ltr" name="publicPath" value={v.publicPath} onChange={e => up({ publicPath: e.target.value })} disabled={props.ro} />
            </Field>
            <Field label={t('pfCache')} hint={t('pfCacheHint')}>
              <NumInput value={v.publicCacheSeconds} onChange={x => up({ publicCacheSeconds: x })} disabled={props.ro} name="publicCacheSeconds" />
            </Field>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <SwitchRow checked={v.rssEnabled} onChange={x => up({ rssEnabled: x })} disabled={props.ro} label={t('pfRssOn')} testId="pf-rss" />
            </div>
            <Field label={t('pfSiteTitle')} hint={t('pfSiteTitleHint')} className="span-2">
              <TrInputs value={v.siteTitle} onChange={x => up({ siteTitle: x })} disabled={props.ro} name="siteTitle" />
            </Field>
          </div>
        </Section>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="pf-save" />}
      </form>
      <Section title={t('pfLinks')} pad={false} testId="pf-links">
        {!s.publicEnabled && (
          <div className="card-pad">
            <Notice kind="warn" text={t('pfOff')} />
          </div>
        )}
        <div className="list">
          {links.map(([k, url, on]) => (
            <div className="list-row" key={k} data-testid={`pf-link-${k}`}>
              <div className="list-main">
                <span className="list-title">{t(k)}</span>
                <span className="list-sub mono ltr ellipsis" style={{ textAlign: 'start' }}>
                  {url}
                </span>
              </div>
              <span className={`badge ${on ? 'b-ok' : ''}`}>{on ? t('pfOn') : t('pfOffShort')}</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    toast('ok', t('copied'));
                  } catch {
                    toast('bad', url);
                  }
                }}
              >
                {t('copy')}
              </button>
              <a className={`btn btn-sm btn-icon ${on ? '' : 'disabled'}`} href={on ? url : undefined} target="_blank" rel="noopener noreferrer" aria-label={t('pfOpen')} title={t('pfOpen')} aria-disabled={!on}>
                <ArrowSquareOut className="ic" />
              </a>
            </div>
          ))}
        </div>
        <div className="card-pad">
          <span className="small muted">{t('pfCount', { n: num(news.filter(x => x.status === 'published' && !x.noindex).length) })}</span>
        </div>
      </Section>
    </div>
  );
}
