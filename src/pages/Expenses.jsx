import { useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, CalendarRange, Edit3, Plus, RotateCcw, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { Button, Card, CurrencyStrip, Dialog, EmptyState, Field, PageHeader, StatusBadge } from '../components/ui.jsx'
import { expensesForWorkspace, filterRowsByDate } from '../lib/business-workspaces.js'
import { CURRENCIES } from '../lib/constants.js'
import { formatDateTime, formatMoney, toNumber } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

const DEFAULT_CATEGORIES = ['Other', 'Cloud / VPS', 'Software', 'Advertising', 'Infrastructure', 'Subscriptions', 'Marketplace Tools']

function localDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function emptyForm(scope) {
  return {
    requestId: crypto.randomUUID(),
    incurredAt: localDateTime(),
    workspace: scope === 'all' ? 'SHARED' : scope.toUpperCase(),
    amount: '',
    currency: 'USD',
    description: '',
    category: 'Other',
    notes: '',
  }
}

function expenseTotals(expenses) {
  const totals = Object.fromEntries(CURRENCIES.map((currency) => [currency, 0]))
  expenses.filter((expense) => !expense.voided_at).forEach((expense) => {
    if (expense.currency in totals) totals[expense.currency] += toNumber(expense.amount)
  })
  return totals
}

export default function Expenses({ data, scope, refresh, notify }) {
  const [form, setForm] = useState(() => emptyForm(scope))
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [voiding, setVoiding] = useState(null)
  const [voidReason, setVoidReason] = useState('Entered incorrectly')
  const [filters, setFilters] = useState({ search: '', category: 'ALL', currency: 'ALL', workspace: 'ALL', status: 'ACTIVE', from: '', to: '' })

  useEffect(() => {
    setEditingId(null)
    setForm(emptyForm(scope))
  }, [scope])

  const scopedExpenses = useMemo(() => expensesForWorkspace(data, scope), [data, scope])
  const categories = useMemo(() => [...new Set([
    ...DEFAULT_CATEGORIES,
    ...scopedExpenses.map((expense) => expense.category).filter(Boolean),
  ])].sort((left, right) => left.localeCompare(right)), [scopedExpenses])
  const rows = useMemo(() => filterRowsByDate(scopedExpenses, 'incurred_at', filters.from, filters.to)
    .filter((expense) => filters.status === 'ALL' || (filters.status === 'VOIDED' ? expense.voided_at : !expense.voided_at))
    .filter((expense) => filters.workspace === 'ALL' || expense.workspace === filters.workspace)
    .filter((expense) => filters.currency === 'ALL' || expense.currency === filters.currency)
    .filter((expense) => filters.category === 'ALL' || expense.category === filters.category)
    .filter((expense) => {
      const needle = filters.search.trim().toLowerCase()
      return !needle || [expense.description, expense.category, expense.notes, expense.source]
        .some((value) => String(value || '').toLowerCase().includes(needle))
    })
    .sort((left, right) => new Date(right.incurred_at) - new Date(left.incurred_at)), [scopedExpenses, filters])
  const totals = useMemo(() => expenseTotals(scopedExpenses), [scopedExpenses])

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const resetForm = () => {
    setEditingId(null)
    setForm(emptyForm(scope))
  }

  const submit = async (event) => {
    event.preventDefault()
    const amount = Number(form.amount)
    const instant = new Date(form.incurredAt)
    if (!Number.isFinite(amount) || amount <= 0) return notify('error', 'Enter an expense amount greater than zero.')
    if (!form.description.trim()) return notify('error', 'Enter an expense description.')
    if (Number.isNaN(instant.getTime())) return notify('error', 'Choose a valid expense date and time.')

    setSaving(true)
    try {
      const payload = {
        p_incurred_at: instant.toISOString(),
        p_workspace: form.workspace,
        p_amount: amount,
        p_currency: form.currency,
        p_description: form.description.trim(),
        p_category: form.category.trim() || 'Other',
        p_notes: form.notes.trim() || null,
      }
      const { data: result, error } = editingId
        ? await supabase.rpc('update_business_expense', { p_expense_id: editingId, ...payload })
        : await supabase.rpc('record_business_expense', {
            ...payload,
            p_request_id: form.requestId,
            p_source: 'website',
          })
      if (error) throw error

      const duplicate = !editingId && Array.isArray(result) && result[0]?.duplicate
      await refresh()
      resetForm()
      notify('success', duplicate ? 'That expense was already recorded safely.' : editingId ? 'Expense updated.' : 'Expense recorded.')
    } catch (error) {
      notify('error', readableError(error, 'The expense could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const editExpense = (expense) => {
    if (expense.voided_at) return
    setEditingId(expense.id)
    setForm({
      requestId: expense.request_id,
      incurredAt: localDateTime(expense.incurred_at),
      workspace: expense.workspace,
      amount: String(expense.amount),
      currency: expense.currency,
      description: expense.description,
      category: expense.category || 'Other',
      notes: expense.notes || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const confirmVoid = async () => {
    if (!voiding) return
    setSaving(true)
    try {
      const { error } = await supabase.rpc('void_business_expense', {
        p_expense_id: voiding.id,
        p_void_reason: voidReason.trim() || 'Voided by user',
      })
      if (error) throw error
      await refresh()
      if (editingId === voiding.id) resetForm()
      setVoiding(null)
      notify('success', 'Expense voided. Historical audit details were preserved.')
    } catch (error) {
      notify('error', readableError(error, 'The expense could not be voided.'))
    } finally {
      setSaving(false)
    }
  }

  const scopeLabel = scope === 'all' ? 'All Business' : scope.toUpperCase()

  return (
    <div className="page-stack expenses-page">
      <PageHeader
        eyebrow={`${scopeLabel} operating ledger`}
        title="Business expenses"
        description="Record non-inventory operating costs. Expenses reduce True Net Profit without changing stock or sales."
      />

      <section className="expense-overview">
        <Card className="expense-entry-card">
          <div className="expense-entry-card__heading">
            <span><BadgeDollarSign size={21} /></span>
            <div><h2>{editingId ? 'Edit expense' : 'Add expense'}</h2><p>Original currency is preserved as the authoritative amount.</p></div>
            {editingId && <Button type="button" variant="ghost" size="small" onClick={resetForm}><RotateCcw size={15} />Cancel edit</Button>}
          </div>
          <form className="expense-form" onSubmit={submit}>
            <Field label="Date and time"><input type="datetime-local" max={localDateTime()} value={form.incurredAt} onChange={(event) => setField('incurredAt', event.target.value)} required /></Field>
            {scope === 'all' ? <Field label="Workspace"><select value={form.workspace} onChange={(event) => setField('workspace', event.target.value)}><option value="RAR">RAR</option><option value="MR">MR</option><option value="SHARED">Shared business</option></select></Field> : <Field label="Workspace"><input value={form.workspace} disabled /></Field>}
            <Field label="Amount"><input type="number" min="0.01" max="1000000000000000" step="any" inputMode="decimal" value={form.amount} onChange={(event) => setField('amount', event.target.value)} placeholder="0.00" required /></Field>
            <Field label="Currency"><select value={form.currency} onChange={(event) => setField('currency', event.target.value)}>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
            <Field label="Description" className="expense-form__wide"><input maxLength="500" value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="e.g. Discord bot hosting" required /></Field>
            <Field label="Category"><input list="expense-categories" maxLength="80" value={form.category} onChange={(event) => setField('category', event.target.value)} /><datalist id="expense-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></Field>
            <Field label="Notes" className="expense-form__wide"><textarea maxLength="2000" rows="3" value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="Optional context" /></Field>
            <div className="expense-form__action"><Button type="submit" loading={saving}><Plus size={17} />{editingId ? 'Save changes' : 'Record expense'}</Button></div>
          </form>
        </Card>

        <Card className="expense-total-card">
          <span className="expense-total-card__icon"><ShieldCheck size={22} /></span>
          <div><p>Active operating expenses</p><h2>{scopedExpenses.filter((expense) => !expense.voided_at).length} records</h2><small>{scope === 'all' ? 'RAR + MR + shared, each counted once' : `${scopeLabel} only; shared costs stay in All Business`}</small></div>
          <CurrencyStrip totals={totals} />
        </Card>
      </section>

      <Card className="expense-filters">
        <label className="expense-search"><Search size={17} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search description, category, or notes" /></label>
        <Field label="From"><input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></Field>
        <Field label="To"><input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></Field>
        {scope === 'all' && <Field label="Workspace"><select value={filters.workspace} onChange={(event) => setFilters((current) => ({ ...current, workspace: event.target.value }))}><option value="ALL">All</option><option value="RAR">RAR</option><option value="MR">MR</option><option value="SHARED">Shared</option></select></Field>}
        <Field label="Category"><select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="ALL">All</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></Field>
        <Field label="Currency"><select value={filters.currency} onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}><option value="ALL">All</option>{CURRENCIES.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
        <Field label="Status"><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="ACTIVE">Active</option><option value="VOIDED">Voided</option><option value="ALL">All</option></select></Field>
      </Card>

      <section className="expense-history" aria-label="Expense history">
        <div className="expense-history__heading"><div><h2>Expense history</h2><p>{rows.length} matching {rows.length === 1 ? 'record' : 'records'}</p></div><CalendarRange size={19} /></div>
        {rows.length === 0 ? <EmptyState title="No matching expenses" description="Record an expense or adjust the filters." icon={BadgeDollarSign} /> : rows.map((expense) => (
          <article className={expense.voided_at ? 'is-voided' : ''} key={expense.id}>
            <span className={`expense-workspace expense-workspace--${expense.workspace.toLowerCase()}`}>{expense.workspace === 'SHARED' ? 'S' : expense.workspace.slice(0, 1)}</span>
            <div className="expense-history__identity">
              <span><StatusBadge tone={expense.voided_at ? 'neutral' : expense.workspace === 'RAR' ? 'success' : 'neutral'}>{expense.voided_at ? 'VOIDED' : expense.workspace}</StatusBadge><strong>{expense.description}</strong></span>
              <small>{formatDateTime(expense.incurred_at)} · {expense.category} · {expense.source}{expense.notes ? ` · ${expense.notes}` : ''}</small>
              {expense.voided_at && <small>Voided {formatDateTime(expense.voided_at)} · {expense.void_reason}</small>}
            </div>
            <div className="expense-history__amount"><strong>{formatMoney(expense.amount, expense.currency)}</strong><small>Original currency</small></div>
            {!expense.voided_at && <div className="expense-history__actions"><button type="button" onClick={() => editExpense(expense)} aria-label={`Edit ${expense.description}`}><Edit3 size={16} /></button><button type="button" onClick={() => { setVoiding(expense); setVoidReason('Entered incorrectly') }} aria-label={`Void ${expense.description}`}><Trash2 size={16} /></button></div>}
          </article>
        ))}
      </section>

      <Dialog open={Boolean(voiding)} title="Void this expense?" description="The row remains in history and its audit trail is preserved. It will stop affecting profit totals." onClose={() => !saving && setVoiding(null)}>
        <div className="dialog__body"><p><strong>{voiding?.description}</strong> · {voiding ? formatMoney(voiding.amount, voiding.currency) : ''}</p><Field label="Reason"><input maxLength="500" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} /></Field></div>
        <div className="dialog__actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => setVoiding(null)}>Keep expense</Button><Button type="button" loading={saving} onClick={confirmVoid}><Trash2 size={16} />Void expense</Button></div>
      </Dialog>
    </div>
  )
}
