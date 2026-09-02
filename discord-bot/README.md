# RAR Discord sales bot

This folder is a separate, always-on Windows bot for the existing RAR Business Tracker. It does not run on Vercel and does not change the frontend or database schema.

The bot watches one configured Discord channel, ignores bots and every other channel, resolves item names against your authenticated Supabase `rar_items`, checks stock, and calls the existing `rar_record_sale` RPC. The RPC receives a deterministic request UUID derived from the Discord guild, channel, and message IDs, so retrying the same Discord message cannot create a second sale.

## 1. Install Node.js

The bot requires **Node.js 22 or newer**. Supabase no longer supports Node 20.

1. Open [nodejs.org](https://nodejs.org/).
2. Download and run the Windows installer for a current LTS release (Node 22 or newer).
3. Keep the installer option that adds Node.js and npm to `PATH`.
4. Open a new Command Prompt and verify:

```bat
node --version
npm --version
```

## 2. Prepare the Discord bot

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Create or open your application and add a bot.
2. Under **Bot > Privileged Gateway Intents**, enable **Message Content Intent**.
3. Copy/reset the bot token. Treat it like a password.
4. Invite the bot to your server with permission to view the sales channel, read message history, and send messages.
5. In Discord, enable **User Settings > Advanced > Developer Mode**.
6. Right-click the RAR sales channel and select **Copy Channel ID**.

## 3. Install dependencies

Open Command Prompt, change to this folder, and install the exact versions recorded in `package-lock.json`:

```bat
cd C:\path\to\RAR-Business-Tracker\discord-bot
npm install
```

## 4. Create `.env`

Copy the example file:

```bat
copy .env.example .env
```

Open `.env` in Notepad and fill in every blank value:

```dotenv
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_SALES_CHANNEL_ID=your_sales_channel_id

SUPABASE_URL=https://aiufjjedsgatmnhocxyz.supabase.co
SUPABASE_ANON_KEY=sb_publishable_izEtafPfqUazScWRmBfocw_acP5teS7
SUPABASE_EMAIL=your_normal_supabase_login_email
SUPABASE_PASSWORD=your_normal_supabase_login_password
```

Use the same normal Supabase email/password account that owns the RAR tracker data. Do not use or add a service-role key.

`.env` is ignored by Git. Never commit or send the Discord token, Supabase password, access token, refresh token, or session data. The included Supabase publishable key is intended for public clients; your account credentials are not.

## 5. Test and start

Run the parser and duplicate-ID tests:

```bat
npm test
```

Start the bot by double-clicking `start-bot.bat`, or run:

```bat
npm start
```

Successful startup prints only a short authentication/catalog status and the Discord bot name/channel. It never prints credentials or session tokens.

Example accepted message:

```text
RAR - 3,000 GEMS , 1 PIANO
12.42 US
1.38 US TAX
ZEUSX
```

Supported platforms are Eldorado, ZeusX, Gameflip, PlayerAuctions, G2G, Itemku, and Direct. Currency markers currently supported are `USD`, `US`, and `$`, all recorded as USD. Item separators may be commas or `+`; item matching ignores case, supports basic singular/plural wording, and maps `Dino Fossil` to the catalog item `Dinosaur Fossil`.

Unknown or ambiguous items and insufficient stock are rejected without recording a sale. If a successfully recorded Discord message is edited, the bot warns you to edit the transaction in the RAR tracker instead.

## 6. Start automatically when Windows logs in

1. Press `Win + R`, enter `taskschd.msc`, and press Enter.
2. Select **Create Task** (not Basic Task).
3. On **General**, name it `RAR Discord Sales Bot` and choose **Run only when user is logged on**.
4. On **Triggers**, add **At log on** for your Windows account.
5. On **Actions**, add **Start a program**:
   - **Program/script:** the full path to `discord-bot\start-bot.bat`
   - **Start in:** the full path to the `discord-bot` folder, without quotes
6. On **Conditions**, optionally clear **Start the task only if the computer is on AC power** if this is a laptop.
7. On **Settings**, enable **Restart the task if it fails** and clear any setting that stops it after a fixed running time.
8. Save the task, right-click it, and choose **Run** once to test it.

The PC must remain powered on, connected to the internet, and signed in for the bot to keep running. After changing `.env` or updating the code, stop the scheduled task and run it again.

## Troubleshooting

- **Missing environment variables:** check that the file is named exactly `.env`, not `.env.txt`.
- **Supabase authentication failed:** verify the normal account email/password and confirm the account can sign in to the tracker.
- **Discord login failed:** reset the bot token in the Developer Portal and update `.env`.
- **Messages are ignored:** confirm the channel ID, Message Content Intent, bot permissions, and that the author is not another bot.
- **Unknown platform/item:** use a supported platform and an active item name from the RAR tracker. The bot deliberately does not guess ambiguous names.
- **Insufficient stock:** correct inventory in the tracker; the bot never manufactures stock.
- **Network interruption:** discord.js reconnects automatically. RPC write retries are bounded and reuse the same deterministic request UUID.
