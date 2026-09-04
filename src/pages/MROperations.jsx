import { useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Minus, PackagePlus, Plus } from 'lucide-react'
import { Button, Card, Field, PageHeader, SectionHeading } from '../components/ui.jsx'
import { CURRENCIES } from '../lib/constants.js'
import { formatQuantity, getRequestId, localDateTimeValue, rotateRequestId } from '../lib/format.js'
import { assertDisjointMRTrade, selectionValue, toMRRpcPayload } from '../lib/mr-operations.js'
import { readableError, supabase } from '../lib/supabase.js'

const newLine = () => ({ id: crypto.randomUUID(), selection: '', quantity: '1' })

function LineEditor({ title, description, lines, setLines, items, families, tone }) {
  const updateLine = (id, key, value) => setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line))
  return <section className={`operation-lines operation-lines--${tone}`}><SectionHeading title={title} description={description} action={<Button type="button" size="small" variant="secondary" onClick={() => setLines((current) => [...current, newLine()])}><Plus size={15} />Add</Button>} /><div className="bundle-list">{lines.map((line, index) => <div className="bundle-row bundle-row--compact" key={line.id}><span className="bundle-row__number">{index + 1}</span><label><span>Item or set</span><select value={line.selection} onChange={(event) => updateLine(line.id, 'selection', event.target.value)} required><option value="">Choose</option><optgroup label="Furniture sets">{families.map((family) => <option value={selectionValue('set', family.id)} key={family.id}>{family.aliases[0] || `${family.name} Set`}</option>)}</optgroup><optgroup label="MR items">{items.map((item) => <option value={selectionValue('item', item.id)} key={item.id}>{item.name} · {formatQuantity(item.current_quantity)}</option>)}</optgroup></select></label><label><span>Quantity</span><input type="number" min="0.000001" step="any" value={line.quantity} onChange={(event) => updateLine(line.id, 'quantity', event.target.value)} required /></label><button type="button" className="remove-line" aria-label={`Remove ${title} row ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}><Minus size={16} /></button></div>)}</div></section>
}

export default function MROperations({ data, refresh, notify }) {
  const [mode, setMode] = useState('purchase')
  const [purchaseLines, setPurchaseLines] = useState([newLine()])
  const [giveLines, setGiveLines] = useState([newLine()])
  const [receiveLines, setReceiveLines] = useState([newLine()])
  const [form, setForm] = useState({ event_at: localDateTimeValue(), cash_amount: '', cash_currency: 'MYR', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const lock = useRef(false)
  const purchaseId = useRef(getRequestId('mr-purchase'))
  const tradeId = useRef(getRequestId('mr-trade'))
  const items = useMemo(() => data.mr.items.filter((item) => !item.is_archived).sort((a, b) => a.name.localeCompare(b.name)), [data.mr.items])
  const families = useMemo(() => data.mr.setFamilies.filter((family) => family.active).sort((a, b) => a.name.localeCompare(b.name)), [data.mr.setFamilies])
  const catalog = { items: data.mr.items, setFamilies: data.mr.setFamilies }
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (lock.current) return
    let params
    let rpc
    try {
      if (mode === 'purchase') {
        const cost = Number(form.cash_amount)
        if (!Number.isFinite(cost) || cost < 0) throw new Error('Enter a non-negative total acquisition cost.')
        params = { p_items: toMRRpcPayload(purchaseLines), p_cash_amount: cost, p_cash_currency: form.cash_currency, p_event_at: new Date(form.event_at).toISOString(), p_notes: form.notes.trim() || null, p_request_id: purchaseId.current }
        rpc = 'mr_record_purchase_bundle'
      } else {
        assertDisjointMRTrade(giveLines, receiveLines, catalog)
        params = { p_give_items: toMRRpcPayload(giveLines), p_receive_items: toMRRpcPayload(receiveLines), p_event_at: new Date(form.event_at).toISOString(), p_notes: form.notes.trim() || null, p_request_id: tradeId.current }
        rpc = 'mr_record_trade'
      }
    } catch (error) {
      notify('error', error.message)
      return
    }

    lock.current = true
    setSubmitting(true)
    try {
      const { data: result, error } = await supabase.rpc(rpc, params)
      if (error) throw error
      if (result == null) throw new Error('The MR operation did not return a confirmation.')
      await refresh()
      if (mode === 'purchase') {
        purchaseId.current = rotateRequestId('mr-purchase')
        setPurchaseLines([newLine()])
      } else {
        tradeId.current = rotateRequestId('mr-trade')
        setGiveLines([newLine()])
        setReceiveLines([newLine()])
      }
      setForm((current) => ({ ...current, event_at: localDateTimeValue(), cash_amount: '', notes: '' }))
      notify('success', mode === 'purchase' ? 'MR purchase recorded and stock added atomically.' : 'MR trade recorded. GIVE and RECEIVE stock moved atomically with no income created.')
    } catch (error) {
      notify('error', readableError(error, `The MR ${mode} could not be confirmed. Refresh before retrying.`))
    } finally {
      lock.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="MR Operations" title="Purchases & trades" description="Incoming bundles and two-sided trades remain separate from sales income." />
      <div className="mode-tabs native-mode-tabs" role="group" aria-label="MR operation type"><button type="button" aria-pressed={mode === 'purchase'} className={mode === 'purchase' ? 'is-active' : ''} onClick={() => setMode('purchase')}><PackagePlus size={17} />Purchase</button><button type="button" aria-pressed={mode === 'trade'} className={mode === 'trade' ? 'is-active' : ''} onClick={() => setMode('trade')}><ArrowRightLeft size={17} />Trade</button></div>
      <form className="operations-layout" onSubmit={submit}>
        <Card className="form-card operations-layout__main">
          {mode === 'purchase' ? <LineEditor title="Purchased bundle" description="All lines share one total acquisition cost." lines={purchaseLines} setLines={setPurchaseLines} items={items} families={families} tone="in" /> : <div className="trade-columns"><LineEditor title="GIVE" description="Stock leaving MR inventory." lines={giveLines} setLines={setGiveLines} items={items} families={families} tone="out" /><span className="trade-arrow" aria-hidden="true"><ArrowRightLeft size={20} /></span><LineEditor title="RECEIVE" description="Stock entering MR inventory." lines={receiveLines} setLines={setReceiveLines} items={items} families={families} tone="in" /></div>}
        </Card>
        <Card className="form-card operations-layout__details">
          <SectionHeading title={mode === 'purchase' ? 'Acquisition details' : 'Trade details'} description={mode === 'purchase' ? 'Cost is recorded once for the entire bundle.' : 'Trades create no income or purchase spending.'} />
          {mode === 'purchase' && <><Field label="Total acquisition cost"><div className="money-input"><span>{form.cash_currency}</span><input type="number" min="0" step="any" value={form.cash_amount} onChange={(event) => update('cash_amount', event.target.value)} required /></div></Field><Field label="Currency"><select value={form.cash_currency} onChange={(event) => update('cash_currency', event.target.value)}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field></>}
          <Field label="Date & time"><input type="datetime-local" value={form.event_at} onChange={(event) => update('event_at', event.target.value)} required /></Field>
          <Field label="Notes" hint="Optional"><textarea rows="4" value={form.notes} onChange={(event) => update('notes', event.target.value)} /></Field>
          <Button type="submit" loading={submitting}>{mode === 'purchase' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}{mode === 'purchase' ? 'Record MR purchase' : 'Record MR trade'}</Button>
        </Card>
      </form>
    </div>
  )
}
