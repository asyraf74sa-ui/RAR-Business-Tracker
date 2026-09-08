import assert from 'node:assert/strict'
import test from 'node:test'
import { detectExpenseWorkspace, ExpenseParseError, parseExpenseMessage } from '../src/expense-parser.js'

test('parses RAR, MR, and shared expenses without any catalog lookup', () => {
  assert.deepEqual(parseExpenseMessage('RAR EXPENSE - CLOUD ANDROID PLAN\n45 MYR'), {
    workspace: 'RAR', description: 'CLOUD ANDROID PLAN', amount: 45, currency: 'MYR', category: 'Other',
  })
  assert.deepEqual(parseExpenseMessage('MR EXPENSE - SOFTWARE SUBSCRIPTION\n20 USD\nSoftware'), {
    workspace: 'MR', description: 'SOFTWARE SUBSCRIPTION', amount: 20, currency: 'USD', category: 'Software',
  })
  assert.deepEqual(parseExpenseMessage('BUSINESS EXPENSE - DOMAIN RENEWAL\n60 MYR'), {
    workspace: 'SHARED', description: 'DOMAIN RENEWAL', amount: 60, currency: 'MYR', category: 'Other',
  })
})

test('keeps arbitrary free-text descriptions and custom categories', () => {
  const result = parseExpenseMessage('RAR EXPENSE - 3 FARM ACCOUNT RANDOM BUSINESS TOOL\n1,234.56 PHP\nCloud / VPS')
  assert.equal(result.description, '3 FARM ACCOUNT RANDOM BUSINESS TOOL')
  assert.equal(result.amount, 1234.56)
  assert.equal(result.currency, 'PHP')
  assert.equal(result.category, 'Cloud / VPS')
})

test('detects the expense workspace without treating the description as inventory', () => {
  assert.equal(detectExpenseWorkspace('RAR EXPENSE - DINOSAUR FOSSIL\n10 USD'), 'RAR')
  assert.equal(detectExpenseWorkspace('business expense - domain\n1 usd'), 'SHARED')
  assert.equal(detectExpenseWorkspace('RAR PURCHASE - 1 ITEM\n10 USD'), null)
})

test('rejects malformed, nonpositive, and unsupported-currency expense messages', () => {
  for (const value of [
    'RAR EXPENSE - HOSTING',
    'RAR EXPENSE - HOSTING\n0 USD',
    'RAR EXPENSE - HOSTING\n10 EUR',
    'RAR EXPENSE HOSTING\n10 USD',
    'RAR EXPENSE - HOSTING\n10 USD\nCategory\nExtra',
  ]) assert.throws(() => parseExpenseMessage(value), ExpenseParseError)
})
