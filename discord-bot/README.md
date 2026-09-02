# RAR Discord bot

This folder contains the always-on Windows bot for the existing RAR Business Tracker. It keeps sales and inventory-acquisition messages in separate Discord channels and uses authenticated Supabase RPCs for atomic database changes.

- The **sales channel** accepts only `RAR - ...` sales. Existing sale behavior and duplicate IDs are preserved.
- The **acquisition channel** accepts purchases, farm claims, in-game trades, manual additions, and exact stocktakes. Sale messages in this channel are ignored.
- `/help` is registered as a server command and responds privately. Its **Valid item names** topic refreshes the active catalog from Supabase each time.

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
7. Right-click the sales channel and the separate acquisition channel and choose **Copy Channel ID** for each.

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

SUPABASE_URL=https://aiufjjedsgatmnhocxyz.supabase.co
SUPABASE_ANON_KEY=sb_publishable_izEtafPfqUazScWRmBfocw_acP5teS7
SUPABASE_EMAIL=your_normal_supabase_login_email
SUPABASE_PASSWORD=your_normal_supabase_login_password
```

The two channel IDs must be different. Use the normal Supabase account that owns the RAR tracker data; never add a service-role key. `.env` is ignored by Git, so tokens, passwords, and sessions remain local.

## 5. Apply the acquisition migration

The repository migrations `supabase/migrations/20260902054745_discord_acquisition_operations.sql` and `supabase/migrations/20260902064501_discord_manual_add.sql` provide the new atomic RPCs. Exact stocktakes reuse the existing `rar_reconcile_stock_batch` RPC. Apply repository migrations to the same Supabase project before starting this version of the bot. The migrations preserve existing rows, sale behavior, and farm configuration.

## 6. Test and start

```bat
npm test
npm run check
npm start
```

You can also double-click `start-bot.bat`. On startup, the bot registers or updates the server-scoped `/help` command without replacing unrelated commands. If you change `.env` or update the code, restart the bot.

## Message formats

Post sales only in the sales channel:

```text
RAR - 3,000 GEMS, 1 PIANO
12.42 US
1.38 US TAX
ZEUSX
```

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

Names are matched case-insensitively, with basic singular/plural handling and the `Dino Fossil` alias for `Dinosaur Fossil`. Unknown or ambiguous items reject the whole operation. If any GIVE item has insufficient stock, nothing is changed and the reply shows the item, required quantity, and available quantity.

Run `/help` anywhere in the configured server. Choose its **Valid item names** topic for the current canonical names accepted by the bot; long catalogs are split across multiple private embed messages within Discord limits.

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

- **Missing environment variables:** confirm the file is named `.env`, not `.env.txt`, and includes the guild and both channel IDs.
- **`/help` is missing:** confirm the bot was invited with `applications.commands`, the guild ID is correct, and the startup console says the command is ready.
- **Messages are ignored:** confirm you used the correct format in the correct channel and enabled Message Content Intent.
- **Unknown item:** run `/help` with the **Valid item names** topic and copy a canonical active name.
- **ADD versus STOCK:** use ADD to increase current inventory; use STOCK only to set an exact physical count.
- **Insufficient stock:** correct inventory in the tracker; a failed sale or trade does not partially update stock.
- **Database function not found:** apply the acquisition migration to the configured Supabase project, then restart the bot.
- **Network interruption:** discord.js reconnects automatically. RPC retries are bounded and reuse the same deterministic request UUID.
