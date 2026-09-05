import { useState } from 'react'
import { Landmark, PackagePlus, Percent, WalletCards } from 'lucide-react'
import { CURRENCIES } from '../lib/constants.js'
import { formatMoney, toNumber } from '../lib/format.js'

const PERIODS = [
  { id: 'current', label: 'Current month' },
  { id: 'previous', label: 'Previous month' },
  { id: 'lifetime', label: 'Lifetime' },
]

const METRICS = [
  { key: 'net', label: 'Net Wallet Credit', totals: 'netTotals', conversion: 'usd', icon: WalletCards },
  { key: 'acquisition', label: 'Acquisition Cost', totals: 'acquisitionTotals', conversion: 'acquisitionUsd', icon: PackagePlus },
  { key: 'fees', label: 'Platform Fees', totals: 'feeTotals', conversion: 'feeUsd', icon: Percent },
]

function Equivalent({ conversion, prominent = false }) {
  const unavailable = conversion?.total == null
  return (
    <span className={`profit-equivalent ${prominent ? 'profit-equivalent--prominent' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
      {conversion?.approximate && !unavailable && <i aria-label="approximately">≈</i>}
      <strong>{unavailable ? '—' : formatMoney(conversion.total, 'USD')}</strong>
    </span>
  )
}

function originalSummary(totals, emptyLabel) {
  const values = CURRENCIES.filter((currency) => toNumber(totals?.[currency]) !== 0)
    .map((currency) => formatMoney(totals[currency], currency))
  return values.length ? values.join(' · ') : emptyLabel
}

function periodDescription(period, id) {
  return id === 'lifetime' ? 'All recorded activity' : period.period.label
}

export default function FinancialProfitSection({ overview, gameOverviews = null }) {
  const [periodId, setPeriodId] = useState('current')
  const period = overview[periodId]
  const negative = period.profitUsd.total != null && period.profitUsd.total < 0

  return (
    <section className="profit-ledger dashboard-surface" aria-labelledby="true-net-profit-title">
      <header className="profit-ledger__heading">
        <div>
          <p className="eyebrow">Cash performance</p>
          <h2 id="true-net-profit-title">True Net Profit <small>Cash basis</small></h2>
          <p>Net Wallet Credit minus recorded stock acquisition costs. Platform fees are already reflected in wallet credit and are not deducted again.</p>
        </div>
        <div className="profit-ledger__periods" role="tablist" aria-label="Financial reporting period">
          {PERIODS.map((entry) => (
            <button
              type="button"
              role="tab"
              aria-selected={periodId === entry.id}
              className={periodId === entry.id ? 'is-active' : ''}
              onClick={() => setPeriodId(entry.id)}
              key={entry.id}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <div className="profit-ledger__body">
        <div className={`profit-ledger__hero ${negative ? 'is-negative' : ''}`}>
          <span>{periodDescription(period, periodId)}</span>
          <Equivalent conversion={period.profitUsd} prominent />
          <small>{originalSummary(period.profitTotals, 'No net cash movement')}</small>
        </div>

        <div className="profit-ledger__metrics">
          {METRICS.map(({ key, label, totals, conversion, icon: Icon }) => (
            <article key={key}>
              <span className="profit-ledger__metric-icon"><Icon size={18} /></span>
              <div><span>{label}</span><small>{originalSummary(period[totals], key === 'acquisition' ? 'No recorded acquisition cost' : 'No recorded amount')}</small></div>
              <Equivalent conversion={period[conversion]} />
            </article>
          ))}
        </div>
      </div>

      {gameOverviews && (
        <div className="profit-ledger__contributions" aria-label="RAR and MR financial contribution">
          {['RAR', 'MR'].map((game) => {
            const gamePeriod = gameOverviews[game][periodId]
            return (
              <article key={game}>
                <span className={`game-orb game-orb--${game.toLowerCase()}`}>{game.slice(0, 1)}</span>
                <div><strong>{game}</strong><small>Net <Equivalent conversion={gamePeriod.usd} /> · Cost <Equivalent conversion={gamePeriod.acquisitionUsd} /></small></div>
                <div><span>True Net Profit</span><Equivalent conversion={gamePeriod.profitUsd} /></div>
              </article>
            )
          })}
        </div>
      )}

      <footer><Landmark size={15} /><span>Current-rate USD equivalents; original transaction currencies remain authoritative.</span></footer>
    </section>
  )
}
