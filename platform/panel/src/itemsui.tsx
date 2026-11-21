import { useState } from 'react';
import { Backpack, MagnifyingGlass, Package, Sparkle, SquaresFour, Tag as TagIcon, X } from '@phosphor-icons/react';
import { getConn, useRows, type RowOf } from './conn.ts';
import { digits, errorText, num, t, useLocale } from './i18n.ts';
import { pageQuery, run, runToast, trText, useDebounced, useFetch, useLanguages, useRoute, useSession, type Tr } from './app.ts';
import { Dialog, ErrBox, Field, NumInput, Pager, Seg, Skel, SwitchRow, TrInputs, confirmAsk } from './ui.tsx';
import { CategoryPicker } from './dialogs.tsx';
import { BigInput, FloatInput, Section, TagPicker, fmtNum, when } from './widgets.tsx';
import { ActiveBadge, AddButton, FormDialog, NameCell, PageHead, del, needTitle, save, useCurName } from './economy.tsx';
import { CatalogTable, Choice, IdPick, KeyPick, Rows, WindowFields, useLoaded, usePrizeName } from './kit.tsx';
import { rarityClass, rarityLabel } from './progress.tsx';

const PAGE = 20;

const RARITIES: [string, import('./i18n.ts').StrKey][] = [
  ['common', 'rrCommon'],
  ['uncommon', 'rrUncommon'],
  ['rare', 'rrRare'],
  ['epic', 'rrEpic'],
  ['legendary', 'rrLegendary'],
];

type TypeRow = RowOf<'itemType'>;

function ItemTypeDialog(props: { row?: TypeRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [slots, setSlots] = useState(r?.slots ?? 1);
  const [sort, setSort] = useState(r?.sort ?? 0);
  return (
    <FormDialog
      title={r ? t('itEdit') : t('itNew')}
      testId="ityp-dialog"
      width={500}
      onClose={props.onClose}
      submit={async () => needTitle(name, def) ?? save(() => getConn().reducers.adminSaveItemType({ id: r?.id ?? 0n, key: key.trim().toLowerCase(), name, slots, sort }))}
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('itSlots')} hint={t('itSlotsHint')}>
        <NumInput value={slots} onChange={setSlots} name="slots" />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
    </FormDialog>
  );
}

export function ItemTypes() {
  useLocale();
  const list = useRows('itemType');
  const loaded = useLoaded();
  const [edit, setEdit] = useState<TypeRow | 'new' | null>(null);
  const rows = [...list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-item-types">
      <PageHead title={t('navItemTypes')} sub={num(rows.length)} action={<AddButton label={t('itNew')} onClick={() => setEdit('new')} testId="ityp-add" />} />
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="ityp"
        keyOf={r => r.key}
        empty={{ icon: <SquaresFour className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('itSlots'), render: r => (r.slots ? t('itSlotsN', { n: r.slots }) : t('itNotEquippable')) },
          { label: t('status'), render: r => (r.isSystem ? <span className="badge">{t('ktSystem')}</span> : '—') },
        ]}
        onEdit={r => setEdit(r)}
        locked={r => r.isSystem}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteItemType({ id: r.id }))}
      />
      {edit && <ItemTypeDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

type ItemRow = RowOf<'item'>;
type Price = { currencyKey: string; amount: bigint };
type Service = { key: string; name: Tr[]; currencyKey: string; unitPrice: bigint; maxUnits: number; prizeId: bigint };

function ItemDialog(props: { row?: ItemRow; onClose: () => void }) {
  const r = props.row;
  const { def } = useLanguages();
  const [key, setKey] = useState(r?.key ?? '');
  const [typeKey, setType] = useState(r?.typeKey ?? 'avatar');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [iconUrl, setIcon] = useState(r?.iconUrl ?? '');
  const [imageUrl, setImage] = useState(r?.imageUrl ?? '');
  const [categoryId, setCat] = useState<bigint>(r?.categoryId ?? 0n);
  const [tagIds, setTags] = useState<bigint[]>(r?.tagIds ?? []);
  const [rarity, setRarity] = useState(r?.rarity ?? 'common');
  const [stackable, setStackable] = useState(r?.stackable ?? false);
  const [maxStack, setMaxStack] = useState(r?.maxStack ?? 0);
  const [requiresKey, setRequires] = useState(r?.requiresKey ?? '');
  const [isStarter, setStarter] = useState(r?.isStarter ?? false);
  const [starterQuantity, setStarterQty] = useState(r?.starterQuantity ?? 1);
  const [levelTableId, setTable] = useState<bigint>(r?.levelTableId ?? 0n);
  const [unlockLevel, setUnlock] = useState(r?.unlockLevel ?? 0);
  const [hasPrice, setHasPrice] = useState(!!r?.price);
  const [price, setPrice] = useState<Price>(r?.price ? { ...r.price } : { currencyKey: '', amount: 0n });
  const [upgrades, setUpgrades] = useState<Price[]>(r?.upgrades.map(x => ({ ...x })) ?? []);
  const [services, setServices] = useState<Service[]>(r?.services.map(x => ({ ...x })) ?? []);
  const [usePrizeId, setUsePrize] = useState<bigint>(r?.usePrizeId ?? 0n);
  const [metadata, setMetadata] = useState(r?.metadata ?? '');
  const [sort, setSort] = useState(r?.sort ?? 0);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  return (
    <FormDialog
      title={r ? t('imEdit') : t('imNew')}
      testId="im-dialog"
      width={820}
      onClose={props.onClose}
      submit={async () =>
        needTitle(name, def) ??
        save(() =>
          getConn().reducers.adminSaveItem({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            typeKey,
            name,
            description,
            iconUrl: iconUrl.trim(),
            imageUrl: imageUrl.trim(),
            categoryId,
            tagIds,
            rarity,
            stackable,
            maxStack: stackable ? maxStack : 0,
            requiresKey,
            isStarter,
            starterQuantity: isStarter ? starterQuantity : 0,
            levelTableId,
            unlockLevel,
            price: hasPrice ? price : undefined,
            upgrades: stackable ? [] : upgrades,
            services,
            usePrizeId: stackable ? usePrizeId : 0n,
            metadata: metadata.trim(),
            sort,
            isActive,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('imType')} required>
        <KeyPick kind="itemType" value={typeKey} onChange={setType} testId="im-type" />
      </Field>
      <Field label={t('name')} required className="span-2">
        <TrInputs value={name} onChange={setName} required name="name" />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <Field label={t('acRarity')}>
        <Choice value={rarity} onChange={setRarity} name="rarity" options={RARITIES} />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={stackable} onChange={setStackable} label={stackable ? t('imStackable') : t('imUnique')} testId="im-stackable" />
      </div>
      {stackable && (
        <>
          <Field label={t('imMaxStack')} hint={t('zeroNoLimit')}>
            <NumInput value={maxStack} onChange={setMaxStack} name="maxStack" />
          </Field>
          <Field label={t('imUsePrize')} hint={t('imUsePrizeHint')}>
            <IdPick kind="prize" value={usePrizeId} onChange={setUsePrize} none={t('none')} />
          </Field>
        </>
      )}
      <div className="span-2 stack stack-sm">
        <SwitchRow checked={hasPrice} onChange={setHasPrice} label={t('imForSale')} testId="im-for-sale" />
        {hasPrice && (
          <div className="input-group">
            <div className="grow">
              <KeyPick kind="currency" value={price.currencyKey} onChange={v => setPrice({ ...price, currencyKey: v })} none="—" testId="im-price-currency" />
            </div>
            <div style={{ width: 160 }}>
              <BigInput value={price.amount} onChange={v => setPrice({ ...price, amount: v })} name="priceAmount" />
            </div>
          </div>
        )}
      </div>
      <Field label={t('imRequires')} hint={t('imRequiresHint')}>
        <KeyPick kind="item" value={requiresKey} onChange={setRequires} none={t('none')} />
      </Field>
      <Field label={t('imUnlock')} hint={t('imUnlockHint')}>
        <div className="input-group">
          <div className="grow">
            <IdPick kind="levelTable" value={levelTableId} onChange={setTable} none={t('imMainTable')} />
          </div>
          <div style={{ width: 90 }}>
            <NumInput value={unlockLevel} onChange={setUnlock} name="unlockLevel" />
          </div>
        </div>
      </Field>
      <div className="span-2 row row-wrap" style={{ gap: 16 }}>
        <SwitchRow checked={isStarter} onChange={setStarter} label={t('imStarter')} testId="im-starter" />
        {isStarter && stackable && (
          <label className="check">
            {t('imStarterQty')}
            <span style={{ width: 90 }}>
              <NumInput value={starterQuantity} onChange={setStarterQty} name="starterQuantity" />
            </span>
          </label>
        )}
      </div>
      {!stackable && (
        <Field label={t('imUpgrades')} hint={t('imUpgradesHint')} className="span-2">
          <Rows
            rows={upgrades}
            onChange={setUpgrades}
            testId="im-upgrades"
            addLabel={t('imAddUpgrade')}
            max={50}
            make={() => ({ currencyKey: upgrades[upgrades.length - 1]?.currencyKey ?? '', amount: (upgrades[upgrades.length - 1]?.amount ?? 0n) + 100n })}
            cols={[
              { label: t('ltLevel'), width: '50px', render: (_x, _s, i) => <span className="badge">{digits(i + 1)}</span> },
              { label: t('itCurrency'), width: 'minmax(0, 1fr)', render: (x, set, i) => <KeyPick kind="currency" value={x.currencyKey} onChange={v => set({ currencyKey: v })} none="—" testId={`im-upgrade-${i}-currency`} /> },
              { label: t('imAmount'), width: '140px', render: (x, set, i) => <BigInput value={x.amount} onChange={v => set({ amount: v })} name={`im-upgrade-${i}-amount`} /> },
            ]}
          />
        </Field>
      )}
      <Field label={t('imServices')} hint={t('imServicesHint')} className="span-2">
        <Rows
          rows={services}
          onChange={setServices}
          testId="im-services"
          addLabel={t('imAddService')}
          max={20}
          make={() => ({ key: '', name: [], currencyKey: '', unitPrice: 0n, maxUnits: 1, prizeId: 0n })}
          cols={[
            { label: t('key'), width: '110px', render: (x, set, i) => <input className="input ltr" value={x.key} onChange={e => set({ key: e.target.value })} name={`im-service-${i}-key`} /> },
            { label: t('name'), width: 'minmax(0, 1.2fr)', render: (x, set, i) => <TrInputs value={x.name} onChange={v => set({ name: v })} name={`im-service-${i}-name`} /> },
            { label: t('itCurrency'), width: 'minmax(0, 1fr)', render: (x, set) => <KeyPick kind="currency" value={x.currencyKey} onChange={v => set({ currencyKey: v })} none="—" /> },
            { label: t('imUnitPrice'), width: '90px', render: (x, set, i) => <BigInput value={x.unitPrice} onChange={v => set({ unitPrice: v })} name={`im-service-${i}-price`} /> },
            { label: t('imMaxUnits'), width: '70px', render: (x, set, i) => <NumInput value={x.maxUnits} onChange={v => set({ maxUnits: v })} name={`im-service-${i}-max`} /> },
            { label: t('gfPrize'), width: 'minmax(0, 1fr)', render: (x, set) => <IdPick kind="prize" value={x.prizeId} onChange={v => set({ prizeId: v })} none={t('none')} /> },
          ]}
        />
      </Field>
      <Field label={t('icon')} hint={t('brUrlHint')}>
        <input className="input ltr" value={iconUrl} onChange={e => setIcon(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('prCover')} hint={t('brUrlHint')}>
        <input className="input ltr" value={imageUrl} onChange={e => setImage(e.target.value)} placeholder="https://" />
      </Field>
      <Field label={t('category')}>
        <CategoryPicker keyType="item" value={categoryId} onChange={setCat} none={t('noCategory')} label={t('category')} />
      </Field>
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} />
      </Field>
      <Field label={t('tags')} className="span-2">
        <TagPicker keyType="item" value={tagIds} onChange={setTags} />
      </Field>
      <Field label={t('imMetadata')} hint={t('imMetadataHint')} className="span-2">
        <textarea className="textarea ltr" name="metadata" value={metadata} onChange={e => setMetadata(e.target.value)} placeholder="{}" />
      </Field>
      <div className="span-2">
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function Items() {
  const route = useRoute();
  useLocale();
  const typeKey = route.query.get('type') ?? '';
  const isActive = route.query.get('active') ?? '';
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<ItemRow | 'new' | null>(null);
  const q = useDebounced(query, 300);
  const cur = useCurName();
  const types = useRows('itemType');
  const { def } = useLanguages();
  const { data, error, loading } = useFetch(() => getConn().procedures.adminItems({ query: q, typeKey, isActive, page, pageSize: PAGE }), [q, typeKey, isActive, page]);
  const rows = (data?.rows ?? []).map(x => ({ ...x.item, owners: x.owners, equippedBy: x.equippedBy }));
  const set = (p: Record<string, string>) => {
    setPage(1);
    pageQuery('items', { type: typeKey, active: isActive, ...p });
  };
  const typeName = (k: string) => trText(types.find(x => x.key === k)?.name, def) || k;
  return (
    <main className="page" data-testid="page-items">
      <PageHead title={t('navItems')} sub={data ? num(data.total) : <Skel w={40} h={10} />} action={<AddButton label={t('imNew')} onClick={() => setEdit('new')} testId="im-add" />} />
      <div className="toolbar">
        <div className="input-affix search">
          <MagnifyingGlass className="ic" />
          <input className="input" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder={t('prSearch')} aria-label={t('prSearch')} data-testid="im-search" />
        </div>
        <div style={{ width: 200 }}>
          <KeyPick kind="itemType" value={typeKey} onChange={v => set({ type: v })} none={t('imAllTypes')} testId="im-type-filter" label={t('imType')} />
        </div>
        <Seg
          value={isActive}
          onChange={v => set({ active: v })}
          options={[
            { value: '', label: t('prAllActive') },
            { value: 'true', label: t('prOnlyActive') },
            { value: 'false', label: t('prOnlyInactive') },
          ]}
        />
      </div>
      <ErrBox text={error ? errorText(error) : null} />
      <CatalogTable
        rows={rows}
        loaded={!(loading && !data)}
        prefix="im"
        keyOf={r => r.key}
        empty={{ icon: <Package className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          {
            label: t('imType'),
            render: r => (
              <span className="chips">
                <span className="chip">{typeName(r.typeKey)}</span>
                <span className={`badge ${rarityClass(r.rarity)}`}>{rarityLabel(r.rarity)}</span>
              </span>
            ),
          },
          { label: t('imKind'), render: r => (r.stackable ? `${t('imStackable')}${r.maxStack ? ` · ≤${digits(r.maxStack)}` : ''}` : t('imUnique')) },
          { label: t('prPriceCol'), render: r => (r.price ? `${num(r.price.amount)} ${cur(r.price.currencyKey)}` : r.unlockLevel ? t('imUnlockAt', { n: r.unlockLevel }) : '—') },
          { label: t('imOwners'), render: r => t('imOwnersN', { a: r.owners, b: r.equippedBy }) },
          {
            label: t('status'),
            render: r => (
              <span className="chips">
                <ActiveBadge on={r.isActive} />
                {r.isStarter && <span className="badge b-teal">{t('imStarter')}</span>}
              </span>
            ),
          },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteItem({ id: r.id }))}
      />
      {data && data.total > PAGE && <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />}
      {edit && <ItemDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

export function ProductPick(props: { value: bigint; onChange: (v: bigint) => void; testId?: string }) {
  const { def } = useLanguages();
  const { data } = useFetch(() => getConn().procedures.adminProducts({ query: '', categoryId: 0n, isActive: '', page: 1, pageSize: 100 }), []);
  return (
    <select className="select" value={String(props.value)} onChange={e => props.onChange(BigInt(e.target.value))} data-testid={props.testId} aria-label={t('pyColProduct')}>
      <option value="0">—</option>
      {(data?.rows ?? []).map(p => (
        <option key={String(p.id)} value={String(p.id)}>
          {trText(p.name, def) || p.key} ({p.key})
        </option>
      ))}
    </select>
  );
}

type OfferRow = RowOf<'adminOffers'>;
type Cond = { metaKey: string; operator: string; value: number };

const TRIGGERS: [string, import('./i18n.ts').StrKey][] = [
  ['first_entry', 'trFirst'],
  ['level', 'trLevel'],
  ['meta', 'trMeta'],
  ['tag', 'trTag'],
  ['account_days', 'trDays'],
  ['lapsed', 'trLapsed'],
];

function OfferDialog(props: { row?: OfferRow; onClose: () => void }) {
  const r = props.row;
  const [key, setKey] = useState(r?.key ?? '');
  const [kind, setKind] = useState(r?.kind ?? 'daily');
  const [name, setName] = useState<Tr[]>(r?.name ?? []);
  const [description, setDescription] = useState<Tr[]>(r?.description ?? []);
  const [badge, setBadge] = useState<Tr[]>(r?.badge ?? []);
  const [productId, setProduct] = useState<bigint>(r?.productId ?? 0n);
  const [priceMode, setPriceMode] = useState(r?.priceMode ?? 'discount');
  const [discountPercent, setDiscount] = useState(r?.discountPercent ?? 20);
  const [priceToman, setPriceToman] = useState<bigint>(r?.priceToman ?? -1n);
  const [coinAmount, setCoinAmount] = useState<bigint>(r?.coinAmount ?? -1n);
  const [purchaseLimit, setLimit] = useState(r?.purchaseLimit ?? 1);
  const [weight, setWeight] = useState(r?.weight ?? 10);
  const [audienceTagIds, setAudience] = useState<bigint[]>(r?.audienceTagIds ?? []);
  const [excludeTagIds, setExclude] = useState<bigint[]>(r?.excludeTagIds ?? []);
  const [levelTableId, setTable] = useState<bigint>(r?.levelTableId ?? 0n);
  const [minLevel, setMinLevel] = useState(r?.minLevel ?? 0);
  const [maxLevel, setMaxLevel] = useState(r?.maxLevel ?? 0);
  const [metaConditions, setConds] = useState<Cond[]>(r?.metaConditions.map(x => ({ ...x })) ?? []);
  const [minAccountDays, setMinDays] = useState(r?.minAccountDays ?? 0);
  const [maxAccountDays, setMaxDays] = useState(r?.maxAccountDays ?? 0);
  const [triggerType, setTrigger] = useState(r?.triggerType || 'first_entry');
  const [triggerValue, setTriggerValue] = useState(r?.triggerValue ?? 0);
  const [triggerRefId, setTriggerRef] = useState<bigint>(r?.triggerRefId ?? 0n);
  const [triggerMetaKey, setTriggerMeta] = useState(r?.triggerMetaKey ?? '');
  const [durationMinutes, setDuration] = useState(r?.durationMinutes ?? 1440);
  const [repeat, setRepeat] = useState(r?.repeat || 'once');
  const [cooldownHours, setCooldown] = useState(r?.cooldownHours ?? 0);
  const [maxTriggers, setMaxTriggers] = useState(r?.maxTriggers ?? 0);
  const [win, setWin] = useState<[bigint, bigint]>([r?.startsAt ?? 0n, r?.endsAt ?? 0n]);
  const [isActive, setActive] = useState(r?.isActive ?? true);
  const [sort, setSort] = useState(r?.sort ?? 0);
  const entry = kind === 'entry';
  return (
    <FormDialog
      title={r ? t('ofEdit') : t('ofNew')}
      testId="of-dialog"
      width={800}
      onClose={props.onClose}
      submit={() =>
        save(() =>
          getConn().reducers.adminSaveOffer({
            id: r?.id ?? 0n,
            key: key.trim().toLowerCase(),
            kind,
            name,
            description,
            badge,
            productId,
            priceMode,
            discountPercent: priceMode === 'discount' ? discountPercent : 0,
            priceToman: priceMode === 'price' ? priceToman : -1n,
            coinAmount: priceMode === 'price' ? coinAmount : -1n,
            purchaseLimit,
            weight,
            audienceTagIds,
            excludeTagIds,
            levelTableId,
            minLevel,
            maxLevel,
            metaConditions,
            minAccountDays,
            maxAccountDays,
            triggerType: entry ? triggerType : '',
            triggerValue: entry ? triggerValue : 0,
            triggerRefId: entry ? triggerRefId : 0n,
            triggerMetaKey: entry && triggerType === 'meta' ? triggerMetaKey : '',
            durationMinutes: entry ? durationMinutes : 1440,
            repeat: entry ? repeat : 'once',
            cooldownHours: entry && repeat === 'cooldown' ? cooldownHours : 0,
            maxTriggers: entry ? maxTriggers : 0,
            startsAt: win[0],
            endsAt: win[1],
            isActive,
            sort,
          })
        )
      }
    >
      <Field label={t('key')} hint={r ? t('keyLocked') : t('ktKeyHint')} required>
        <input className="input ltr" name="key" value={key} onChange={e => setKey(e.target.value)} disabled={!!r} autoFocus={!r} />
      </Field>
      <Field label={t('ofKind')} hint={r ? t('ofKindLocked') : undefined}>
        <select className="select" name="kind" value={kind} onChange={e => setKind(e.target.value)} disabled={!!r} data-testid="of-kind">
          <option value="daily">{t('ofDaily')}</option>
          <option value="entry">{t('ofEntry')}</option>
        </select>
      </Field>
      <Field label={t('pyColProduct')} required className="span-2">
        <ProductPick value={productId} onChange={setProduct} testId="of-product" />
      </Field>
      <Field label={t('name')} hint={t('ofNameHint')} className="span-2">
        <TrInputs value={name} onChange={setName} name="name" />
      </Field>
      <Field label={t('ofBadge')} hint={t('optional')} className="span-2">
        <TrInputs value={badge} onChange={setBadge} name="badge" />
      </Field>
      <Field label={t('ofPriceMode')}>
        <Choice value={priceMode} onChange={setPriceMode} name="priceMode" options={[['discount', 'ofByDiscount'], ['price', 'ofByPrice']]} />
      </Field>
      {priceMode === 'discount' ? (
        <Field label={t('prDiscount')} hint={t('ofDiscountHint')}>
          <NumInput value={discountPercent} onChange={setDiscount} name="discountPercent" />
        </Field>
      ) : (
        <>
          <Field label={t('prPrice')} hint={t('ofKeepHint')}>
            <BigInput value={priceToman} onChange={setPriceToman} name="offerPriceToman" />
          </Field>
          <Field label={t('prCoinAmount')} hint={t('ofKeepHint')}>
            <BigInput value={coinAmount} onChange={setCoinAmount} name="offerCoinAmount" />
          </Field>
        </>
      )}
      <Field label={t('ofLimit')} hint={t('zeroNoLimit')}>
        <NumInput value={purchaseLimit} onChange={setLimit} name="purchaseLimit" />
      </Field>
      {!entry && (
        <Field label={t('ofWeight')} hint={t('ofWeightHint')}>
          <NumInput value={weight} onChange={setWeight} name="weight" />
        </Field>
      )}
      {entry && (
        <>
          <Field label={t('ofTrigger')}>
            <Choice value={triggerType} onChange={setTrigger} name="triggerType" options={TRIGGERS} testId="of-trigger" />
          </Field>
          {(triggerType === 'level' || triggerType === 'meta' || triggerType === 'account_days' || triggerType === 'lapsed') && (
            <Field label={triggerType === 'lapsed' || triggerType === 'account_days' ? t('ofTriggerDays') : t('ofTriggerValue')}>
              <FloatInput value={triggerValue} onChange={setTriggerValue} name="triggerValue" />
            </Field>
          )}
          {triggerType === 'level' && (
            <Field label={t('tkLevelTable')}>
              <IdPick kind="levelTable" value={triggerRefId} onChange={setTriggerRef} none={t('imMainTable')} />
            </Field>
          )}
          {triggerType === 'tag' && (
            <Field label={t('trTag')}>
              <IdPick kind="tag" value={triggerRefId} onChange={setTriggerRef} />
            </Field>
          )}
          {triggerType === 'meta' && (
            <Field label={t('itMeta')}>
              <KeyPick kind="meta" value={triggerMetaKey} onChange={setTriggerMeta} none="—" />
            </Field>
          )}
          <Field label={t('ofDuration')}>
            <NumInput value={durationMinutes} onChange={setDuration} name="durationMinutes" />
          </Field>
          <Field label={t('erRepeat')}>
            <Choice value={repeat} onChange={setRepeat} name="offerRepeat" options={[['once', 'repOnce'], ['cooldown', 'ofCooldown']]} />
          </Field>
          {repeat === 'cooldown' && (
            <Field label={t('ofCooldownHours')}>
              <NumInput value={cooldownHours} onChange={setCooldown} name="cooldownHours" />
            </Field>
          )}
          <Field label={t('ofMaxTriggers')} hint={t('zeroNoLimit')}>
            <NumInput value={maxTriggers} onChange={setMaxTriggers} name="maxTriggers" />
          </Field>
        </>
      )}
      <Field label={t('audience')} hint={t('prAudienceHint')}>
        <TagPicker keyType="user" value={audienceTagIds} onChange={setAudience} />
      </Field>
      <Field label={t('ofExclude')}>
        <TagPicker keyType="user" value={excludeTagIds} onChange={setExclude} />
      </Field>
      <Field label={t('tkLevelTable')}>
        <IdPick kind="levelTable" value={levelTableId} onChange={setTable} none={t('imMainTable')} />
      </Field>
      <Field label={t('tkLevelRange')}>
        <div className="input-group">
          <NumInput value={minLevel} onChange={setMinLevel} name="minLevel" />
          <NumInput value={maxLevel} onChange={setMaxLevel} name="maxLevel" />
        </div>
      </Field>
      <Field label={t('ofAccountDays')} hint={t('ofAccountDaysHint')} className="span-2">
        <div className="input-group">
          <NumInput value={minAccountDays} onChange={setMinDays} name="minAccountDays" />
          <NumInput value={maxAccountDays} onChange={setMaxDays} name="maxAccountDays" />
        </div>
      </Field>
      <Field label={t('ofMetaConds')} className="span-2">
        <Rows
          rows={metaConditions}
          onChange={setConds}
          testId="of-conds"
          addLabel={t('ofAddCond')}
          max={10}
          make={() => ({ metaKey: '', operator: 'gte', value: 0 })}
          cols={[
            { label: t('itMeta'), width: 'minmax(0, 1fr)', render: (x, set) => <KeyPick kind="meta" value={x.metaKey} onChange={v => set({ metaKey: v })} none="—" /> },
            {
              label: t('ofOp'),
              width: '120px',
              render: (x, set) => (
                <Choice
                  value={x.operator}
                  onChange={v => set({ operator: v })}
                  options={[
                    ['gte', 'opGte'],
                    ['gt', 'opGt'],
                    ['lte', 'opLte'],
                    ['lt', 'opLt'],
                    ['eq', 'opEq'],
                  ]}
                />
              ),
            },
            { label: t('pzItemValue'), width: '110px', render: (x, set, i) => <FloatInput value={x.value} onChange={v => set({ value: v })} name={`of-cond-${i}-value`} /> },
          ]}
        />
      </Field>
      <Field label={t('description')} className="span-2" hint={t('optional')}>
        <TrInputs value={description} onChange={setDescription} name="description" />
      </Field>
      <WindowFields startsAt={win[0]} endsAt={win[1]} onChange={(a, b) => setWin([a, b])} />
      <Field label={t('sort')}>
        <NumInput value={sort} onChange={setSort} name="sort" />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <SwitchRow checked={isActive} onChange={setActive} label={t('active')} />
      </div>
    </FormDialog>
  );
}

export function Offers() {
  useLocale();
  const list = useRows('adminOffers');
  const loaded = useLoaded();
  const [kind, setKind] = useState('');
  const [edit, setEdit] = useState<OfferRow | 'new' | null>(null);
  const rows = [...list].filter(x => !kind || x.kind === kind).sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort || a.key.localeCompare(b.key));
  return (
    <main className="page" data-testid="page-offers">
      <PageHead title={t('navOffers')} sub={num(rows.length)} action={<AddButton label={t('ofNew')} onClick={() => setEdit('new')} testId="of-add" />} />
      <div className="toolbar">
        <Seg
          value={kind}
          onChange={setKind}
          options={[
            { value: '', label: t('all') },
            { value: 'daily', label: t('ofDaily') },
            { value: 'entry', label: t('ofEntry') },
          ]}
        />
        <span className="grow" />
        <a className="btn btn-outline" href="#/settings/offer-settings" data-testid="of-settings-link">
          {t('stOfferSettings')}
        </a>
      </div>
      <CatalogTable
        rows={rows}
        loaded={loaded}
        prefix="of"
        keyOf={r => r.key}
        empty={{ icon: <Sparkle className="ic" weight="duotone" />, title: t('emptyList') }}
        cols={[
          { label: t('name'), render: r => <NameCell name={r.name} k={r.key} /> },
          { label: t('ofKind'), render: r => <span className={`badge ${r.kind === 'entry' ? 'b-violet' : 'b-info'}`}>{r.kind === 'entry' ? t('ofEntry') : t('ofDaily')}</span> },
          { label: t('ofPriceMode'), render: r => (r.priceMode === 'discount' ? (r.discountPercent ? `${digits(r.discountPercent)}٪` : t('ofProductPrice')) : t('ofFixedPrice')) },
          {
            label: t('ofRule'),
            render: r => (r.kind === 'entry' ? t(TRIGGERS.find(x => x[0] === r.triggerType)?.[1] ?? 'trFirst') : t('ofWeightN', { n: r.weight })),
          },
          { label: t('status'), render: r => <ActiveBadge on={r.isActive} /> },
        ]}
        onEdit={r => setEdit(r)}
        onDelete={r => del(t('deleteConfirmName', { name: r.key }), () => getConn().reducers.adminDeleteOffer({ id: r.id }))}
      />
      {edit && <OfferDialog row={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
    </main>
  );
}

export type RuleState = { on: boolean; minLevel: number; maxLevel: number; levelTableId: bigint; isOneTime: boolean; checkContents: boolean; purchaseMessage: Tr[] };

export function useProductRule(productId: bigint | undefined) {
  const rules = useRows('productRule');
  const r = productId ? rules.find(x => x.productId === productId) : undefined;
  return useState<RuleState>(
    r
      ? { on: true, minLevel: r.minLevel, maxLevel: r.maxLevel, levelTableId: r.levelTableId, isOneTime: r.isOneTime, checkContents: r.checkContents, purchaseMessage: r.purchaseMessage }
      : { on: false, minLevel: 0, maxLevel: 0, levelTableId: 0n, isOneTime: false, checkContents: true, purchaseMessage: [] }
  );
}

export async function saveProductRule(productId: bigint, s: RuleState, existed: boolean) {
  if (!s.on) {
    if (existed) await getConn().reducers.adminDeleteProductRule({ productId });
    return;
  }
  await getConn().reducers.adminSaveProductRule({
    productId,
    minLevel: s.minLevel,
    maxLevel: s.maxLevel,
    levelTableId: s.levelTableId,
    isOneTime: s.isOneTime,
    checkContents: s.checkContents,
    purchaseMessage: s.purchaseMessage,
  });
}

export function ProductRuleFields(props: { value: RuleState; onChange: (v: RuleState) => void }) {
  const v = props.value;
  const up = (p: Partial<RuleState>) => props.onChange({ ...v, ...p });
  return (
    <div className="span-2 stack" data-testid="pr-rules" style={{ padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 8 }}>
      <SwitchRow checked={v.on} onChange={on => up({ on })} label={t('prRules')} testId="pr-rules-on" />
      {v.on && (
        <div className="form-grid">
          <Field label={t('tkLevelTable')}>
            <IdPick kind="levelTable" value={v.levelTableId} onChange={levelTableId => up({ levelTableId })} none={t('imMainTable')} />
          </Field>
          <Field label={t('tkLevelRange')} hint={t('prLevelHint')}>
            <div className="input-group">
              <NumInput value={v.minLevel} onChange={minLevel => up({ minLevel })} name="ruleMinLevel" />
              <NumInput value={v.maxLevel} onChange={maxLevel => up({ maxLevel })} name="ruleMaxLevel" />
            </div>
          </Field>
          <div className="span-2 row row-wrap" style={{ gap: 16 }}>
            <SwitchRow checked={v.isOneTime} onChange={isOneTime => up({ isOneTime })} label={t('prOneTime')} testId="pr-one-time" />
            <SwitchRow checked={v.checkContents} onChange={checkContents => up({ checkContents })} label={t('prCheckContents')} />
          </div>
          <Field label={t('prMessage')} className="span-2" hint={t('optional')}>
            <TrInputs value={v.purchaseMessage} onChange={purchaseMessage => up({ purchaseMessage })} name="purchaseMessage" />
          </Field>
        </div>
      )}
    </div>
  );
}

function GiveTakeDialog(props: { accountId: bigint; mode: 'give' | 'take'; onClose: () => void }) {
  const [itemId, setItem] = useState<bigint>(0n);
  const [quantity, setQty] = useState(1);
  const [note, setNote] = useState('');
  const items = useRows('item');
  const { def } = useLanguages();
  return (
    <FormDialog
      title={props.mode === 'give' ? t('invGive') : t('invTake')}
      testId="inv-dialog"
      width={480}
      onClose={props.onClose}
      submit={() =>
        save(() =>
          props.mode === 'give'
            ? getConn().reducers.adminGiveItem({ accountId: props.accountId, itemId, quantity, note })
            : getConn().reducers.adminTakeItem({ accountId: props.accountId, itemId, quantity, note })
        )
      }
    >
      <Field label={t('itItem')} required className="span-2">
        <select className="select" value={String(itemId)} onChange={e => setItem(BigInt(e.target.value))} data-testid="inv-item">
          <option value="0">—</option>
          {items.map(x => (
            <option key={String(x.id)} value={String(x.id)}>
              {trText(x.name, def) || x.key} ({x.key})
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('invQty')}>
        <NumInput value={quantity} onChange={setQty} name="invQty" />
      </Field>
      <Field label={t('note')} hint={t('optional')}>
        <input className="input" value={note} onChange={e => setNote(e.target.value)} name="invNote" />
      </Field>
    </FormDialog>
  );
}

export function PlayerItemsCard(props: { accountId: bigint }) {
  const { can } = useSession();
  const { def } = useLanguages();
  const items = useRows('item');
  const offers = useRows('adminOffers');
  const inv = useFetch(() => getConn().procedures.adminUserItems({ accountId: props.accountId }), [String(props.accountId)]);
  const off = useFetch(() => getConn().procedures.adminPlayerOffers({ accountId: props.accountId }), [String(props.accountId)]);
  const [dlg, setDlg] = useState<'give' | 'take' | null>(null);
  const itemName = (id: bigint, key: string) => trText(items.find(x => x.id === id)?.name, def) || key;
  const offerName = (id: bigint) => {
    const o = offers.find(x => x.id === id);
    return o ? trText(o.name, def) || o.key : `#${digits(String(id))}`;
  };
  return (
    <Section
      title={t('invTitle')}
      pad={false}
      testId="pd-items"
      action={
        can('admin') && (
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDlg('give')} data-testid="inv-give">
              <Backpack className="ic" />
              {t('invGive')}
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setDlg('take')} data-testid="inv-take">
              {t('invTake')}
            </button>
          </div>
        )
      }
    >
      <div className="card-pad stack">
        {!inv.data ? (
          <Skel h={40} r={6} />
        ) : (
          <div className="chips" data-testid="inv-list">
            {inv.data.inventory.length === 0 && <span className="small muted">{t('invEmpty')}</span>}
            {inv.data.inventory.map(x => (
              <span className="chip" key={String(x.id)} data-testid={`inv-${x.itemKey}`}>
                {itemName(x.itemId, x.itemKey)}
                {x.quantity > 1 && <b>×{digits(x.quantity)}</b>}
                {x.level > 0 && <span className="muted">{t('invLevel', { n: x.level })}</span>}
                {x.equipped && <span className="badge b-ok">{t('invEquipped')}</span>}
              </span>
            ))}
          </div>
        )}
        <div className="stack stack-sm">
          <span className="row">
            <span className="section-label grow">{t('invOffers')}</span>
            {can('admin') && (
              <button type="button" className="btn btn-sm" onClick={() => runToast(c => c.reducers.adminResetDailyOffers({ accountId: props.accountId }), t('done'))} data-testid="inv-reset-daily">
                {t('invResetDaily')}
              </button>
            )}
          </span>
          {!off.data ? (
            <Skel h={30} r={6} />
          ) : off.data.copies.length === 0 ? (
            <span className="small muted">—</span>
          ) : (
            off.data.copies.slice(0, 12).map(c => (
              <div className="row small" key={String(c.id)} data-testid={`inv-offer-${c.id}`}>
                <Sparkle className="ic muted" />
                <span className="grow">
                  {offerName(c.offerId)} · {c.kind === 'entry' ? t('ofEntry') : t('ofDaily')} · {c.coinAmount > 0n ? `${num(c.coinAmount)} ${c.coinCurrency}` : `${num(c.finalToman)} ${t('toman')}`}
                </span>
                <span className={`badge ${c.status === 'active' ? 'b-ok' : ''}`}>{c.status}</span>
                <span className="muted">{t('invBought', { a: c.bought, b: c.purchaseLimit || '∞' })}</span>
                {can('admin') && c.status === 'active' && (
                  <button type="button" className="btn btn-sm btn-icon" aria-label={t('invExpire')} title={t('invExpire')} onClick={() => runToast(x => x.reducers.adminExpireOffer({ userOfferId: c.id }), t('done'))}>
                    <X className="ic" />
                  </button>
                )}
                {can('admin') && c.kind === 'entry' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      if (await confirmAsk(t('invResetEntryConfirm'), { ok: t('ppReset') })) await runToast(x => x.reducers.adminResetEntryOffer({ accountId: props.accountId, offerId: c.offerId }), t('done'));
                    }}
                  >
                    {t('ppReset')}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
        {inv.data && inv.data.uses.length > 0 && (
          <div className="stack stack-sm">
            <span className="section-label">{t('invUses')}</span>
            {inv.data.uses.slice(0, 8).map(u => (
              <div className="row small" key={String(u.id)}>
                <TagIcon className="ic muted" />
                <span className="grow">
                  {u.itemKey}
                  {u.service ? ` · ${u.service}` : ''} · ×{digits(u.units)}
                </span>
                <span className="muted">{when(u.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {dlg && <GiveTakeDialog accountId={props.accountId} mode={dlg} onClose={() => setDlg(null)} />}
    </Section>
  );
}

export { fmtNum, run };
