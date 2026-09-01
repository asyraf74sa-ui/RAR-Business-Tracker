import { useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Coins, History, Sparkles } from 'lucide-react'
import { Button, Card, EmptyState, Field, PageHeader, SectionHeading, StockPill } from '../components/ui.jsx'
import { formatDateTime, formatQuantity, gemRange, localDateTimeValue, toNumber } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

export default function Gems({ data, refresh, notify }) {
  const [mode, setMode] = useState('convert')
  const [form, setForm] = useState({ item_id: '', quantity: '1', gems: '', event_at: localDateTimeValue(), notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const gemItem = data.items.find((item) => item.kind === 'currency' && item.name.toLowerCase() === 'gems')
  const physicalItems = data.items.filter((item) => item.kind === 'item' && item.active).sort((a, b) => a.name.localeCompare(b.name))
  const selectedItem = physicalItems.find((item) => item.id === form.item_id)

  const history = useMemo(() => data.inventoryEvents
    .filter((event) => ['gem_conversion', 'gem_purchase'].includes(event.event_type) && event.item_id !== gemItem?.id)
    .map((event) => ({ ...event, item: data.items.find((item) => item.id === event.item_id) }))
    .filter((event) => event.item)
    .slice(0, 25), [data.inventoryEvents, data.items, gemItem?.id])

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const useSuggestedValue = () => {
    if (!selectedItem?.gem_value_min) return
    const midpoint = (toNumber(selectedItem.gem_value_min) + toNumber(selectedItem.gem_value_max ?? selectedItem.gem_value_min)) / 2
    update('gems', String(Math.round(midpoint * toNumber(form.quantity, 1))))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitLock.current) return
    const quantity = Number(form.quantity)
    const gems = Number(form.gems)
    if (!form.item_id || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(gems) || gems <= 0) {
      notify('error', 'Choose an item and enter positive item and gem amounts.')
      return
    }
    if (!gemItem) {
      notify('error', 'The Gems currency item is missing from this account.')
      return
    }

    submitLock.current = true
    setSubmitting(true)
    try {
      const { data: latest, error: loadError } = await supabase.from('rar_items').select('id,name,stock').in('id', [form.item_id, gemItem.id])
      if (loadError) throw loadError
      const latestItem = latest.find((item) => item.id === form.item_id)
      const latestGems = latest.find((item) => item.id === gemItem.id)
      if (!latestItem || !latestGems) throw new Error('The item or Gem wallet could not be loaded.')

      if (mode === 'convert' && toNumber(latestItem.stock) < quantity) throw new Error(`${latestItem.name} has only ${formatQuantity(latestItem.stock)} in stock.`)
      if (mode === 'buy' && toNumber(latestGems.stock) < gems) throw new Error(`You have only ${formatQuantity(latestGems.stock)} Gems.`)

      const rpcName = mode === 'convert' ? 'rar_convert_item_to_gems' : 'rar_buy_item_with_gems'
      const params = mode === 'convert'
        ? { p_item_id: form.item_id, p_quantity: quantity, p_gems_received: gems, p_event_at: new Date(form.event_at).toISOString(), p_notes: form.notes.trim() || null }
        : { p_item_id: form.item_id, p_quantity: quantity, p_gems_spent: gems, p_event_at: new Date(form.event_at).toISOString(), p_notes: form.notes.trim() || null }
      const { data: result, error } = await supabase.rpc(rpcName, params)
      if (error) throw error
      if (toNumber(result) !== (mode === 'convert' ? gems : quantity)) throw new Error('The Gem transaction returned an unexpected result.')

      const { data: verified, error: verifyError } = await supabase.from('rar_items').select('id,stock').in('id', [form.item_id, gemItem.id])
      if (verifyError) throw verifyError
      const finalItem = verified.find((item) => item.id === form.item_id)
      const finalGems = verified.find((item) => item.id === gemItem.id)
      const expectedItem = toNumber(latestItem.stock) + (mode === 'convert' ? -quantity : quantity)
      const expectedGems = toNumber(latestGems.stock) + (mode === 'convert' ? gems : -gems)
      if (toNumber(finalItem?.stock) !== expectedItem || toNumber(finalGems?.stock) !== expectedGems) throw new Error('The Gem transaction saved but its inventory result could not be verified. Refresh before retrying.')

      await refresh()
      notify('success', mode === 'convert' ? `${formatQuantity(quantity)} ${latestItem.name} converted into ${formatQuantity(gems)} Gems.` : `${formatQuantity(quantity)} ${latestItem.name} purchased for ${formatQuantity(gems)} Gems.`)
      setForm({ item_id: '', quantity: '1', gems: '', event_at: localDateTimeValue(), notes: '' })
    } catch (error) {
      notify('error', readableError(error, 'The Gem transaction could not be completed.'))
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Gem economy" title="Move value without losing stock" description="Convert items to Gems or spend Gems on items. Both sides are recorded together." />

      <Card className="gem-balance-card">
        <div className="gem-orb"><Coins size={30} /></div>
        <div><span>Current Gem balance</span><strong>{formatQuantity(gemItem?.stock || 0)}</strong><small>Gems stay separate from physical item units.</small></div>
        <Sparkles className="gem-balance-card__sparkle" size={50} />
      </Card>

      <div className="gems-layout">
        <Card className="form-card">
          <div className="mode-tabs" role="tablist" aria-label="Gem transaction type">
            <button type="button" role="tab" aria-selected={mode === 'convert'} className={mode === 'convert' ? 'is-active' : ''} onClick={() => setMode('convert')}><ArrowDownLeft size={17} />Item → Gems</button>
            <button type="button" role="tab" aria-selected={mode === 'buy'} className={mode === 'buy' ? 'is-active' : ''} onClick={() => setMode('buy')}><ArrowUpRight size={17} />Gems → Item</button>
          </div>
          <SectionHeading title={mode === 'convert' ? 'Convert item to Gems' : 'Buy item with Gems'} description={mode === 'convert' ? 'Physical stock decreases while your Gem balance increases.' : 'Your Gem balance decreases while physical stock increases.'} />
          <form className="form-stack" onSubmit={submit}>
            <Field label="Item"><select value={form.item_id} onChange={(event) => update('item_id', event.target.value)} required><option value="">Choose an item</option>{physicalItems.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
            {selectedItem && <div className="selected-item-summary"><span>{selectedItem.name}<StockPill value={selectedItem.stock} /></span><strong>Guide: {gemRange(selectedItem, form.quantity)}</strong></div>}
            <div className="form-grid form-grid--2">
              <Field label="Item quantity"><input type="number" min="0.000001" step="any" inputMode="decimal" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} required /></Field>
              <Field label={mode === 'convert' ? 'Gems received' : 'Gems spent'}><div className="input-with-suffix"><input type="number" min="0.000001" step="any" inputMode="decimal" placeholder="0" value={form.gems} onChange={(event) => update('gems', event.target.value)} required /><span>Gems</span></div></Field>
            </div>
            {selectedItem?.gem_value_min != null && <button className="suggestion-link" type="button" onClick={useSuggestedValue}><Sparkles size={15} />Use midpoint of the saved Gem value</button>}
            <Field label="Date & time"><input type="datetime-local" value={form.event_at} onChange={(event) => update('event_at', event.target.value)} required /></Field>
            <Field label="Notes" hint="Optional"><textarea rows="3" value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Conversion or purchase details…" /></Field>
            <Button type="submit" loading={submitting}>{mode === 'convert' ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}{mode === 'convert' ? 'Convert to Gems' : 'Buy with Gems'}</Button>
          </form>
        </Card>

        <Card className="dashboard-panel gem-history">
          <SectionHeading title="Gem transaction history" description="One row per item-side conversion or purchase." action={<History size={19} />} />
          {history.length === 0 ? <EmptyState title="No Gem transactions yet" description="Your conversion and purchase history will appear here." icon={ArrowRightLeft} /> : (
            <div className="event-list">
              {history.map((event) => {
                const converting = event.event_type === 'gem_conversion'
                return <div className="event-list__row" key={event.id}><span className={`event-direction ${converting ? 'is-in' : 'is-out'}`}>{converting ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><div><strong>{converting ? `${event.item.name} → Gems` : `Gems → ${event.item.name}`}</strong><small>{formatDateTime(event.event_at)}{event.notes ? ` · ${event.notes}` : ''}</small></div><div><strong className={converting ? 'text-positive' : 'text-negative'}>{converting ? '+' : '−'}{formatQuantity(Math.abs(toNumber(event.gem_amount)))} Gems</strong><small>{formatQuantity(Math.abs(toNumber(event.quantity_delta)))} {event.item.name}</small></div></div>
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
