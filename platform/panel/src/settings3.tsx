import { useEffect, useState } from 'react';
import { Clock, Warning } from '@phosphor-icons/react';
import { getConn, useRows } from './conn.ts';
import { digits, errorText, num, t } from './i18n.ts';
import { run, runToast, trText, useLanguages } from './app.ts';
import { ErrBox, Field, NumInput, SaveButton, Skel, SwitchRow } from './ui.tsx';
import { BigInput, Section } from './widgets.tsx';
import { Choice, IdPick, KeyPick, Rows } from './kit.tsx';

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

function offsetText(sec: bigint) {
  if (!sec) return t('ckReal');
  const neg = sec < 0n;
  let s = neg ? -sec : sec;
  const d = s / 86400n;
  s %= 86400n;
  const h = s / 3600n;
  const m = (s % 3600n) / 60n;
  const parts = [d ? t('ckDays', { n: d }) : '', h ? t('ckHours', { n: h }) : '', m ? t('ckMinutes', { n: m }) : ''].filter(Boolean).join(' ');
  return `${neg ? '−' : '+'}${parts || digits(String(sec))}`;
}

export function TestClock(props: { value: bigint; save: (seconds: bigint) => Promise<unknown>; testId: string }) {
  const [hours, setHours] = useState(0);
  const apply = (sec: bigint) => runToast(() => props.save(sec), t('saved'));
  return (
    <div className="method-card" style={{ borderColor: 'color-mix(in srgb, var(--warn) 40%, transparent)', background: 'var(--tint-warn-bg)' }} data-testid={props.testId}>
      <div className="row row-wrap">
        <Warning className="ic" style={{ color: 'var(--warn)' }} />
        <b className="grow">{t('ckTitle')}</b>
        <span className={`badge ${props.value ? 'b-bad' : 'b-ok'}`} data-testid={`${props.testId}-now`}>
          <Clock className="ic" />
          {offsetText(props.value)}
        </span>
      </div>
      <span className="small sub">{t('ckHint')}</span>
      <div className="row row-wrap">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => apply(props.value - 86400n)} data-testid={`${props.testId}-back`}>
          {t('ckBackDay')}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => apply(props.value + 86400n)} data-testid={`${props.testId}-fwd`}>
          {t('ckFwdDay')}
        </button>
        <span className="row" style={{ gap: 4 }}>
          <span style={{ width: 90 }}>
            <NumInput value={hours} onChange={setHours} name={`${props.testId}-hours`} />
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => apply(BigInt(Math.round(hours * 3600)))}>
            {t('ckSetHours')}
          </button>
        </span>
        <span className="grow" />
        <button type="button" className="btn btn-sm" disabled={!props.value} onClick={() => apply(0n)} data-testid={`${props.testId}-reset`}>
          {t('ckResetReal')}
        </button>
      </div>
    </div>
  );
}

function useForm<T>(row: T | undefined, pick: (r: T) => Record<string, unknown>) {
  const [v, setV] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (row && !v) setV(pick(row));
  }, [row, v]);
  return [v, setV] as const;
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

const WEEK: [string, import('./i18n.ts').StrKey][] = [
  ['6', 'dSat'],
  ['0', 'dSun'],
  ['1', 'dMon'],
  ['2', 'dTue'],
  ['3', 'dWed'],
  ['4', 'dThu'],
  ['5', 'dFri'],
];

export function GamSettingsSection(props: { ro: boolean }) {
  const s = useRows('adminGamificationSettings')[0];
  const [v, setV] = useForm(s, r => ({ weekStart: r.weekStart, playerRateLimit: r.playerRateLimit, retentionDays: r.retentionDays, chainDepth: r.chainDepth }));
  const f = useSaver();
  if (!v || !s) return <FormSkel n={4} />;
  const up = (p: Record<string, unknown>) => setV({ ...v, ...p });
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() =>
            Promise.resolve().then(() => getConn().reducers.adminSaveGamificationSettings({
                weekStart: Number(v.weekStart),
                playerRateLimit: Number(v.playerRateLimit),
                retentionDays: Number(v.retentionDays),
                chainDepth: Number(v.chainDepth),
              })
            )
          );
        }}
      >
        <div className="form-grid">
          <Field label={t('gsWeekStart')}>
            <Choice value={String(v.weekStart)} onChange={x => up({ weekStart: Number(x) })} name="weekStart" options={WEEK} />
          </Field>
          <Field label={t('gsRate')} hint={t('zeroNoLimit')}>
            <NumInput value={Number(v.playerRateLimit)} onChange={x => up({ playerRateLimit: x })} disabled={props.ro} name="playerRateLimit" />
          </Field>
          <Field label={t('gsRetention')} hint={t('gsRetentionHint')}>
            <NumInput value={Number(v.retentionDays)} onChange={x => up({ retentionDays: x })} disabled={props.ro} name="retentionDays" />
          </Field>
          <Field label={t('gsChain')} hint={t('gsChainHint')}>
            <NumInput value={Number(v.chainDepth)} onChange={x => up({ chainDepth: x })} disabled={props.ro} name="chainDepth" />
          </Field>
        </div>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="gs-save" />}
      </form>
      {!props.ro && <TestClock value={s.clockOffsetSec} testId="gs-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetClockOffset({ seconds: sec }))} />}
    </div>
  );
}

export function ItemsSettingsSection(props: { ro: boolean }) {
  const s = useRows('adminItemsSettings')[0];
  const [v, setV] = useForm(s, r => ({ hideBoughtOneTime: r.hideBoughtOneTime, hideAboveMaxLevel: r.hideAboveMaxLevel, requestTtlHours: r.requestTtlHours }));
  const f = useSaver();
  if (!v || !s) return <FormSkel n={3} />;
  const up = (p: Record<string, unknown>) => setV({ ...v, ...p });
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() =>
            Promise.resolve().then(() => getConn().reducers.adminSaveItemsSettings({ hideBoughtOneTime: !!v.hideBoughtOneTime, hideAboveMaxLevel: !!v.hideAboveMaxLevel, requestTtlHours: Number(v.requestTtlHours) })
            )
          );
        }}
      >
        <div className="stack">
          <SwitchRow checked={!!v.hideBoughtOneTime} onChange={x => up({ hideBoughtOneTime: x })} disabled={props.ro} label={t('isHideBought')} />
          <SwitchRow checked={!!v.hideAboveMaxLevel} onChange={x => up({ hideAboveMaxLevel: x })} disabled={props.ro} label={t('isHideAbove')} />
          <Field label={t('isTtl')} hint={t('isTtlHint')}>
            <NumInput value={Number(v.requestTtlHours)} onChange={x => up({ requestTtlHours: x })} disabled={props.ro} name="requestTtlHours" />
          </Field>
        </div>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="is-save" />}
      </form>
      {!props.ro && <TestClock value={s.clockOffsetSec} testId="is-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetItemsClockOffset({ seconds: sec }))} />}
    </div>
  );
}

type TagCount = { tagId: bigint; count: number };

export function OfferSettingsSection(props: { ro: boolean }) {
  const s = useRows('adminOfferSettings')[0];
  const [v, setV] = useState<null | NonNullable<typeof s>>(null);
  const f = useSaver();
  useEffect(() => {
    if (s && !v) setV({ ...s });
  }, [s, v]);
  if (!v) return <FormSkel n={8} />;
  const up = (p: Partial<NonNullable<typeof s>>) => setV({ ...v, ...p });
  const sw = (k: keyof typeof v, label: import('./i18n.ts').StrKey) => (
    <SwitchRow checked={!!v[k]} onChange={x => up({ [k]: x } as Partial<typeof v>)} disabled={props.ro} label={t(label)} testId={`os-${String(k)}`} />
  );
  return (
    <form
      className="stack stack-lg"
      onSubmit={e => {
        e.preventDefault();
        const { id: _id, updatedAt: _u, ...rest } = v;
        f.go(() => Promise.resolve().then(() => getConn().reducers.adminSaveOfferSettings(rest)));
      }}
    >
      <Section title={t('osDaily')}>
        <div className="form-grid">
          <div className="span-2">{sw('dailyEnabled', 'osDailyOn')}</div>
          <Field label={t('osPeriodDays')} hint={t('osPeriodDaysHint')}>
            <NumInput value={v.periodDays} onChange={x => up({ periodDays: x })} name="periodDays" />
          </Field>
          <Field label={t('osResetMinute')} hint={t('osResetMinuteHint')}>
            <NumInput value={v.resetMinute} onChange={x => up({ resetMinute: x })} name="resetMinute" />
          </Field>
          <Field label={t('osCount')}>
            <NumInput value={v.count} onChange={x => up({ count: x })} name="count" />
          </Field>
          <Field label={t('osWeighting')}>
            <Choice value={v.weighting} onChange={x => up({ weighting: x })} name="weighting" options={[['weighted', 'osWeighted'], ['uniform', 'osUniform'], ['priority', 'osPriority']]} />
          </Field>
          <Field label={t('osCountByTag')} hint={t('osCountByTagHint')} className="span-2">
            <Rows<TagCount>
              rows={v.countByTag}
              onChange={x => up({ countByTag: x })}
              testId="os-count-tag"
              addLabel={t('osAddTagCount')}
              make={() => ({ tagId: 0n, count: v.count + 1 })}
              cols={[
                { label: t('trTag'), width: 'minmax(0, 1fr)', render: (x, set) => <IdPick kind="tag" value={x.tagId} onChange={tagId => set({ tagId })} /> },
                { label: t('osCount'), width: '90px', render: (x, set, i) => <NumInput value={x.count} onChange={count => set({ count })} name={`os-tag-${i}-count`} /> },
              ]}
            />
          </Field>
          <Field label={t('osNoRepeat')} hint={t('osNoRepeatHint')}>
            <NumInput value={v.noRepeatDays} onChange={x => up({ noRepeatDays: x })} name="noRepeatDays" />
          </Field>
          <Field label={t('osBoughtCooldown')} hint={t('osBoughtCooldownHint')}>
            <NumInput value={v.boughtCooldownDays} onChange={x => up({ boughtCooldownDays: x })} name="boughtCooldownDays" />
          </Field>
          <Field label={t('osInactiveProducts')}>
            <Choice value={v.inactiveProducts} onChange={x => up({ inactiveProducts: x })} name="inactiveProducts" options={[['allow', 'osAllow'], ['skip', 'osSkip']]} />
          </Field>
          <span />
          <div className="span-2 stack stack-sm">
            {sw('fillWithRepeats', 'osFillRepeats')}
            {sw('excludeOwned', 'osExcludeOwned')}
            {sw('respectProductRules', 'osRespectRules')}
            {sw('showSoldOut', 'osShowSoldOut')}
            {sw('giftCodes', 'osGiftCodes')}
          </div>
        </div>
      </Section>
      <Section title={t('osReroll')}>
        <div className="form-grid">
          <div className="span-2 stack stack-sm">
            {sw('rerollEnabled', 'osRerollOn')}
            {sw('rerollAvoidCurrent', 'osRerollAvoid')}
          </div>
          <Field label={t('osRerollLimit')} hint={t('zeroNoLimit')}>
            <NumInput value={v.rerollLimit} onChange={x => up({ rerollLimit: x })} name="rerollLimit" />
          </Field>
          <Field label={t('osRerollFree')}>
            <NumInput value={v.rerollFree} onChange={x => up({ rerollFree: x })} name="rerollFree" />
          </Field>
          <Field label={t('osRerollCurrency')} hint={t('osRerollCurrencyHint')}>
            <KeyPick kind="currency" value={v.rerollCurrency} onChange={x => up({ rerollCurrency: x })} none={t('none')} />
          </Field>
          <Field label={t('osRerollCost')} hint={t('osRerollCostHint')}>
            <div className="input-group">
              <BigInput value={v.rerollCost} onChange={x => up({ rerollCost: x })} name="rerollCost" />
              <BigInput value={v.rerollCostStep} onChange={x => up({ rerollCostStep: x })} name="rerollCostStep" />
            </div>
          </Field>
        </div>
      </Section>
      <Section title={t('osEntry')}>
        <div className="form-grid">
          <div className="span-2">{sw('entryEnabled', 'osEntryOn')}</div>
          <Field label={t('osEntryMax')}>
            <NumInput value={v.entryMaxActive} onChange={x => up({ entryMaxActive: x })} name="entryMaxActive" />
          </Field>
          <Field label={t('osTimerStart')}>
            <Choice value={v.entryTimerStart} onChange={x => up({ entryTimerStart: x })} name="entryTimerStart" options={[['list', 'osTimerList'], ['seen', 'osTimerSeen']]} />
          </Field>
        </div>
      </Section>
      {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="os-save" />}
    </form>
  );
}

export function PromoSettingsSection(props: { ro: boolean }) {
  const s = useRows('adminPromoSettings')[0];
  const [v, setV] = useForm(s, r => ({
    listPerMinute: r.listPerMinute,
    countPerMinute: r.countPerMinute,
    playPerMinute: r.playPerMinute,
    newPlayerDays: r.newPlayerDays,
    requestTtlHours: r.requestTtlHours,
    keepDays: r.keepDays,
  }));
  const f = useSaver();
  if (!v || !s) return <FormSkel n={6} />;
  const n = (k: string, label: import('./i18n.ts').StrKey, hint?: import('./i18n.ts').StrKey) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <NumInput value={Number(v[k])} onChange={x => setV({ ...v, [k]: x })} disabled={props.ro} name={k} />
    </Field>
  );
  return (
    <div className="stack stack-lg">
      <form
        className="stack stack-lg"
        onSubmit={e => {
          e.preventDefault();
          f.go(() =>
            Promise.resolve().then(() => getConn().reducers.adminSavePromoSettings({
                listPerMinute: Number(v.listPerMinute),
                countPerMinute: Number(v.countPerMinute),
                playPerMinute: Number(v.playPerMinute),
                newPlayerDays: Number(v.newPlayerDays),
                requestTtlHours: Number(v.requestTtlHours),
                keepDays: Number(v.keepDays),
              })
            )
          );
        }}
      >
        <div className="form-grid">
          {n('listPerMinute', 'psList', 'zeroNoLimit')}
          {n('countPerMinute', 'psCount', 'zeroNoLimit')}
          {n('playPerMinute', 'psPlay', 'zeroNoLimit')}
          {n('newPlayerDays', 'psNewDays', 'psNewDaysHint')}
          {n('requestTtlHours', 'isTtl', 'psTtlHint')}
          {n('keepDays', 'psKeep', 'psKeepHint')}
        </div>
        {!props.ro && <SaveBar busy={f.busy} err={f.err} testId="ps-save" />}
      </form>
      {!props.ro && <TestClock value={s.clockOffsetSec} testId="ps-clock" save={sec => Promise.resolve().then(() => getConn().reducers.adminSetPromoClockOffset({ seconds: sec }))} />}
    </div>
  );
}

export { num, trText, useLanguages };
