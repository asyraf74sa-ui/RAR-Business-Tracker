import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ClipboardCheck, Coins, RotateCcw, Save } from 'lucide-react'
import { Button, Card, EmptyState, PageHeader, SectionHeading, StockPill } from '../components/ui.jsx'
import { supabase, readableError } from '../lib/supabase.js'
import { formatQuantity, toNumber } from '../lib/format.js'

function StocktakeRow({ item, value, onChange }) {
  const counted = value === '' ? null : Number(value)
  const discrepancy = counted == null || Number.isNaN(counted) ? null : counted - toNumber(item.stock)

  return (
    <div className="stocktake-row">
      <div className="stocktake-row__item">
        <div className={`item-icon ${item.kind === 'currency' ? 'item-icon--gold' : ''}`}>{item.name.slice(0, 1).toUpperCase()}</div>
        <div><strong>{item.name}</strong><span>{item.gem_value_min == null ? 'Gem value not set' : item.gem_value_min === item.gem_value_max ? `${formatQuantity(item.gem_value_min)} gems` : `${formatQuantity(item.gem_value_min)}–${formatQuantity(item.gem_value_max)} gems`}</span></div>
      </div>
      <div className="stocktake-row__tracked"><small>Tracked</small><StockPill value={item.stock} /></div>
      <label className="stocktake-row__count"><span>Actual count</span><input type="number" min="0" step="any" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} /></label>
      <div className={`stocktake-row__difference ${discrepancy > 0 ? 'is-positive' : discrepancy < 0 ? 'is-negative' : ''}`}>
        <small>Discrepancy</small>
        <strong>{discrepancy == null ? '—' : `${discrepancy > 0 ? '+' : ''}${formatQuantity(discrepancy)}`}</strong>
      </div>
    </div>
  )
}

export default function Inventory({ data, refresh, notify }) {
  const [counts, setCounts] = useState({})
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const physicalItems = useMemo(() => data.items.filter((item) => item.kind === 'item').sort((a, b) => a.name.localeCompare(b.name)), [data.items])
  const currencyItems = useMemo(() => data.items.filter((item) => item.kind === 'currency'), [data.items])

  useEffect(() => {
    setCounts(Object.fromEntries(data.items.map((item) => [item.id, String(toNumber(item.stock))])))
  }, [data.items])

  const changedItems = data.items.filter((item) => {
    const counted = Number(counts[item.id])
    return Number.isFinite(counted) && counted >= 0 && counted !== toNumber(item.stock)
  })

  const resetCounts = () => setCounts(Object.fromEntries(data.items.map((item) => [item.id, String(toNumber(item.stock))])))

  const saveStocktake = async () => {
    if (saveLock.current) return
    const invalid = data.items.find((item) => counts[item.id] === '' || !Number.isFinite(Number(counts[item.id])) || Number(counts[item.id]) < 0)
    if (invalid) {
      notify('error', `Enter a valid non-negative count for ${invalid.name}.`)
      return
    }
    if (changedItems.length === 0) {
      notify('info', 'All actual counts already match tracked stock.')
      return
    }

    saveLock.current = true
    setSaving(true)
    let completed = 0
    try {
      for (const item of changedItems) {
        const counted = Number(counts[item.id])
        const { data: before, error: beforeError } = await supabase.from('rar_items').select('stock').eq('id', item.id).single()
        if (beforeError) throw new Error(`${item.name}: ${readableError(beforeError)}`)

        const expectedDelta = counted - toNumber(before.stock)
        const { data: returnedDelta, error } = await supabase.rpc('rar_reconcile_stock', {
          p_item_id: item.id,
          p_counted_stock: counted,
          p_event_at: new Date().toISOString(),
          p_notes: 'Weekly stocktake',
        })
        if (error) throw new Error(`${item.name}: ${readableError(error)}`)
        if (Math.abs(toNumber(returnedDelta) - expectedDelta) > 0.000001) throw new Error(`${item.name}: the recorded adjustment did not match the expected discrepancy.`)

        const { data: verified, error: verifyError } = await supabase.from('rar_items').select('stock').eq('id', item.id).single()
        if (verifyError || toNumber(verified?.stock) !== counted) throw new Error(`${item.name}: the stock count could not be verified after saving.`)
        completed += 1
      }

      await refresh()
      notify('success', `Stocktake saved. ${completed} ${completed === 1 ? 'item was' : 'items were'} reconciled.`)
    } catch (error) {
      await refresh()
      notify('error', `${error.message}${completed ? ` ${completed} earlier adjustment${completed === 1 ? '' : 's'} did save; the list has been refreshed.` : ''}`)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Weekly stocktake"
        title="Reconcile what you really have"
        description="Enter the count you can see. Only differences create inventory adjustment events."
        action={<Button onClick={saveStocktake} loading={saving}><Save size={18} />Save {changedItems.length ? `${changedItems.length} change${changedItems.length === 1 ? '' : 's'}` : 'stocktake'}</Button>}
      />

      <Card className="stocktake-intro">
        <div className="stocktake-intro__icon"><ClipboardCheck size={23} /></div>
        <div><strong>One clean inventory trail</strong><p>Sales, purchases, farming, and gem actions already move stock. Stocktake records only the gap between the tracked and actual count.</p></div>
        {changedItems.length > 0 && <Button variant="ghost" size="small" onClick={resetCounts}><RotateCcw size={16} />Reset</Button>}
      </Card>

      <Card className="stocktake-card">
        <SectionHeading title="Physical items" description={`${physicalItems.length} item types · Gems are excluded from the unit total.`} />
        {physicalItems.length === 0 ? <EmptyState title="No physical items" description="Add an item from Items & settings." /> : (
          <div className="stocktake-list">
            {physicalItems.map((item) => <StocktakeRow key={item.id} item={item} value={counts[item.id] ?? ''} onChange={(value) => setCounts((current) => ({ ...current, [item.id]: value }))} />)}
          </div>
        )}
      </Card>

      <Card className="stocktake-card stocktake-card--gems">
        <SectionHeading title="Gem wallet" description="Tracked separately from physical/item units." />
        {currencyItems.length === 0 ? <EmptyState title="Gem wallet not found" description="Your Gems currency item will be created when an empty account is seeded." icon={Coins} /> : (
          <div className="stocktake-list">
            {currencyItems.map((item) => <StocktakeRow key={item.id} item={item} value={counts[item.id] ?? ''} onChange={(value) => setCounts((current) => ({ ...current, [item.id]: value }))} />)}
          </div>
        )}
      </Card>

      <div className="sticky-action-bar">
        <span>{changedItems.length ? <><Check size={17} />{changedItems.length} ready to reconcile</> : 'Counts match tracked stock'}</span>
        <Button onClick={saveStocktake} loading={saving}><Save size={17} />Save stocktake</Button>
      </div>
    </div>
  )
}
