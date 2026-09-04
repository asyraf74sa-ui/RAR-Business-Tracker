# RAR Business Tracker

A polished, mobile-first business dashboard for **Run A Restaurant** traders. It keeps sales, stocktake, Gem conversions, supplier purchases, and farming cycles connected to one inventory source of truth.

## Included

- Email/password signup, sign-in, persistent sessions, and sign-out with Supabase Auth
- Current-month dashboard reporting in `Asia/Kuala_Lumpur`, with authoritative USD, MYR, PHP, and IDR balances
- Combined live USD-equivalent Net Wallet Credit, without changing stored transaction currencies
- Multi-item bundle sales through `rar_record_sale`
- Weekly physical-stock and Gem-wallet reconciliation through `rar_reconcile_stock`
- Item-to-Gem and Gem-to-item transactions with verified inventory results
- Supplier purchases, farming configuration, completed-cycle sync, and manual claims
- Searchable and filterable sales history
- Item catalog, Gem value, farm-item, availability, and platform-fee settings
- First-account defaults seeded only when the authenticated user has no items
- Immediate submission locks and post-RPC stock verification on inventory-changing actions

## Local development

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Supabase

The frontend is connected to the existing RAR Supabase project with its browser-safe publishable key. Row Level Security remains responsible for user isolation. No service-role or secret key is used or required.

The app calls the existing RPC functions:

- `rar_record_sale`
- `rar_reconcile_stock`
- `rar_claim_farm_cycles`
- `rar_record_purchase`
- `rar_convert_item_to_gems`
- `rar_buy_item_with_gems`
- `rar_sync_farm_due`

## Dashboard FX

The current-month wallet hero requests numeric USD-base MYR, PHP, and IDR rates from the keyless [Frankfurter](https://frankfurter.dev/) API through `GET /api/fx`. Vercel caches successful provider responses for one hour, while the browser keeps its last successful response and labels it as fallback data if a later refresh fails. Original-currency totals remain available even when conversion is unavailable.

## Deploy to Vercel

Import this repository into Vercel. The included `vercel.json` identifies Vite and provides the single-page-app rewrite. The keyless FX adapter does not require a secret environment variable.
