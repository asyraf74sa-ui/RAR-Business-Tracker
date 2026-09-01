import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Calculator, Coins, Minus, Plus, ReceiptText, ShoppingBag } from 'lucide-react'
import { Button, Card, Field, PageHeader, SectionHeading, StockPill } from '../components/ui.jsx'
import { CLASSIFICATIONS, CURRENCIES } from '../lib/constants.js'
import { formatMoney, formatQuantity, localDateTimeValue, toNumber } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

const newLine = () => ({ id: crypto.randomUUID(), item_id: '', quantity: '1' })

export default function RecordSale({ data, refresh, notify, onNavigate }) {
  const [form, setForm] = useState({
    sold_at: localDateTimeValue(),
    platform: data.platforms.find((platform) => platform.active)?.name || '',
    currency: 'USD',
    net_credit: '',
    platform_fee: '',
    classification: 'normal',
    notes: '',
  })
  const [lines, setLines] = useState([newLine()])
  const [submitting, setSubmitting] = useState(false)
  const submitLock = useRef(false)
  const activeItems = useMemo(() => data.items.filter((item) => item.active).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)), [data.items])
  const activePlatforms = data.platforms.filter((platform) => platform.active)
  const selectedPlatform = data.platforms.find((platform) => platform.name === form.platform)
  const feePercent = selectedPlatform?.default_fee_pct == null ? null : toNumber(selectedPlatform.default_fee_pct)
  const gross = toNumber(form.net_credit) + toNumber(form.platform_fee)

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const updateLine = (id, key, value) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line))

  const applyFeeGuide = () => {
    const net = toNumber(form.net_credit)
    if (!net || feePercent == null || feePercent >= 100) {
      notify('info', 'Enter the wallet credit first to apply this fee guide.')
      return
    }
    const fee = net * feePercent / (100 - feePercent)
    updateForm('platform_fee', fee.toFixed(2))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (submitLock.current) return

    if (!form.sold_at || !form.platform || !CURRENCIES.includes(form.currency)) {
      notify('error', 'Complete the sale date, platform, and currency.')
      return
    }
    if (form.net_credit === '' || toNumber(form.net_credit, -1) < 0 || form.platform_fee === '' || toNumber(form.platform_fee, -1) < 0) {
      notify('error', 'Net credit and platform fee must be zero or more.')
      return
    }
    if (lines.some((line) => !line.item_id || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) {
      notify('error', 'Choose an item and enter a positive quantity for every bundle row.')
      return
    }
    const uniqueIds = new Set(lines.map((line) => line.item_id))
    if (uniqueIds.size !== lines.length) {
      notify('error', 'Each item can appear only once. Increase its quantity instead of adding a duplicate row.')
      return
    }

    submitLock.current = true
    setSubmitting(true)
    try {
      const ids = [...uniqueIds]
      const { data: latestItems, error: stockError } = await supabase.from('rar_items').select('id,name,stock,active').in('id', ids)
      if (stockError) throw stockError

      for (const line of lines) {
        const latest = latestItems.find((item) => item.id === line.item_id)
        if (!latest || !latest.active) throw new Error('One selected item is no longer available. Refresh and try again.')
        if (toNumber(latest.stock) < Number(line.quantity)) throw new Error(`${latest.name} has only ${formatQuantity(latest.stock)} in stock.`)
      }

      const saleLines = lines.map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity), unit_gross_price: null }))
      const { data: saleId, error } = await supabase.rpc('rar_record_sale', {
        p_sold_at: new Date(form.sold_at).toISOString(),
        p_platform: form.platform,
        p_net_credit: Number(form.net_credit),
        p_platform_fee: Number(form.platform_fee),
        p_currency: form.currency,
        p_classification: form.classification,
        p_notes: form.notes.trim() || null,
        p_items: saleLines,
        p_inventory_applied: true,
      })
      if (error) throw error
      if (!saleId) throw new Error('The sale did not return a confirmation ID.')

      const { data: savedLines, error: verifyError } = await supabase.from('rar_sale_items').select('item_id,quantity').eq('sale_id', saleId)
      if (verifyError || savedLines?.length !== saleLines.length) throw new Error('The sale saved, but its bundle could not be fully verified. Review Sales history before retrying.')

      await refresh()
      notify('success', `Sale recorded on ${form.platform}. Inventory was deducted once for ${saleLines.length} ${saleLines.length === 1 ? 'item' : 'bundle items'}.`)
      setForm((current) => ({ ...current, sold_at: localDateTimeValue(), net_credit: '', platform_fee: '', notes: '' }))
      setLines([newLine()])
      onNavigate('history')
    } catch (error) {
      notify('error', readableError(error, 'The sale could not be recorded. No retry was attempted.'))
    } finally {
      submitLock.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="New transaction" title="Record a sale" description="Single item, multi-item bundle, or Gems—one sale and one inventory deduction." />

      <form className="sale-layout" onSubmit={submit}>
        <div className="sale-layout__main page-stack page-stack--compact">
          <Card className="form-card">
            <SectionHeading title="Sale details" description="Enter what actually reached your wallet and the fee charged." />
            <div className="form-grid form-grid--2">
              <Field label="Date & time"><input type="datetime-local" value={form.sold_at} onChange={(event) => updateForm('sold_at', event.target.value)} required /></Field>
              <Field label="Platform">
                <select value={form.platform} onChange={(event) => updateForm('platform', event.target.value)} required>
                  <option value="">Select platform</option>
                  {activePlatforms.map((platform) => <option key={platform.id} value={platform.name}>{platform.name}</option>)}
                </select>
              </Field>
              <Field label="Currency"><select value={form.currency} onChange={(event) => updateForm('currency', event.target.value)}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
              <Field label="Classification"><select value={form.classification} onChange={(event) => updateForm('classification', event.target.value)}>{CLASSIFICATIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></Field>
              <Field label="Actual wallet / net credit" hint="What you received after fees"><div className="money-input"><span>{form.currency}</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0.00" value={form.net_credit} onChange={(event) => updateForm('net_credit', event.target.value)} required /></div></Field>
              <Field label="Platform fee" hint="Enter the actual fee amount"><div className="money-input"><span>{form.currency}</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0.00" value={form.platform_fee} onChange={(event) => updateForm('platform_fee', event.target.value)} required /></div></Field>
            </div>

            {feePercent != null && (
              <div className="fee-guide"><span><Calculator size={17} /><strong>{formatQuantity(feePercent)}% {form.platform} guide</strong><small>Estimated from your net credit; confirm against the real fee.</small></span><Button type="button" variant="secondary" size="small" onClick={applyFeeGuide}>Apply guide</Button></div>
            )}

            <Field label="Notes" hint="Optional order reference, buyer, or context"><textarea rows="3" placeholder="Anything useful about this sale…" value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></Field>
          </Card>

          <Card className="form-card">
            <SectionHeading title="Bundle contents" description="Each selected line is deducted automatically when the sale saves." action={<Button type="button" variant="secondary" size="small" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={16} />Add item</Button>} />
            <div className="bundle-list">
              {lines.map((line, index) => {
                const item = activeItems.find((entry) => entry.id === line.item_id)
                return (
                  <div className="bundle-row" key={line.id}>
                    <span className="bundle-row__number">{index + 1}</span>
                    <label><span>Item</span><select value={line.item_id} onChange={(event) => updateLine(line.id, 'item_id', event.target.value)} required><option value="">Choose item</option><optgroup label="Physical items">{activeItems.filter((entry) => entry.kind === 'item').map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {formatQuantity(entry.stock)} available</option>)}</optgroup><optgroup label="Currency">{activeItems.filter((entry) => entry.kind === 'currency').map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {formatQuantity(entry.stock)} available</option>)}</optgroup></select></label>
                    <label><span>Quantity</span><input type="number" min="0.000001" step="any" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', event.target.value)} required /></label>
                    <div className="bundle-row__stock">{item ? <><StockPill value={item.stock} />{item.kind === 'currency' && <span className="gem-label"><Coins size={13} />Gem wallet</span>}</> : <span>Select an item</span>}</div>
                    <button type="button" className="remove-line" aria-label={`Remove bundle row ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}><Minus size={17} /></button>
                  </div>
                )
              })}
            </div>
            <button type="button" className="add-line-mobile" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={17} />Add another item</button>
          </Card>
        </div>

        <aside className="sale-summary">
          <Card>
            <div className="sale-summary__icon"><ReceiptText size={22} /></div>
            <h2>Sale summary</h2>
            <div className="summary-lines"><span>Net received <strong>{formatMoney(form.net_credit, form.currency)}</strong></span><span>Platform fee <strong>{formatMoney(form.platform_fee, form.currency)}</strong></span><span className="summary-lines__total">Gross sale <strong>{formatMoney(gross, form.currency)}</strong></span></div>
            <div className="summary-bundle"><span><ShoppingBag size={16} />{lines.length} bundle {lines.length === 1 ? 'line' : 'lines'}</span><strong>{formatQuantity(lines.reduce((sum, line) => sum + toNumber(line.quantity), 0))} total units</strong></div>
            <div className="accounting-note"><AlertTriangle size={17} /><p>Saving calls <code>rar_record_sale</code> once. Do not refresh while it is processing.</p></div>
            <Button type="submit" loading={submitting} className="sale-submit">Record sale & deduct stock</Button>
          </Card>
        </aside>
      </form>
    </div>
  )
}
