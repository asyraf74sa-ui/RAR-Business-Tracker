import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, CheckCircle2, CloudSun, Leaf, RefreshCw, Settings2, Sprout } from 'lucide-react'
import { Button, Card, EmptyState, Field, MetricCard, PageHeader, SectionHeading } from '../components/ui.jsx'
import { formatDateTime, formatQuantity, getRequestId, numbersEqual, rotateRequestId, toNumber } from '../lib/format.js'
import { readableError, supabase } from '../lib/supabase.js'

export default function Farming({ data, refresh, notify }) {
  const config = data.farmConfig
  const [settings, setSettings] = useState({ farming_accounts: '3', cycle_days: '2.5' })
  const [busyAction, setBusyAction] = useState(null)
  const actionLock = useRef(null)
  const claimRequestId = useRef(getRequestId('farm-claim'))
  const lastCompletedClaimAt = useRef(0)
  const farmItems = data.items.filter((item) => item.kind === 'item' && item.is_farm_item && item.active).sort((a, b) => a.name.localeCompare(b.name))
  const unitsPerItem = toNumber(config?.units_per_item_per_account, 1)

  useEffect(() => {
    setSettings({ farming_accounts: String(config?.farming_accounts ?? 3), cycle_days: String(config?.cycle_days ?? 2.5) })
  }, [config])

  const timing = useMemo(() => {
    if (!config?.last_claim_at) return { next: null, due: 0 }
    const cycleMs = toNumber(config.cycle_days, 2.5) * 86_400_000
    const last = new Date(config.last_claim_at).getTime()
    return { next: new Date(last + cycleMs), due: Math.max(0, Math.floor((Date.now() - last) / cycleMs)) }
  }, [config])

  const recentFarmEvents = data.inventoryEvents.filter((event) => event.event_type === 'farm').slice(0, 12)

  const saveSettings = async (event) => {
    event.preventDefault()
    if (actionLock.current) return
    const accounts = Number(settings.farming_accounts)
    const cycleDays = Number(settings.cycle_days)
    if (!Number.isInteger(accounts) || accounts <= 0 || !Number.isFinite(cycleDays) || cycleDays <= 0) {
      notify('error', 'Farming accounts must be a positive whole number and cycle length must be positive.')
      return
    }
    actionLock.current = 'settings'
    setBusyAction('settings')
    try {
      const { error } = await supabase.rpc('rar_update_farm_settings', {
        p_farming_accounts: accounts,
        p_cycle_days: cycleDays,
        p_units_per_item_per_account: unitsPerItem || 1,
      })
      if (error) throw error
      const { data: verified, error: verifyError } = await supabase.from('rar_farm_config').select('*').single()
      if (verifyError || Number(verified.farming_accounts) !== accounts || !numbersEqual(verified.cycle_days, cycleDays)) throw new Error('The farm settings could not be verified after saving.')
      await refresh()
      notify('success', 'Farm settings updated.')
    } catch (error) {
      notify('error', readableError(error, 'Farm settings could not be saved.'))
    } finally {
      actionLock.current = null
      setBusyAction(null)
    }
  }

  const runFarmAction = async (action) => {
    if (actionLock.current) return
    if (action === 'claim' && Date.now() - lastCompletedClaimAt.current < 2_000) {
      notify('info', 'A farm claim just finished. No second cycle was added.')
      return
    }
    actionLock.current = action
    setBusyAction(action)
    try {
      const [itemResponse, configResponse] = await Promise.all([
        supabase.from('rar_items').select('id,name,stock').eq('kind', 'item').eq('is_farm_item', true).eq('active', true).order('id'),
        supabase.from('rar_farm_config').select('*').single(),
      ])
      if (itemResponse.error) throw itemResponse.error
      if (configResponse.error) throw configResponse.error
      const before = itemResponse.data || []
      if (before.length === 0) throw new Error('Mark at least one active item as a farm item in Items & settings.')

      const ids = before.map((item) => item.id)
      const latestConfig = configResponse.data
      const now = new Date().toISOString()
      const { data: result, error } = action === 'sync'
        ? await supabase.rpc('rar_sync_farm_due', { p_now: now })
        : await supabase.rpc('rar_claim_farm_cycles', { p_cycles: 1, p_event_at: now, p_request_id: claimRequestId.current })
      if (error) throw error

      const returned = toNumber(result)
      const duplicate = action === 'claim' && returned < 0
      const cycles = action === 'sync' ? returned : 1
      const expectedEach = action === 'sync'
        ? toNumber(latestConfig.farming_accounts, 3) * toNumber(latestConfig.units_per_item_per_account, 1) * cycles
        : Math.abs(returned) / before.length
      const { data: after, error: afterError } = await supabase.from('rar_items').select('id,stock').in('id', ids)
      if (afterError) throw afterError
      const deltas = []
      const afterById = new Map(after.map((item) => [item.id, item]))
      for (const item of before) {
        const current = afterById.get(item.id)
        if (!current) throw new Error(`${item.name} could not be verified after the farm action.`)
        deltas.push(toNumber(current.stock) - toNumber(item.stock))
      }
      const appliedBalancesMatch = deltas.every((delta) => numbersEqual(delta, expectedEach))
      const unchangedBalancesMatch = deltas.every((delta) => numbersEqual(delta, 0))
      if ((!duplicate && !appliedBalancesMatch) || (duplicate && !appliedBalancesMatch && !unchangedBalancesMatch)) throw new Error('The farm action saved but its stock result could not be verified. Refresh before retrying.')

      await refresh()
      if (action === 'claim') {
        lastCompletedClaimAt.current = Date.now()
        claimRequestId.current = rotateRequestId('farm-claim')
      }
      notify('success', duplicate
        ? 'This farm claim was already recorded. No farm stock was added twice.'
        : action === 'sync' ? (cycles > 0 ? `${formatQuantity(cycles, 0)} completed ${cycles === 1 ? 'cycle' : 'cycles'} synced.` : 'Farm is already up to date; no stock was added.') : `One cycle claimed. Each farm item gained ${formatQuantity(expectedEach)} units.`)
    } catch (error) {
      notify('error', readableError(error, 'The farm action could not be completed.'))
    } finally {
      actionLock.current = null
      setBusyAction(null)
    }
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Production" title="Farming cycles" description="Keep completed cycles in sync and forecast output from your live settings." action={<Button onClick={() => runFarmAction('sync')} loading={busyAction === 'sync'} disabled={Boolean(busyAction) && busyAction !== 'sync'}><RefreshCw size={18} />Sync completed cycles</Button>} />

      <div className="metrics-grid farming-metrics">
        <MetricCard label="Farming accounts" value={formatQuantity(config?.farming_accounts ?? 3, 0)} detail={`${formatQuantity(unitsPerItem)} unit per item, per account`} icon={Sprout} tone="green" />
        <MetricCard label="Cycle length" value={`${formatQuantity(config?.cycle_days ?? 2.5)} days`} detail={timing.due ? `${timing.due} completed ${timing.due === 1 ? 'cycle' : 'cycles'} ready` : 'No completed cycle waiting'} icon={CalendarClock} />
        <MetricCard label="Next estimated cycle" value={timing.next ? formatDateTime(timing.next) : 'Starts after first sync'} detail={`Last claim: ${formatDateTime(config?.last_claim_at)}`} icon={CloudSun} tone="gold" />
      </div>

      <div className="farming-layout">
        <Card className="form-card">
          <SectionHeading title="Farm settings" description="These values control both manual claims and completed-cycle syncs." action={<Settings2 size={19} />} />
          <form className="form-stack" onSubmit={saveSettings}>
            <Field label="Farming account count"><input type="number" min="1" step="1" inputMode="numeric" value={settings.farming_accounts} onChange={(event) => setSettings((current) => ({ ...current, farming_accounts: event.target.value }))} required /></Field>
            <Field label="Cycle length (days)"><input type="number" min="0.01" step="any" inputMode="decimal" value={settings.cycle_days} onChange={(event) => setSettings((current) => ({ ...current, cycle_days: event.target.value }))} required /></Field>
            <Field label="Units per farm item, per account" hint="Current database setting"><input value={formatQuantity(unitsPerItem)} readOnly disabled /></Field>
            <Button type="submit" variant="secondary" loading={busyAction === 'settings'} disabled={Boolean(busyAction) && busyAction !== 'settings'}>Save farm settings</Button>
          </form>
          <div className="manual-claim">
            <div><strong>Claim one cycle now</strong><p>Add one full cycle to every active farm item and move the last-claim time to now.</p></div>
            <Button variant="primary" onClick={() => runFarmAction('claim')} loading={busyAction === 'claim'} disabled={Boolean(busyAction) && busyAction !== 'claim'}><Leaf size={17} />Claim 1 cycle</Button>
          </div>
        </Card>

        <Card className="dashboard-panel farm-projection">
          <SectionHeading title="Monthly projected production" description="Estimated 30-day output per active farm item." action={<Leaf size={20} />} />
          {farmItems.length === 0 ? <EmptyState title="No active farm items" description="Mark items as farm items in Items & settings." icon={Leaf} /> : (
            <div className="projection-list">
              {farmItems.map((item) => {
                const monthly = toNumber(config?.farming_accounts, 3) * unitsPerItem * (30 / toNumber(config?.cycle_days, 2.5))
                return <div key={item.id}><span className="farm-item-icon"><Leaf size={16} /></span><div><strong>{item.name}</strong><small>{formatQuantity(item.stock)} currently in stock</small></div><b>≈ {formatQuantity(monthly)} / month</b></div>
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="dashboard-panel">
        <SectionHeading title="Recent farm activity" description="Every claim is recorded as an inventory event for each farm item." action={<CheckCircle2 size={20} />} />
        {recentFarmEvents.length === 0 ? <EmptyState title="No farm activity yet" description="Sync or claim a cycle when production is ready." icon={Sprout} /> : (
          <div className="activity-table">
            {recentFarmEvents.map((event) => {
              const item = data.items.find((entry) => entry.id === event.item_id)
              return <div key={event.id}><span><Leaf size={16} /></span><div><strong>{item?.name || 'Farm item'}</strong><small>{event.notes || 'Farm cycle'} · {formatDateTime(event.event_at)}</small></div><b>+{formatQuantity(event.quantity_delta)}</b></div>
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
