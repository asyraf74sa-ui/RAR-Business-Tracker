import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Boxes, Landmark, Plus, ReceiptText, Sparkles, WalletCards } from 'lucide-react'
import FinancialProfitSection from '../components/FinancialProfitSection.jsx'
import { Button, CurrencyStrip, EmptyState, PageHeader, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { CURRENCIES } from '../lib/constants.js'
import { malaysiaMonthPeriod, walletFinancialOverview } from '../lib/dashboard-finance.js'
import { buildUnifiedFinancialOverview, platformPerformance } from '../lib/business-workspaces.js'
import { formatMoney, formatQuantity, toNumber } from '../lib/format.js'
import { fxClient } from '../lib/fx-client.js'

function Equivalent({ value, approximate }) {
  return <strong>{value == null ? '—' : `${approximate ? '≈ ' : ''}${formatMoney(value, 'USD')}`}</strong>
}

function gameContribution(overview, game, key) {
  return overview.games[game].months.find((month) => month.period.key === key)?.usd || { total: null, approximate: true }
}

function originalSummary(totals) {
  const values = CURRENCIES.filter((code) => toNumber(totals[code]))
    .map((code) => formatMoney(totals[code], code))
  return values.length ? values.join(' · ') : 'No recorded credit'
}

export default function UnifiedDashboard({ data, scope, onNavigate }) {
  const allBusiness = scope === 'all'
  const [now, setNow] = useState(() => new Date())
  const [currency, setCurrency] = useState('USD')
  const [fx, setFx] = useState({ status: 'loading', data: null })

  useEffect(() => {
    let active = true
    fxClient.getRates().then((result) => active && setFx({ status: 'ready', data: result }))
      .catch(() => active && setFx({ status: 'unavailable', data: null }))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const current = Date.now()
    const delay = Math.min(Math.max(malaysiaMonthPeriod(new Date(current)).endExclusive.getTime() - current + 250, 1000), 2_147_000_000)
    const timer = window.setTimeout(() => setNow(new Date()), delay)
    return () => window.clearTimeout(timer)
  }, [now])

  const taggedRar = useMemo(() => data.sales.map((sale) => ({ ...sale, game: 'RAR' })), [data.sales])
  const taggedMr = useMemo(() => data.mr.sales.map((sale) => ({ ...sale, game: 'MR' })), [data.mr.sales])
  const sales = allBusiness ? [...taggedRar, ...taggedMr] : taggedMr
  const overview = useMemo(() => allBusiness
    ? buildUnifiedFinancialOverview(data.sales, data.mr.sales, data.inventoryEvents, data.mr.inventoryEvents, fx.data?.rates, now)
    : walletFinancialOverview(taggedMr, data.mr.inventoryEvents, fx.data?.rates, now),
  [allBusiness, data.sales, data.mr.sales, data.inventoryEvents, data.mr.inventoryEvents, taggedMr, fx.data?.rates, now])
  const currentCurrencySales = overview.current.sales.filter((sale) => String(sale.currency).toUpperCase() === currency)
  const platforms = useMemo(() => platformPerformance(currentCurrencySales, currency), [currentCurrencySales, currency])

  const itemMap = useMemo(() => new Map(data.mr.items.map((item) => [item.id, item])), [data.mr.items])
  const topItems = useMemo(() => {
    const saleIds = new Set(overview.current.sales.filter((sale) => sale.game === 'MR').map((sale) => sale.id))
    const quantities = new Map()
    data.mr.saleItems.filter((line) => saleIds.has(line.sale_id)).forEach((line) => {
      quantities.set(line.item_id, (quantities.get(line.item_id) || 0) + toNumber(line.quantity))
    })
    return [...quantities].map(([id, quantity]) => ({ item: itemMap.get(id), quantity }))
      .filter((entry) => entry.item).sort((a, b) => b.quantity - a.quantity).slice(0, 5)
  }, [data.mr.saleItems, itemMap, overview.current.sales])

  const activeMrItems = data.mr.items.filter((item) => !item.is_archived)
  const mrUnits = activeMrItems.reduce((sum, item) => sum + toNumber(item.current_quantity), 0)
  const approximate = overview.current.usd.approximate && overview.current.usd.total != null
  const fxLabel = fx.status === 'unavailable'
    ? 'FX unavailable · USD remains exact'
    : overview.current.usd.total == null && overview.current.usd.approximate
    ? 'USD equivalent unavailable · original currencies remain available'
    : fx.data?.fallback ? 'Current-rate fallback FX' : overview.current.usd.approximate ? 'Live current-rate FX' : 'USD only'

  return (
    <div className="page-stack unified-dashboard">
      <PageHeader
        eyebrow={allBusiness ? 'Unified financial workspace' : 'My Restaurant workspace'}
        title={allBusiness ? 'All Business' : 'MR Dashboard'}
        description={allBusiness ? 'RAR and MR finances together. Operational inventory stays separate.' : 'Wallet performance, sales, inventory, and furniture sets—MR only.'}
        action={<Button onClick={() => onNavigate('sale', allBusiness ? 'rar' : 'mr')}><Plus size={18} />{allBusiness ? 'RAR sale' : 'Record MR sale'}</Button>}
      />

      <section className={`business-wallet business-wallet--${allBusiness ? 'all' : 'mr'}`}>
        <span className="business-wallet__glow" aria-hidden="true" />
        <div className="business-wallet__top"><span>{allBusiness ? 'A' : 'M'}</span><div><strong>{allBusiness ? 'All Business Wallet' : 'MR Business Wallet'}</strong><small>USD reporting · Malaysia time</small></div><StatusBadge tone="success">{fxLabel}</StatusBadge></div>
        <div className="business-wallet__hero"><p>Current Month Net Wallet Credit</p><Equivalent value={overview.current.usd.total} approximate={approximate} /><span>{overview.current.period.label}</span></div>
        <CurrencyStrip totals={overview.current.netTotals} />
      </section>

      <section className="period-ribbon" aria-label="Previous and lifetime wallet credit">
        <article><span>Previous month</span><Equivalent value={overview.previous.usd.total} approximate={overview.previous.usd.approximate} /><small>{overview.previous.period.label}</small><small className="period-originals">{originalSummary(overview.previous.netTotals)}</small></article>
        <article><span>Lifetime</span><Equivalent value={overview.lifetime.usd.total} approximate={overview.lifetime.usd.approximate} /><small>Original currencies</small><small className="period-originals">{originalSummary(overview.lifetime.netTotals)}</small></article>
        <article><span>Recorded sales</span><strong>{sales.length}</strong><small>{allBusiness ? `${taggedRar.length} RAR · ${taggedMr.length} MR` : 'MR only'}</small></article>
      </section>

      <FinancialProfitSection overview={overview} gameOverviews={allBusiness ? overview.games : null} />

      {allBusiness && (
        <section className="contribution-pass dashboard-surface">
          <SectionHeading title="RAR vs MR contribution" description="Current-month Net Wallet Credit converted with the same current FX snapshot." />
          {['RAR', 'MR'].map((game) => {
            const contribution = gameContribution(overview, game, overview.current.period.key)
            const amount = contribution.total
            const total = overview.current.usd.total
            const share = total != null && total > 0 && amount != null ? Math.max(0, amount / total * 100) : null
            return <article key={game}><span className={`game-orb game-orb--${game.toLowerCase()}`}>{game.slice(0, 1)}</span><div><span><strong>{game}</strong><Equivalent value={amount} approximate={contribution.approximate} /></span><i><b style={{ width: `${Math.min(100, share || 0)}%` }} /></i><small>{share == null ? 'Current-rate USD unavailable' : `${formatQuantity(share, 1)}% of current-month USD equivalent`}</small></div></article>
          })}
        </section>
      )}

      <section className="monthly-wallet dashboard-surface">
        <div className="monthly-wallet__heading"><div><p className="eyebrow">Automatic timeline</p><h2>Monthly earnings history</h2><p>Continuous Malaysia calendar months. Converted values are current-rate USD equivalents.</p></div><span><Landmark size={16} />Asia/Kuala_Lumpur</span></div>
        <div className="monthly-wallet__list">
          {overview.months.map((month, index) => {
            const recordedNet = CURRENCIES.filter((code) => toNumber(month.netTotals[code]))
            const recordedCosts = CURRENCIES.filter((code) => toNumber(month.acquisitionTotals[code]))
            return (
              <article className={`monthly-wallet__row ${index === 0 ? 'is-current' : ''}`} key={month.period.key}>
                <div className="monthly-wallet__identity"><span>{index === 0 ? 'Current month' : month.period.key}</span><strong>{month.period.label}</strong><small>{month.sales.length} sales · {month.purchaseEvents.length} purchases</small></div>
                <div className="monthly-wallet__original">
                  {recordedNet.map((code) => <span key={`net-${code}`}><small>{code} NET</small><strong>{formatMoney(month.netTotals[code], code)}</strong></span>)}
                  {recordedCosts.map((code) => <span key={`cost-${code}`}><small>{code} COST</small><strong>{formatMoney(month.acquisitionTotals[code], code)}</strong></span>)}
                  {!recordedNet.length && !recordedCosts.length && <span>Empty month · no recorded financial activity</span>}
                </div>
                {allBusiness && <div className="month-contributions"><span>RAR profit <Equivalent value={month.contributions.RAR.profit.total} approximate={month.contributions.RAR.profit.approximate} /></span><span>MR profit <Equivalent value={month.contributions.MR.profit.total} approximate={month.contributions.MR.profit.approximate} /></span></div>}
                <div className="monthly-wallet__metrics">
                  <span><small>Net wallet</small><Equivalent value={month.usd.total} approximate={month.usd.approximate} /></span>
                  <span><small>Acquisition</small><Equivalent value={month.acquisitionUsd.total} approximate={month.acquisitionUsd.approximate} /></span>
                  <span className="is-profit"><small>True net profit</small><Equivalent value={month.profitUsd.total} approximate={month.profitUsd.approximate} /></span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="dashboard-surface dashboard-surface--performance">
        <section className="platform-performance">
          <SectionHeading title="Platform performance" description={`Current-month ${currency} wallet credit across ${allBusiness ? 'both games' : 'MR'}.`} action={<div className="mini-segments">{CURRENCIES.map((code) => <button key={code} className={currency === code ? 'is-active' : ''} onClick={() => setCurrency(code)}>{code}</button>)}</div>} />
          {platforms.length ? <div className="platform-performance__list">{platforms.map((platform) => <article className="platform-performance__row" key={platform.platform}><span className="platform-chip">{platform.platform.slice(0, 1)}</span><div className="platform-performance__identity"><div><strong>{platform.platform}</strong><small>{platform.orders} orders{allBusiness && platform.games.length ? ` · ${platform.games.join(' + ')}` : ''}</small></div></div><div className="platform-performance__money"><span>Net<strong>{formatMoney(platform.net, currency)}</strong></span><span>Fees<strong>{formatMoney(platform.fees, currency)}</strong></span></div></article>)}</div> : <EmptyState title={`No ${currency} sales this month`} description="Choose another currency to inspect its platform activity." />}
        </section>
        <section className="top-items">
          <SectionHeading title={allBusiness ? 'Separated inventory pulse' : 'Top sold MR items'} description={allBusiness ? 'A lightweight summary—stock tables remain inside each game.' : 'Ranked by units sold this month.'} />
          {allBusiness ? <div className="inventory-pulse"><button onClick={() => onNavigate('inventory', 'rar')}><span className="game-orb game-orb--rar">R</span><div><strong>RAR inventory</strong><small>{data.items.filter((item) => item.active).length} active catalog items</small></div><ArrowRight size={17} /></button><button onClick={() => onNavigate('inventory', 'mr')}><span className="game-orb game-orb--mr">M</span><div><strong>MR inventory</strong><small>{activeMrItems.length} active items · {formatQuantity(mrUnits)} units</small></div><ArrowRight size={17} /></button></div> : topItems.length ? <ol className="rank-list rank-list--visual">{topItems.map(({ item, quantity }, index) => <li key={item.id}><span className="rank-list__number">{String(index + 1).padStart(2, '0')}</span><div><span><strong>{item.name}</strong><b>{formatQuantity(quantity)} sold</b></span></div></li>)}</ol> : <EmptyState title="No MR sales this month" description="Top items appear after the first MR sale." icon={ReceiptText} />}
        </section>
      </section>

      {!allBusiness && (
        <section className="set-pass-grid">
          <SectionHeading title="Furniture set overview" description="Derived live from tables and chairs—never stored as fake set stock." action={<Boxes size={19} />} />
          <div>{data.mr.setStock.map((set) => <article key={set.family_id}><span><Sparkles size={17} /><b>{set.name}</b></span><strong>{formatQuantity(set.completed_sets, 0)} <small>complete sets</small></strong><div><span>{formatQuantity(set.tables)} tables</span><span>{formatQuantity(set.chairs)} chairs</span></div><small>{formatQuantity(set.excess_tables)} excess tables · {formatQuantity(set.excess_chairs)} excess chairs</small></article>)}</div>
        </section>
      )}
    </div>
  )
}
