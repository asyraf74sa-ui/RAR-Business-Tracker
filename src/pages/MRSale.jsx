import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Armchair, Minus, Plus, ReceiptText, ShoppingBag } from 'lucide-react'
import { Button, Card, Field, PageHeader, SectionHeading } from '../components/ui.jsx'
import { CLASSIFICATIONS, CURRENCIES } from '../lib/constants.js'
import { formatMoney, formatQuantity, getRequestId, localDateTimeValue, rotateRequestId, toNumber } from '../lib/format.js'
import { assertMRStock, selectionValue, toMRRpcPayload } from '../lib/mr-operations.js'
import { readableError, supabase } from '../lib/supabase.js'

const newLine = () => ({ id: crypto.randomUUID(), selection: '', quantity: '1' })

export default function MRSale({ data, refresh, notify, onNavigate }) {
  const activeItems = useMemo(() => data.mr.items.filter((item) => !item.is_archived).sort((a, b) => a.name.localeCompare(b.name)), [data.mr.items])
  const activeFamilies = useMemo(() => data.mr.setFamilies.filter((family) => family.active).sort((a, b) => a.name.localeCompare(b.name)), [data.mr.setFamilies])
  const [form, setForm] = useState({ sold_at: localDateTimeValue(), platform: data.platforms.find((platform) => platform.active)?.name || '', currency: 'USD', net_credit: '', platform_fee: '', classification: 'normal', notes: '' })
  const [lines, setLines] = useState([newLine()])
  const [submitting, setSubmitting] = useState(false)
  const lock = useRef(false)
  const requestId = useRef(getRequestId('mr-sale'))
  const catalog = { items: data.mr.items, setFamilies: data.mr.setFamilies }
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const updateLine = (id, key, value) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line))

  const submit = async (event) => {
    event.preventDefault()
    if (lock.current) return
    if (!form.sold_at || !form.platform || !CURRENCIES.includes(form.currency) || form.net_credit === '' || form.platform_fee === '' || toNumber(form.net_credit, -1) < 0 || toNumber(form.platform_fee, -1) < 0) {
      notify('error', 'Complete the sale date, platform, currency, net credit, and fee with valid values.')
      return
    }
    try {
      assertMRStock(lines, catalog)
    } catch (error) {
      notify('error', error.message)
      return
    }

    lock.current = true
    setSubmitting(true)
    try {
      const intendedSoldAt = new Date(form.sold_at).toISOString()
      const { data: saleId, error } = await supabase.rpc('mr_record_sale', {
        p_sold_at: intendedSoldAt,
        p_platform: form.platform,
        p_net_credit: Number(form.net_credit),
        p_platform_fee: Number(form.platform_fee),
        p_currency: form.currency,
        p_classification: form.classification,
        p_notes: form.notes.trim() || null,
        p_items: toMRRpcPayload(lines),
        p_inventory_applied: true,
        p_request_id: requestId.current,
      })
      if (error) throw error
      const { data: saved, error: verifyError } = await supabase.from('mr_sales').select('id,platform,currency,net_credit,platform_fee').eq('id', saleId).single()
      if (verifyError || !saved || saved.platform !== form.platform || saved.currency !== form.currency) throw new Error('The MR sale saved but could not be verified. Check MR History before retrying.')
      await refresh()
      requestId.current = rotateRequestId('mr-sale')
      notify('success', 'MR sale recorded. The backend deducted all component stock atomically.')
      setForm((current) => ({ ...current, sold_at: localDateTimeValue(), net_credit: '', platform_fee: '', notes: '' }))
      setLines([newLine()])
      onNavigate('history')
    } catch (error) {
      notify('error', readableError(error, 'The MR sale could not be confirmed. Check MR History before retrying.'))
    } finally {
      lock.current = false
      setSubmitting(false)
    }
  }

  const gross = toNumber(form.net_credit) + toNumber(form.platform_fee)
  return (
    <div className="page-stack">
      <PageHeader eyebrow="MR · New transaction" title="Record an MR sale" description="Items and furniture sets use the same atomic production sale contract as Discord." />
      <form className="sale-layout" onSubmit={submit}>
        <div className="sale-layout__main page-stack page-stack--compact">
          <Card className="form-card">
            <SectionHeading title="Wallet details" description="Net credit is what reached your wallet. The fee stays separate." />
            <div className="form-grid form-grid--2">
              <Field label="Date & time"><input type="datetime-local" value={form.sold_at} onChange={(event) => update('sold_at', event.target.value)} required /></Field>
              <Field label="Platform"><select value={form.platform} onChange={(event) => update('platform', event.target.value)} required><option value="">Select platform</option>{data.platforms.filter((platform) => platform.active).map((platform) => <option key={platform.id}>{platform.name}</option>)}</select></Field>
              <Field label="Currency"><select value={form.currency} onChange={(event) => update('currency', event.target.value)}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
              <Field label="Classification"><select value={form.classification} onChange={(event) => update('classification', event.target.value)}>{CLASSIFICATIONS.map((entry) => <option value={entry.value} key={entry.value}>{entry.label}</option>)}</select></Field>
              <Field label="Actual wallet / net credit" hint="Already after fees"><div className="money-input"><span>{form.currency}</span><input type="number" min="0" step="any" value={form.net_credit} onChange={(event) => update('net_credit', event.target.value)} required /></div></Field>
              <Field label="Platform fee" hint="Enter the actual amount"><div className="money-input"><span>{form.currency}</span><input type="number" min="0" step="any" value={form.platform_fee} onChange={(event) => update('platform_fee', event.target.value)} required /></div></Field>
            </div>
            <Field label="Notes" hint="Optional"><textarea rows="3" value={form.notes} onChange={(event) => update('notes', event.target.value)} /></Field>
          </Card>
          <Card className="form-card">
            <SectionHeading title="MR bundle" description="Set choices expand to one table and four chairs per set inside Supabase." action={<Button type="button" size="small" variant="secondary" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={16} />Add line</Button>} />
            <div className="bundle-list">{lines.map((line, index) => <div className="bundle-row" key={line.id}><span className="bundle-row__number">{index + 1}</span><label><span>Item or set</span><select value={line.selection} onChange={(event) => updateLine(line.id, 'selection', event.target.value)} required><option value="">Choose item or set</option><optgroup label="Furniture sets">{activeFamilies.map((family) => <option value={selectionValue('set', family.id)} key={family.id}>{family.aliases[0] || `${family.name} Set`}</option>)}</optgroup><optgroup label="MR items">{activeItems.map((item) => <option value={selectionValue('item', item.id)} key={item.id}>{item.name} · {formatQuantity(item.current_quantity)} available</option>)}</optgroup></select></label><label><span>Quantity</span><input type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', event.target.value)} required /></label><div className="bundle-row__stock"><Armchair size={16} /><span>MR catalog</span></div><button type="button" className="remove-line" aria-label={`Remove MR bundle row ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}><Minus size={17} /></button></div>)}</div>
          </Card>
        </div>
        <aside className="sale-summary"><Card><div className="sale-summary__icon"><ReceiptText size={22} /></div><h2>MR sale summary</h2><div className="summary-lines"><span>Net received <strong>{formatMoney(form.net_credit, form.currency)}</strong></span><span>Platform fee <strong>{formatMoney(form.platform_fee, form.currency)}</strong></span><span className="summary-lines__total">Gross sale <strong>{formatMoney(gross, form.currency)}</strong></span></div><div className="summary-bundle"><span><ShoppingBag size={16} />{lines.length} bundle lines</span></div><div className="accounting-note"><AlertTriangle size={17} /><p>Inventory changes only through <code>mr_record_sale</code>. Fees are not subtracted twice.</p></div><Button type="submit" loading={submitting}>Record MR sale</Button></Card></aside>
      </form>
    </div>
  )
}
