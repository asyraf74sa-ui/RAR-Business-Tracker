import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Boxes,
  CalendarRange,
  CalendarClock,
  Gem,
  Gauge,
  Landmark,
  Leaf,
  PackageOpen,
  Percent,
  Plus,
  ReceiptText,
  Sprout,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import FinancialProfitSection from '../components/FinancialProfitSection.jsx'
import { Button, EmptyState, SectionHeading, StatusBadge } from '../components/ui.jsx'
import { CURRENCIES } from '../lib/constants.js'
import {
  BUSINESS_TIME_ZONE,
  malaysiaHour,
  malaysiaMonthPeriod,
  walletFinancialOverview,
} from '../lib/dashboard-finance.js'
import { formatDateTime, formatMoney, formatQuantity, toNumber } from '../lib/format.js'
import { fxClient } from '../lib/fx-client.js'

const CURRENCY_META = {
  USD: { label: 'US Dollar', symbol: '$' },
  MYR: { label: 'Malaysian Ringgit', symbol: 'RM' },
  PHP: { label: 'Philippine Peso', symbol: '₱' },
  IDR: { label: 'Indonesian Rupiah', symbol: 'Rp' },
}

function formatOriginalBalance(value, currency) {
  const fractionDigits = currency === 'IDR' ? 0 : 2
  const amount = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(toNumber(value))
  return `${CURRENCY_META[currency].symbol}${amount}`
}

function updatedAgo(value, now) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'time unavailable'

  const elapsed = Math.max(0, now.getTime() - timestamp)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return new Intl.DateTimeFormat(undefined, {
    timeZone: BUSINESS_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function UsdEquivalent({ conversion, compact = false }) {
  const unavailable = conversion.total == null
  return (
    <span className={`usd-equivalent ${compact ? 'usd-equivalent--compact' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
      {conversion.approximate && !unavailable && <i aria-label="approximately">≈</i>}
      <strong>{unavailable ? '—' : formatMoney(conversion.total, 'USD')}</strong>
    </span>
  )
}

function comparisonDetail(comparison, previousLabel) {
  const previousMonth = previousLabel.split(' ')[0]
  if (comparison.status === 'unavailable') return 'Comparison available when FX returns'
  if (comparison.status === 'no-activity') return `No wallet credit in either month`
  if (comparison.status === 'no-baseline') return `${previousMonth} was an empty month`
  if (comparison.amount === 0) return `No change vs ${previousMonth}`

  const direction = comparison.amount > 0 ? '+' : '−'
  const percent = Math.abs(comparison.percent).toFixed(1)
  return `${direction}${formatMoney(Math.abs(comparison.amount), 'USD')} · ${direction}${percent}% vs ${previousMonth}`
}

export default function Dashboard({ data, onNavigate }) {
  const { items, sales, saleItems, inventoryEvents, farmConfig } = data
  const [selectedCurrency, setSelectedCurrency] = useState('USD')
  const [dashboardNow, setDashboardNow] = useState(() => new Date())
  const [fxState, setFxState] = useState({ status: 'loading', data: null })

  useEffect(() => {
    const now = Date.now()
    const nextMonth = malaysiaMonthPeriod(new Date(now)).endExclusive.getTime()
    const delay = Math.min(Math.max(nextMonth - now + 250, 1_000), 2_147_000_000)
    const timer = window.setTimeout(() => setDashboardNow(new Date()), delay)
    return () => window.clearTimeout(timer)
  }, [dashboardNow])

  useEffect(() => {
    let active = true
    fxClient.getRates()
      .then((result) => {
        if (active) setFxState({ status: 'ready', data: result })
      })
      .catch(() => {
        if (active) setFxState({ status: 'unavailable', data: null })
      })
    return () => { active = false }
  }, [])

  const gemItem = items.find((item) => item.kind === 'currency' && item.name.toLowerCase() === 'gems')
  const physicalItems = items.filter((item) => item.kind === 'item')
  const activeFarmItems = physicalItems.filter((item) => item.is_farm_item && item.active)
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const financialOverview = useMemo(
    () => walletFinancialOverview(sales, inventoryEvents, fxState.data?.rates, dashboardNow),
    [sales, inventoryEvents, fxState.data?.rates, dashboardNow],
  )
  const { current, previous, lifetime, comparison, months: monthlyHistory } = financialOverview
  const { period, sales: currentMonthSales, netTotals, feeTotals, grossTotals, saleCountByCurrency, usd: combinedUsd } = current
  const selectedSales = useMemo(
    () => currentMonthSales.filter((sale) => String(sale.currency).toUpperCase() === selectedCurrency),
    [currentMonthSales, selectedCurrency],
  )

  const platformPerformance = useMemo(() => {
    const grouped = new Map()
    selectedSales.forEach((sale) => {
      const current = grouped.get(sale.platform) || { platform: sale.platform, net: 0, fees: 0, orders: 0 }
      current.net += toNumber(sale.net_credit)
      current.fees += toNumber(sale.platform_fee)
      current.orders += 1
      grouped.set(sale.platform, current)
    })
    const totalNet = netTotals[selectedCurrency]
    return [...grouped.values()]
      .map((entry) => ({
        ...entry,
        contribution: totalNet > 0 ? (entry.net / totalNet) * 100 : selectedSales.length ? (entry.orders / selectedSales.length) * 100 : 0,
      }))
      .sort((a, b) => b.net - a.net || b.orders - a.orders)
  }, [selectedSales, selectedCurrency, netTotals])

  const bestSellers = useMemo(() => {
    const currentSaleIds = new Set(currentMonthSales.map((sale) => sale.id))
    const grouped = new Map()
    saleItems
      .filter((line) => currentSaleIds.has(line.sale_id))
      .forEach((line) => grouped.set(line.item_id, (grouped.get(line.item_id) || 0) + toNumber(line.quantity)))
    return [...grouped.entries()]
      .map(([id, quantity]) => ({ item: itemMap.get(id), quantity }))
      .filter(({ item }) => item?.kind === 'item')
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5)
  }, [saleItems, currentMonthSales, itemMap])

  const recentSales = sales.slice(0, 5).map((sale) => ({
    ...sale,
    lines: saleItems.filter((line) => line.sale_id === sale.id),
  }))

  const farmOutput = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000
    return inventoryEvents
      .filter((event) => event.event_type === 'farm' && new Date(event.event_at).getTime() >= thirtyDaysAgo)
      .reduce((sum, event) => sum + toNumber(event.quantity_delta), 0)
  }, [inventoryEvents])

  const accounts = toNumber(farmConfig?.farming_accounts, 3)
  const cycleDays = toNumber(farmConfig?.cycle_days, 2.5)
  const unitsPerItem = toNumber(farmConfig?.units_per_item_per_account, 1)
  const perItemPerCycle = accounts * unitsPerItem
  const productionPerCycle = perItemPerCycle * activeFarmItems.length
  const projectedThirtyDays = cycleDays > 0 ? productionPerCycle * (30 / cycleDays) : 0
  const lastClaim = farmConfig?.last_claim_at ? new Date(farmConfig.last_claim_at) : null
  const nextCycle = lastClaim && cycleDays > 0 ? new Date(lastClaim.getTime() + cycleDays * 86_400_000) : null
  const inventoryUnits = physicalItems.reduce((sum, item) => sum + toNumber(item.stock), 0)
  const hour = malaysiaHour(dashboardNow)
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const showApproximate = combinedUsd.approximate && combinedUsd.total != null
  const fxStatus = !combinedUsd.approximate
    ? 'USD only · no conversion needed'
    : combinedUsd.total == null
      ? fxState.status === 'loading' ? 'Updating current FX…' : 'USD conversion temporarily unavailable'
      : fxState.data?.fallback
        ? `Using last FX rate · updated ${updatedAgo(fxState.data.updatedAt, dashboardNow)}`
        : `Live FX · updated ${updatedAgo(fxState.data.updatedAt, dashboardNow)}`
  const monthComparison = comparisonDetail(comparison, previous.period.label)

  return (
    <div className="page-stack dashboard-page">
      <header className="dashboard-greeting">
        <div><p className="eyebrow">Business wallet</p><h1>{greeting}</h1><p>Here’s your RAR business today.</p></div>
        <Button onClick={() => onNavigate('sale')}><Plus size={18} />Record sale</Button>
      </header>

      <div className="wallet-overview">
        <section className="wallet-hero" aria-label={`${period.label} net wallet credit in US dollars`}>
          <span className="wallet-hero__ambient" aria-hidden="true" />
          <header className="wallet-hero__top">
            <span className="wallet-hero__brand"><i>R</i><span><strong>RAR</strong><small>Business Wallet</small></span></span>
            <span className="wallet-hero__base"><strong>USD base</strong><small>{fxState.data?.provider || 'Live reporting'}</small></span>
          </header>

          <div className="wallet-hero__body">
            <p className="wallet-hero__month">{period.label}<span>Malaysia time</span></p>
            <small>Net Wallet Credit</small>
            <div className={`wallet-hero__amount ${combinedUsd.total == null ? 'is-unavailable' : ''}`}>
              {showApproximate && <i aria-label="approximately">≈</i>}
              <strong>{combinedUsd.total == null ? '—' : formatMoney(combinedUsd.total, 'USD')}</strong>
            </div>
            <p>Current month · USD equivalent</p>
            <div className={`wallet-hero__fx ${fxState.data?.fallback ? 'is-fallback' : ''} ${combinedUsd.total == null ? 'is-unavailable' : ''}`} aria-live="polite">
              <span aria-hidden="true" />
              <strong>{fxStatus}</strong>
            </div>
          </div>

          <div className="wallet-balances" aria-label="Current-month balances in their original currencies">
            <div className="wallet-balances__heading"><span>Recorded balances</span><small>Original currency</small></div>
            <div className="wallet-balances__grid">
              {CURRENCIES.map((currency) => (
                <button
                  type="button"
                  aria-pressed={selectedCurrency === currency}
                  className={selectedCurrency === currency ? 'is-active' : ''}
                  onClick={() => setSelectedCurrency(currency)}
                  key={currency}
                >
                  <span><strong>{currency}</strong><small>{saleCountByCurrency[currency]} {saleCountByCurrency[currency] === 1 ? 'sale' : 'sales'}</small></span>
                  <b title={`${CURRENCY_META[currency].label} total`}>{formatOriginalBalance(netTotals[currency], currency)}</b>
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="wallet-insights" aria-label={`${selectedCurrency} wallet at a glance`}>
          <div className="wallet-insights__heading"><span>Financial overview</span><strong>USD · CURRENT FX</strong></div>
          <article className="period-summary period-summary--previous">
            <span className="period-summary__icon"><CalendarRange size={19} /></span>
            <div className="period-summary__body"><span>Previous month</span><small>{previous.period.label}</small><UsdEquivalent conversion={previous.usd} compact /><p>{monthComparison}</p></div>
          </article>
          <article className="period-summary period-summary--lifetime">
            <span className="period-summary__icon"><WalletCards size={19} /></span>
            <div className="period-summary__body"><span>Lifetime wallet credit</span><small>First recorded sale to now</small><UsdEquivalent conversion={lifetime.usd} compact /><p>Original currencies remain authoritative</p></div>
          </article>
          <article className="support-metric support-metric--blue"><span className="support-metric__icon"><Percent size={20} /></span><div><span>Platform fees</span><strong>{formatMoney(feeTotals[selectedCurrency], selectedCurrency)}</strong><small>Current month · {selectedCurrency}</small></div></article>
          <article className="support-metric support-metric--green"><span className="support-metric__icon"><TrendingUp size={20} /></span><div><span>Gross sales</span><strong>{formatMoney(grossTotals[selectedCurrency], selectedCurrency)}</strong><small>Net received + fees</small></div></article>
          <article className="support-metric support-metric--purple"><span className="support-metric__icon"><Gem size={20} /></span><div><span>Gem balance</span><strong>{formatQuantity(gemItem?.stock || 0)}</strong><small>Live business asset</small></div></article>
          <article className="support-metric support-metric--gold"><span className="support-metric__icon"><PackageOpen size={20} /></span><div><span>Inventory units</span><strong>{formatQuantity(inventoryUnits)}</strong><small>Live · {physicalItems.filter((item) => item.active).length} active item types</small></div></article>
        </aside>
      </div>

      <FinancialProfitSection overview={financialOverview} />

      <section className="monthly-wallet dashboard-surface" aria-labelledby="monthly-wallet-title">
        <div className="monthly-wallet__heading">
          <div><p className="eyebrow">Financial activity</p><h2 id="monthly-wallet-title">Monthly Wallet Credit</h2><p>Automatic Malaysia calendar months, newest first. USD equivalents use the latest available current FX rates.</p></div>
          <span><Landmark size={16} />Asia/Kuala_Lumpur</span>
        </div>
        <div className="monthly-wallet__list">
          {monthlyHistory.map((month, index) => {
            const saleCount = CURRENCIES.reduce((sum, currency) => sum + month.saleCountByCurrency[currency], 0)
            const purchaseCount = CURRENCIES.reduce((sum, currency) => sum + month.purchaseCountByCurrency[currency], 0)
            const recordedNet = CURRENCIES.filter((currency) => toNumber(month.netTotals[currency]) !== 0)
            const recordedCosts = CURRENCIES.filter((currency) => toNumber(month.acquisitionTotals[currency]) !== 0)
            return (
              <article className={`monthly-wallet__row ${index === 0 ? 'is-current' : ''}`} key={month.period.key}>
                <div className="monthly-wallet__identity">
                  <span>{index === 0 ? 'Current month' : month.period.key}</span>
                  <strong>{month.period.label}</strong>
                  <small>{saleCount} {saleCount === 1 ? 'sale' : 'sales'} · {purchaseCount} {purchaseCount === 1 ? 'purchase' : 'purchases'}</small>
                </div>
                <div className="monthly-wallet__original" aria-label={`${month.period.label} original-currency balances`}>
                  {recordedNet.map((currency) => (
                    <span key={`net-${currency}`}><small>{currency} NET</small><strong>{formatOriginalBalance(month.netTotals[currency], currency)}</strong></span>
                  ))}
                  {recordedCosts.map((currency) => (
                    <span key={`cost-${currency}`}><small>{currency} COST</small><strong>{formatOriginalBalance(month.acquisitionTotals[currency], currency)}</strong></span>
                  ))}
                  {recordedNet.length === 0 && recordedCosts.length === 0 && <span>Empty month · no recorded financial activity</span>}
                </div>
                <div className="monthly-wallet__metrics">
                  <span><small>Net wallet</small><UsdEquivalent conversion={month.usd} compact /></span>
                  <span><small>Acquisition</small><UsdEquivalent conversion={month.acquisitionUsd} compact /></span>
                  <span className="is-profit"><small>True net profit</small><UsdEquivalent conversion={month.profitUsd} compact /></span>
                </div>
              </article>
            )
          })}
        </div>
        <footer><span>≈ values are reporting estimates at current FX.</span><span>Original-currency sales are never rewritten.</span></footer>
      </section>

      <section className="dashboard-surface dashboard-surface--performance">
        <section className="platform-performance">
          <SectionHeading title="Platform performance" description={`Current-month net sales, fees, and share of the ${selectedCurrency} wallet.`} />
          {platformPerformance.length === 0 ? (
            <EmptyState title={`No ${selectedCurrency} sales this month`} description="Choose another currency or record a sale for this month." action={<Button variant="secondary" size="small" onClick={() => onNavigate('sale')}>Record a sale</Button>} />
          ) : (
            <div className="platform-performance__list">
              {platformPerformance.map((entry) => (
                <article className="platform-performance__row" key={entry.platform}>
                  <div className="platform-performance__identity"><span className="platform-chip">{entry.platform.slice(0, 1)}</span><div><strong>{entry.platform}</strong><small>{entry.orders} {entry.orders === 1 ? 'order' : 'orders'}</small></div></div>
                  <div className="platform-performance__money"><span>Net<strong>{formatMoney(entry.net, selectedCurrency)}</strong></span><span>Fees<strong>{formatMoney(entry.fees, selectedCurrency)}</strong></span></div>
                  <div className="platform-performance__share"><i style={{ '--share-angle': `${Math.min(100, Math.max(0, entry.contribution)) * 3.6}deg` }} aria-hidden="true" /><span><strong>{formatQuantity(entry.contribution, 1)}%</strong><small>of wallet</small></span></div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="top-items">
          <SectionHeading title="Top sold items" description={`Ranked by units sold in ${period.label}.`} />
          {bestSellers.length === 0 ? <EmptyState title="No best seller this month" description="Items are ranked automatically after this month’s first sale." icon={Boxes} /> : (
            <ol className="rank-list rank-list--visual">
              {bestSellers.map(({ item, quantity }, index) => (
                <li key={item.id}><span className="rank-list__number">{String(index + 1).padStart(2, '0')}</span><div><span><strong title={item.name}>{item.name}</strong><b>{formatQuantity(quantity)} sold</b></span></div></li>
              ))}
            </ol>
          )}
        </section>
      </section>

      <section className="dashboard-surface dashboard-surface--operations">
        <section className="farm-capacity">
          <SectionHeading title="Farm capacity" description="Live production estimates from your current farm configuration." action={<button className="round-link" onClick={() => onNavigate('farming')} aria-label="Open Farm"><ArrowRight size={17} /></button>} />
          <div className="farm-capacity__hero"><span><Sprout size={23} /></span><div><small>Estimated 30-day output</small><strong>≈ {formatQuantity(projectedThirtyDays)} units</strong><p>{formatQuantity(farmOutput)} units actually claimed in the last 30 days</p></div></div>
          <div className="farm-capacity__stats">
            <div><span><Boxes size={16} />Accounts</span><strong>{formatQuantity(accounts, 0)}</strong></div>
            <div><span><CalendarClock size={16} />Cycle</span><strong>{formatQuantity(cycleDays)} days</strong></div>
            <div><span><Leaf size={16} />Per item / cycle</span><strong>{formatQuantity(perItemPerCycle)}</strong></div>
            <div><span><Gauge size={16} />All items / cycle</span><strong>{formatQuantity(productionPerCycle)}</strong></div>
          </div>
          <div className="farm-capacity__timeline"><span><i />Last claim <strong>{formatDateTime(lastClaim)}</strong></span><span><i />Next estimate <strong>{formatDateTime(nextCycle)}</strong></span></div>
        </section>

        <section className="recent-activity">
          <SectionHeading title="Recent sales" description="Latest wallet activity in its original currency." action={<button className="text-link" onClick={() => onNavigate('history')}>View history <ArrowRight size={15} /></button>} />
          {recentSales.length === 0 ? <EmptyState title="Your activity feed is ready" description="Record a single item, bundle, or Gem sale to begin." icon={ReceiptText} /> : (
            <div className="recent-list">
              {recentSales.map((sale) => (
                <div className="recent-list__row" key={sale.id}>
                  <div className="sale-avatar"><ReceiptText size={16} /></div>
                  <div className="recent-list__main"><div><strong>{sale.platform}</strong><StatusBadge tone={sale.classification === 'normal' ? 'success' : 'neutral'}>{sale.classification.replace('_', ' ')}</StatusBadge></div><span>{sale.lines.map((line) => `${formatQuantity(line.quantity)}× ${itemMap.get(line.item_id)?.name || 'Item'}`).join(', ') || 'Sale recorded'}</span></div>
                  <div className="recent-list__amount"><strong>{formatMoney(sale.net_credit, sale.currency)}</strong><span>{formatDateTime(sale.sold_at, { compact: true })}</span></div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </div>
  )
}
