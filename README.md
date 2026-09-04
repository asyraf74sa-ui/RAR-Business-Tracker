# RAR + MR Business Tracker

A private, mobile-first business tracker for **Run A Restaurant (RAR)** and **My Restaurant (MR)**. The permanent dark interface provides three clearly separated workspaces: All Business for financial aggregation, RAR for the established RAR workflows, and MR for independent MR inventory and operations.

## Included

- Email/password signup, sign-in, persistent sessions, and sign-out with Supabase Auth
- All Business current, previous-month, lifetime, and continuous monthly financial reporting in `Asia/Kuala_Lumpur`
- Combined live USD-equivalent Net Wallet Credit with RAR/MR contribution and platform performance, without changing stored currencies
- Independent RAR and MR inventory views—catalog stock is never combined across games
- Multi-item RAR sales through `rar_record_sale`
- Weekly physical-stock and Gem-wallet reconciliation through `rar_reconcile_stock`
- Item-to-Gem and Gem-to-item transactions with verified inventory results
- Supplier purchases, farming configuration, completed-cycle sync, and manual claims
- MR item/set sales, purchases, and two-sided trades through atomic production RPCs
- Derived MR furniture set availability using one table plus four chairs; no fake set stock is stored
- Game-scoped operational history and combined financial-only history
- Safe RAR and MR catalog managers that preserve item IDs, stock, and historical references
- Item catalog, aliases, categories, Gem value, farm-item, availability, and platform-fee settings
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

The browser uses only the publishable Supabase key. Authenticated, security-invoker RPCs and Row Level Security enforce user isolation; no service-role secret is exposed to the frontend.

Key RAR RPC functions:

- `rar_record_sale`
- `rar_reconcile_stock`
- `rar_claim_farm_cycles`
- `rar_record_purchase`
- `rar_convert_item_to_gems`
- `rar_buy_item_with_gems`
- `rar_sync_farm_due`
- `rar_upsert_catalog_item`

Key MR RPC functions:

- `mr_record_sale`
- `mr_record_purchase_bundle`
- `mr_record_trade`
- `mr_add_stock_bundle`
- `mr_reconcile_stock_batch`
- `mr_save_catalog_item`
- `mr_upsert_set_family`

The Phase 2 migration is additive. It adds safe RAR catalog metadata and authenticated catalog/set-family RPCs without changing existing stock, item IDs, or historical transaction rows.

## Dashboard FX

The wallet views request numeric USD-base MYR, PHP, and IDR rates from the keyless [Frankfurter](https://frankfurter.dev/) API through `GET /api/fx`. Vercel caches successful provider responses for one hour, while the browser keeps its last successful response and labels fallback data if a later refresh fails. Original-currency totals remain available when conversion is unavailable. Monthly history is explicitly labeled as a current-rate USD equivalent because historical exchange rates are not stored.

## Verification

Run the 41 frontend tests and production build from the repository root:

```bash
npm test
npm run build
```

Run the Discord/backend regression suite independently:

```bash
cd discord-bot
npm test
```

## Deploy to Vercel

Import this repository into Vercel. The included `vercel.json` identifies Vite and provides the single-page-app rewrite. The keyless FX adapter does not require a secret environment variable.
