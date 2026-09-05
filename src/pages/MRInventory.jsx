import { useEffect, useMemo, useRef, useState } from 'react'
import { Armchair, Banknote, Boxes, Check, ClipboardCheck, Gem, RotateCcw, Save, Sparkles } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, SearchInput, SectionHeading, StockPill } from '../components/ui.jsx'
import { formatQuantity, getRequestId, rotateRequestId } from '../lib/format.js'
import { isMrVirtualCurrencyItem, MR_STOCK_CATEGORIES, mrVirtualCurrencyLabel, splitMrInventory } from '../lib/mr-inventory.js'
import { buildMRReconciliationPayload, MRReconciliationValidationError, parseMRActualCount } from '../lib/mr-stock-reconciliation.js'
import { readableError, supabase } from '../lib/supabase.js'

function MRStocktakeRow({ item, value, onChange }) {
  const counted = parseMRActualCount(value)
  const tracked = Number(item.current_quantity)
  const discrepancy = counted == null || !Number.isSafeInteger(tracked) ? null : counted - tracked
  const virtualLabel = mrVirtualCurrencyLabel(item)
  const isVirtual = virtualLabel !== item.name

  return (
    <div className="stocktake-row">
      <div className="stocktake-row__item">
        <div className={`item-icon ${isVirtual ? 'item-icon--gold' : ''}`}>{item.name.slice(0, 1).toUpperCase()}</div>
        <div><strong>{item.name}</strong><span>{item.category}{item.aliases?.length ? ` · Alias: ${item.aliases.join(', ')}` : ''}</span></div>
      </div>
      <div className="stocktake-row__tracked"><small>Tracked</small><StockPill value={item.current_quantity} /></div>
      <label className="stocktake-row__count">
        <span>Actual count</span>
        <input
          type="number"
          min="0"
          max={Number.MAX_SAFE_INTEGER}
          step="1"
          inputMode="numeric"
          value={value}
          aria-invalid={counted == null}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div className={`stocktake-row__difference ${discrepancy > 0 ? 'is-positive' : discrepancy < 0 ? 'is-negative' : ''}`}>
        <small>Discrepancy</small>
        <strong>{discrepancy == null ? '—' : `${discrepancy > 0 ? '+' : ''}${formatQuantity(discrepancy, 0)}`}</strong>
      </div>
    </div>
  )
}

export default function MRInventory({ data, refresh, notify }) {
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({})
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const requestId = useRef(getRequestId('mr-stocktake'))
  const query = search.trim().toLowerCase()
  const inventory = useMemo(() => splitMrInventory(data.mr.items, query), [data.mr.items, query])
  const activeItems = useMemo(() => data.mr.items.filter((item) => !item.is_archived), [data.mr.items])
  const physicalItemCount = activeItems.filter((item) => !isMrVirtualCurrencyItem(item)).length
  const changedItems = activeItems.filter((item) => {
    const counted = parseMRActualCount(counts[item.id])
    return counted != null && counted !== Number(item.current_quantity)
  })

  useEffect(() => {
    setCounts(Object.fromEntries(activeItems.map((item) => [item.id, String(item.current_quantity)])))
  }, [activeItems])

  const setCount = (itemId, value) => setCounts((current) => ({ ...current, [itemId]: value }))
  const resetCounts = () => setCounts(Object.fromEntries(activeItems.map((item) => [item.id, String(item.current_quantity)])))

  const saveStocktake = async () => {
    if (saveLock.current) return

    let payload
    try {
      payload = buildMRReconciliationPayload(activeItems, counts)
    } catch (error) {
      notify('error', error instanceof MRReconciliationValidationError
        ? error.message
        : readableError(error, 'The MR stocktake could not be validated.'))
      return
    }

    if (payload.length === 0) {
      notify('info', 'All MR actual counts already match tracked stock.')
      return
    }

    saveLock.current = true
    setSaving(true)
    try {
      const { data: result, error } = await supabase.rpc('mr_reconcile_stock_batch', {
        p_counts: payload,
        p_event_at: new Date().toISOString(),
        p_notes: 'Manual MR stock reconciliation',
        p_request_id: requestId.current,
      })
      if (error) throw error

      const processed = Number(result)
      const duplicate = processed < 0
      if (!Number.isSafeInteger(processed) || Math.abs(processed) !== payload.length) {
        throw new Error('The MR stocktake returned an unexpected item count.')
      }

      if (!duplicate) {
        const { data: verified, error: verifyError } = await supabase
          .from('mr_items')
          .select('id,current_quantity')
          .in('id', payload.map((entry) => entry.item_id))
        const verifiedById = new Map((verified || []).map((item) => [item.id, Number(item.current_quantity)]))
        const matches = !verifyError && payload.every((entry) => verifiedById.get(entry.item_id) === entry.counted_stock)
        if (!matches) throw new Error('The MR stocktake saved, but its final balances could not be verified. Refresh before retrying.')
      }

      await refresh()
      requestId.current = rotateRequestId('mr-stocktake')
      notify('success', duplicate
        ? 'This MR stocktake was already saved. Current balances were refreshed without applying it twice.'
        : `MR stocktake saved atomically. ${payload.length} ${payload.length === 1 ? 'item was' : 'items were'} reconciled together.`)
    } catch (error) {
      await refresh()
      notify('error', readableError(error, 'The MR stocktake could not be saved. No partial reconciliation was applied.'))
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  return (
    <div className="page-stack mr-stock-page">
      <PageHeader
        eyebrow="MR inventory"
        title="Reconcile MR stock"
        description={`${physicalItemCount} physical catalog items plus Gems (MR) and Cash (MR). Enter exact actual balances; only changed rows are saved.`}
        action={<Button onClick={saveStocktake} loading={saving}><Save size={18} />Save {changedItems.length ? `${changedItems.length} change${changedItems.length === 1 ? '' : 's'}` : 'stocktake'}</Button>}
      />
      <Card className="stocktake-intro">
        <div className="stocktake-intro__icon"><ClipboardCheck size={23} /></div>
        <div><strong>Exact item-by-item reconciliation</strong><p>Use zero when you have none. Set totals stay derived from their table and chair rows and cannot be edited directly.</p></div>
        {changedItems.length > 0 && <Button variant="ghost" size="small" onClick={resetCounts}><RotateCcw size={16} />Reset</Button>}
      </Card>
      <SearchInput value={search} onChange={setSearch} placeholder="Search MR stock…" />
      <section className="set-pass-grid">
        <SectionHeading title="Furniture sets (read-only)" description="One table plus four chairs. Complete and excess counts are derived live from the editable component rows below." action={<Armchair size={19} />} />
        <div>{data.mr.setStock.map((set) => <article key={set.family_id}><span><Sparkles size={17} /><b>{set.name}</b></span><strong>{formatQuantity(set.completed_sets, 0)} <small>complete sets</small></strong><div><span>{formatQuantity(set.tables)} tables</span><span>{formatQuantity(set.chairs)} chairs</span></div><small>{formatQuantity(set.excess_tables)} excess tables · {formatQuantity(set.excess_chairs)} excess chairs</small></article>)}</div>
      </section>
      <Card className="stocktake-card stocktake-card--gems mr-virtual-wallet">
        <SectionHeading title="Gems & Money" description={`${inventory.virtualCurrencies.length} matching editable balances, including Cash (MR)`} action={<span className="mr-currency-icons"><Gem size={18} /><Banknote size={18} /></span>} />
        {inventory.virtualCurrencies.length ? <div className="stocktake-list">{inventory.virtualCurrencies.map((item) => <MRStocktakeRow key={item.id} item={item} value={counts[item.id] ?? ''} onChange={(value) => setCount(item.id, value)} />)}</div> : <EmptyState title="No matching Gems or Cash" description="Try another search term." icon={Gem} />}
      </Card>
      {MR_STOCK_CATEGORIES.map((category) => (
        <Card className="stocktake-card inventory-category" key={category}>
          <SectionHeading title={category} description={`${inventory.categories[category].length} matching active items`} />
          {inventory.categories[category].length ? <div className="stocktake-list">{inventory.categories[category].map((item) => <MRStocktakeRow key={item.id} item={item} value={counts[item.id] ?? ''} onChange={(value) => setCount(item.id, value)} />)}</div> : <EmptyState title={`No matching ${category.toLowerCase()}`} description="Try another search term." icon={Boxes} />}
        </Card>
      ))}
      <div className="sticky-action-bar">
        <span>{changedItems.length ? <><Check size={17} />{changedItems.length} ready to reconcile</> : 'Counts match tracked MR stock'}</span>
        <Button onClick={saveStocktake} loading={saving}><Save size={17} />Save MR stocktake</Button>
      </div>
    </div>
  )
}
