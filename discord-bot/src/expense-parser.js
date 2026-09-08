const SUPPORTED_CURRENCIES = ['USD', 'MYR', 'PHP', 'IDR']

export class ExpenseParseError extends Error {}

export function detectExpenseWorkspace(content) {
  const match = String(content || '').trim().match(/^(RAR|MR|BUSINESS)\s+EXPENSE\b/i)
  if (!match) return null
  return match[1].toUpperCase() === 'BUSINESS' ? 'SHARED' : match[1].toUpperCase()
}

export function isExpenseMessage(content) {
  return detectExpenseWorkspace(content) !== null
}

export function parseExpenseMessage(content) {
  const lines = String(content || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2 || lines.length > 3) {
    throw new ExpenseParseError('Use two lines, plus an optional category: `RAR EXPENSE - DESCRIPTION`, then `45 MYR`.')
  }

  const heading = lines[0].match(/^(RAR|MR|BUSINESS)\s+EXPENSE\s*-\s*(.+)$/i)
  if (!heading) throw new ExpenseParseError('Start with `RAR EXPENSE -`, `MR EXPENSE -`, or `BUSINESS EXPENSE -`.')
  const description = heading[2].trim()
  if (!description || description.length > 500) throw new ExpenseParseError('Expense description must be 1 to 500 characters.')

  const amountLine = lines[1].replaceAll(',', '').match(/^([0-9]+(?:\.[0-9]+)?)\s+(USD|MYR|PHP|IDR)$/i)
  if (!amountLine) throw new ExpenseParseError('Put the amount and currency on line 2, for example `45 MYR`.')
  const amount = Number(amountLine[1])
  if (!Number.isFinite(amount) || amount <= 0) throw new ExpenseParseError('Expense amount must be greater than zero.')

  const category = lines[2]?.trim() || 'Other'
  if (category.length > 80) throw new ExpenseParseError('Expense category must be at most 80 characters.')

  return {
    workspace: heading[1].toUpperCase() === 'BUSINESS' ? 'SHARED' : heading[1].toUpperCase(),
    description,
    amount,
    currency: amountLine[2].toUpperCase(),
    category,
  }
}

export function supportedExpenseCurrencies() {
  return [...SUPPORTED_CURRENCIES]
}
