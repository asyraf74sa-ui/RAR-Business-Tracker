import { useMemo, useRef, useState } from 'react'
import { PackageCheck, PackagePlus, Receipt, Truck } from 'lucide-react'
import { Button, Card, EmptyState, Field, PageHeader, SectionHeading, StockPill } from '../components/ui.jsx'
import { CURRENCIES } from '../lib/constants.js'
import { formatDateTime, formatMoney, formatQuantity, getRequestId, localDateTimeValue, numbersEqual, rotateRequestId, toNumber } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

export default function Purchases({ data, refresh, notify }) {
  const [form, setForm] = useState({ item_id: '', quantity: '1', cash_amount: '', cash_currency: 'MYR', event_at: localDateTimeValue(), notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const requestId = useRef(getRequestId('purchase'))
  const items = data.items.filter((item) => item.kind === 'item' && item.active).sort((a, b) => a.name.localeCompare(b.name))
  const selectedItem = items.find((item) => item.id === form.item_id)
  const history = useMemo(() => data.inventoryEvents.filter((event) => event.event_type === 'supplier_purchase').map((event) => ({ ...event, item: data.items.find((item) => item.id === event.item_id) })).filter((event) => event.item).slice(0, 30), [data.inventoryEvents, data.items])
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (submitLock.current) return
    const quantity = Number(form.quantity)
    const cost = Number(form.cash_amount)
    if (!form.item_id || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0) {
      notify('error', 'Choose an item, enter a positive quantity, and enter a non-negative total cost.')
      return
    }

    submitLock.current = true
    setSubmitting(true)
    try {
      const { data: before, error: beforeError } = await supabase.from('rar_items').select('name,stock').eq('id', form.item_id).single()
      if (beforeError) throw beforeError
      const { data: result, error } = await supabase.rpc('rar_record_purchase', {
        p_item_id: form.item_id,
        p_quantity: quantity,
        p_cash_amount: cost,
        p_cash_currency: form.cash_currency,
        p_event_at: new Date(form.event_at).toISOString(),
        p_notes: form.notes.trim() || null,
        p_request_id: requestId.current,
      })
      if (error) throw error
      const resultQuantity = toNumber(result)
      const duplicate = resultQuantity < 0
      if (!numbersEqual(Math.abs(resultQuantity), quantity)) throw new Error('The purchase returned an unexpected stock quantity.')

      const { data: after, error: verifyError } = await supabase.from('rar_items').select('stock').eq('id', form.item_id).single()
      const appliedBalanceMatches = numbersEqual(after?.stock, toNumber(before.stock) + quantity)
      const unchangedBalanceMatches = numbersEqual(after?.stock, before.stock)
      if (verifyError || (!duplicate && !appliedBalanceMatches) || (duplicate && !appliedBalanceMatches && !unchangedBalanceMatches)) throw new Error('The purchase saved but the stock increase could not be verified. Refresh before retrying.')

      await refresh()
      requestId.current = rotateRequestId('purchase')
      notify('success', duplicate ? 'This supplier purchase was already recorded. Stock was not added twice.' : `${formatQuantity(quantity)} ${before.name} added to stock.`)
      setForm({ item_id: '', quantity: '1', cash_amount: '', cash_currency: form.cash_currency, event_at: localDateTimeValue(), notes: '' })
    } catch (error) {
      notify('error', readableError(error, 'The supplier purchase could not be confirmed. Refresh stock before trying again.'))
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Supplier stock" title="Record a purchase" description="Add incoming item stock and keep its cash cost in the original currency." />
      <div className="purchase-layout">
        <Card className="form-card">
          <SectionHeading title="Purchase details" description="The full quantity is added through rar_record_purchase." />
          <form className="form-stack" onSubmit={submit}>
            <Field label="Item"><select value={form.item_id} onChange={(event) => update('item_id', event.target.value)} required><option value="">Choose an item</option>{items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field>
            {selectedItem && <div className="selected-item-summary"><span>{selectedItem.name}<StockPill value={selectedItem.stock} /></span><strong>After purchase: {formatQuantity(toNumber(selectedItem.stock) + toNumber(form.quantity))}</strong></div>}
            <div className="form-grid form-grid--2">
              <Field label="Quantity"><input type="number" min="0.000001" step="any" inputMode="decimal" value={form.quantity} onChange={(event) => update('quantity', event.target.value)} required /></Field>
              <Field label="Currency"><select value={form.cash_currency} onChange={(event) => update('cash_currency', event.target.value)}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
            </div>
            <Field label="Total cash cost"><div className="money-input"><span>{form.cash_currency}</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0.00" value={form.cash_amount} onChange={(event) => update('cash_amount', event.target.value)} required /></div></Field>
            <Field label="Date & time"><input type="datetime-local" value={form.event_at} onChange={(event) => update('event_at', event.target.value)} required /></Field>
            <Field label="Notes" hint="Optional supplier or order reference"><textarea rows="3" value={form.notes} onChange={(event) => update('notes', event.target.value)} placeholder="Supplier, invoice, or delivery details…" /></Field>
            <Button type="submit" loading={submitting}><PackagePlus size={18} />Add purchase to stock</Button>
          </form>
        </Card>

        <Card className="dashboard-panel purchase-history">
          <SectionHeading title="Purchase history" description="Latest incoming stock and cash costs." action={<Truck size={20} />} />
          {history.length === 0 ? <EmptyState title="No supplier purchases" description="Your next delivery will be listed here." icon={PackageCheck} /> : (
            <div className="event-list">
              {history.map((event) => <div className="event-list__row" key={event.id}><span className="event-direction is-in"><Receipt size={17} /></span><div><strong>{event.item.name}</strong><small>{formatDateTime(event.event_at)}{event.notes ? ` · ${event.notes}` : ''}</small></div><div><strong>+{formatQuantity(event.quantity_delta)}</strong><small>{event.cash_currency ? formatMoney(event.cash_amount, event.cash_currency) : 'Cost not set'}</small></div></div>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
