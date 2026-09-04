# RAR + MR Discord bot

This folder contains the always-on Windows bot for Run A Restaurant (RAR) and My Restaurant (MR). The two games use isolated inventories and financial tables while sharing the authenticated bot session and Sales Record channel.

- The **shared sales channel** accepts `RAR - ...` and `MR - ...`; the prefix selects the game.
- The existing **RAR acquisition channel** continues to accept RAR purchases, farm claims, trades, additions, and stocktakes.
- The new **MR Operations channel** accepts only `MR PURCHASE`, `MR TRADE`, `MR ADD`, and `MR STOCK`.
- `/help`, `/stock`, `/monthly`, and `/months` are registered as server commands and respond privately. Stock and financial reports refresh authenticated data from Supabase whenever they run.

Every accepted Discord message gets a deterministic request UUID. Retrying a message cannot create a duplicate operation. Editing a recorded message does not rewrite history; the bot tells you to correct it through the RAR tracker.

## 1. Install Node.js

Install **Node.js 22 or newer** from [nodejs.org](https://nodejs.org/), then open a new Command Prompt and verify:

```bat
node --version
npm --version
```

## 2. Prepare Discord

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create or open the application and add a bot.
2. Under **Bot > Privileged Gateway Intents**, enable **Message Content Intent**.
3. Copy or reset the bot token. Treat it like a password.
4. Invite the bot with the `bot` and `applications.commands` scopes. Give it permission to view both configured channels, read message history, send messages, and use application commands.
5. In Discord, enable **User Settings > Advanced > Developer Mode**.
6. Right-click the server and choose **Copy Server ID**.
7. Create or choose three separate channels: Sales Record, RAR acquisitions, and MR Operations. Right-click each and choose **Copy Channel ID**.

## 3. Install dependencies

```bat
cd C:\path\to\RAR-Business-Tracker\discord-bot
npm install
```

## 4. Configure `.env`

Copy the example, then fill every blank value:

```bat
copy .env.example .env
notepad .env
```

```dotenv
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_server_id
DISCORD_SALES_CHANNEL_ID=your_sales_channel_id
DISCORD_ACQUISITION_CHANNEL_ID=your_separate_acquisition_channel_id
DISCORD_MR_OPERATIONS_CHANNEL_ID=your_mr_operations_channel_id

SUPABASE_URL=https://aiufjjedsgatmnhocxyz.supabase.co
SUPABASE_ANON_KEY=sb_publishable_izEtafPfqUazScWRmBfocw_acP5teS7
SUPABASE_EMAIL=your_normal_supabase_login_email
SUPABASE_PASSWORD=your_normal_supabase_login_password
```

All three channel IDs must be different. Use the normal Supabase account that owns the tracker data; never add a service-role key. `.env` is ignored by Git, so tokens, passwords, and sessions remain local.

## 5. Apply the database migrations

Apply all repository migrations to the same Supabase project before starting the bot. `20260904101125_mr_phase1_backend_bot.sql` adds the isolated MR tables/RPCs, furniture-set metadata, and PayPal/TNG platform support without seeding MR catalog items or changing existing business records.

## 6. Test and start

```bat
npm test
npm run check
npm start
```

You can also double-click `start-bot.bat`. On startup, the bot idempotently registers or updates the server-scoped `/help`, `/stock`, `/monthly`, and `/months` commands without replacing unrelated commands. If you change `.env` or update the code, restart the bot.

## Message formats

### Read-only monthly financial reports

Run `/monthly` for the current Malaysia-calendar month, or select a strict `YYYY-MM` month:

```text
/monthly game:RAR
/monthly game:MR month:2026-09
```

Run `/months` for every month containing at least one sale or cash supplier purchase, newest first:

```text
/months game:RAR
/months game:MR
```

All financial responses are private. Each report keeps USD, MYR, PHP, and IDR separate; currencies are never mixed, converted, or combined into a fake grand total.

```text
Net Profit = Actual Wallet Credit after tax - Item Purchase Spending
```

**Platform Tax is shown for reference but is not subtracted again.** `rar_sales.net_credit` is already the amount actually received in the marketplace wallet after platform fees. Item Purchase Spending includes only non-null cash costs on `supplier_purchase` events created by `RAR PURCHASE`; farm, trade, ADD, STOCK, gem, and other non-cash events are excluded. Multi-item purchase cash is stored once and counted once.

Reports use `Asia/Kuala_Lumpur` calendar-month boundaries (`>=` month start and `<` next month), page through long histories without silent truncation, and perform authenticated Supabase `SELECT` operations only. No database migration or new environment variable is required.

### Read-only stock views

Run this slash command from any server channel to view all current active inventory, including Gems and zero-stock items:

```text
/stock game:RAR
/stock game:MR
```

To view one canonical item only:

```text
/stock item:Piano
```

The response is private and refreshed from Supabase each time. `/stock` = **VIEW only**; it never changes inventory or creates an inventory event. `RAR STOCK - ...` = **SET/RECONCILE** exact quantities and must be posted in the acquisition channel. This read-only slash command requires no database migration.

### Sales and acquisition messages

Post RAR or MR sales only in the shared Sales Record channel:

```text
RAR - 3,000 GEMS, 1 PIANO
12.42 US
1.38 US TAX
ZEUSX
```

```text
MR - 1 ITEM NAME
35 MYR
0 MYR TAX
Touch 'n Go eWallet
```

Recognized canonical platforms are Eldorado, ZeusX, Gameflip, PlayerAuctions, G2G, Itemku, PayPal, TNG, and Direct. PayPal spelling is normalized to `PayPal`; `TNG`, `TNG eWallet`, `Touch n Go`, `Touch 'n Go`, and `Touch 'n Go eWallet` normalize to `TNG`. The supplied fee may be zero or nonzero; the bot never invents it.

Post these only in the acquisition channel.

Purchase — the second line is the total bundle cost, counted once:

```text
RAR PURCHASE - 5 HOST STATION, 2 GREENHOUSE
336 PHP
```

Accepted purchase currencies are `USD`, `US`, `$`, `MYR`, `RM`, `PHP`, and `IDR` (normalized to `USD`, `MYR`, `PHP`, or `IDR`).

Farm — quantities come from the tracker’s current farming account and units-per-item settings:

```text
RAR FARM - 1 CYCLE
```

Trade — GIVE is deducted and RECEIVE is added in one database transaction, with no cash revenue or purchase:

```text
RAR TRADE
GIVE - 1 PIANO
RECEIVE - 6,000 GEMS
```

Manual addition — **ADD increases the existing quantity** and records no cash cost:

```text
RAR ADD - 5 HOST STATION
```

Bundles may use commas or plus signs:

```text
RAR ADD - 5 HOST STATION, 3 GREENHOUSE, 2 DINOSAUR FOSSIL
RAR ADD - 2 PIANO + 4,000 GEMS
```

For example, if Host Station is currently 10, `RAR ADD - 5 HOST STATION` changes it to 15. ADD quantities must be greater than zero. Use `RAR PURCHASE` instead when the acquisition has a cash cost.

Physical stocktake — **STOCK replaces the tracked quantity with the exact counted quantity**:

```text
RAR STOCK - 17 HOST STATION
RAR STOCK - 17 HOST STATION, 8 GREENHOUSE, 46,398 GEMS
```

If Host Station is currently 10, `RAR STOCK - 5 HOST STATION` sets it to exactly 5; it does not add 5. A counted quantity of zero is valid. Each reply shows the previous quantity, counted quantity, and adjustment, including `no change` when they are equal.

ADD and STOCK bundles are atomic: an invalid item or quantity rejects the entire message without a partial inventory change. Both use the Discord timestamp and a deterministic operation-specific request ID, so the same message cannot change stock twice.

### MR Operations channel

Use the same operation shapes with the `MR` prefix in the separate MR Operations channel:

```text
MR PURCHASE - 5 ITEM A, 2 ITEM B
25 USD

MR TRADE
GIVE - 1 ITEM A
RECEIVE - 2 ITEM B

MR ADD - 5 ITEM A, 3 ITEM B
MR STOCK - 17 ITEM A, 0 ITEM B
```

MR has no FARM command. MR set aliases are accepted only after a confirmed family and its aliases have been configured in `mr_set_families`; each set expands atomically to one table plus four chairs. No production MR catalog or set family is seeded by this phase.

Names are matched case-insensitively, with basic singular/plural handling and the `Dino Fossil` alias for `Dinosaur Fossil`. Unknown or ambiguous items reject the whole operation. If any GIVE item has insufficient stock, nothing is changed and the reply shows the item, required quantity, and available quantity.

Run `/help` anywhere in the configured server. Choose **Monthly financial reports** for the accounting formula, **Stock overview (read only)** for `/stock`, or **Valid item names** for canonical item names. Long catalogs, stock overviews, and financial histories are split across private embed messages within Discord limits.

## Start automatically when Windows logs in

1. Press `Win + R`, enter `taskschd.msc`, and press Enter.
2. Select **Create Task** and name it `RAR Discord Bot`.
3. On **General**, choose **Run only when user is logged on**.
4. On **Triggers**, add **At log on** for your Windows account.
5. On **Actions**, choose **Start a program**:
   - **Program/script:** the full path to `discord-bot\start-bot.bat`
   - **Start in:** the full path to the `discord-bot` folder, without quotes
6. On **Settings**, enable **Restart the task if it fails** and remove any fixed stop time.
7. Save it, right-click it, and choose **Run** once to test it.

The PC must remain powered on, online, and signed in.

## Troubleshooting

- **Missing environment variables:** confirm the file is named `.env`, not `.env.txt`, and includes the guild and all three channel IDs.
- **A slash command is missing:** confirm the bot was invited with `applications.commands`, the guild ID is correct, and the startup console says `/help`, `/stock`, `/monthly`, and `/months` are ready.
- **Messages are ignored:** confirm you used the correct format in the correct channel and enabled Message Content Intent.
- **Unknown item:** run `/help` with the **Valid item names** topic and copy a canonical active name.
- **ADD versus STOCK:** use ADD to increase current inventory; use STOCK only to set an exact physical count.
- **Insufficient stock:** correct inventory in the tracker; a failed sale or trade does not partially update stock.
- **Database function not found:** apply the acquisition migration to the configured Supabase project, then restart the bot.
- **Network interruption:** discord.js reconnects automatically. RPC retries are bounded and reuse the same deterministic request UUID.
