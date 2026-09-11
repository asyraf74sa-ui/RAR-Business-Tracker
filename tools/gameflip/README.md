# Gameflip listing inspector — Phase 1, READ ONLY

Standalone utility in the existing repository. It does not integrate with or change the RAR/MR website, Discord bot, or Supabase. **No listing writes or publishing are implemented. Do not start Phase 2 with this tool.**

## Local setup

Use the project's Node.js version (22.12 or newer). No extra packages are needed. From the repository root in PowerShell:

```powershell
Copy-Item tools/gameflip/.env.example tools/gameflip/.env
notepad tools/gameflip/.env
```

Only copy the example if `.env` does not already exist. Fill these two names locally, then save:

- `GAMEFLIP_API_KEY`
- `GAMEFLIP_OTP_SECRET`

Get both from Gameflip **Settings > Develop > Create API Key**. The second value is the Base32 developer OTP secret, not a current six-digit code or your website password. Never paste either credential into chat or command-line arguments. The local file follows the bot's `.env.example` pattern, is gitignored, and is loaded only by this CLI. The bot's environment file is never loaded. Existing process environment variables take precedence.

Authentication was checked against [Gameflip's official authorization example](https://gameflip.github.io/gfapi/samples/authorization.html) and [official SDK source](https://github.com/gameflip/gfapi/blob/master/index.js): a `GFAPI` authorization header combines the API key with a freshly generated Base32/HMAC-SHA1 TOTP (six digits, 30-second period). Authentication itself needs no write request. Keep Windows automatic date/time synchronization enabled.

## Run

```powershell
# All your matching on-sale RAR listings, including detail fields and comparison
npm run gameflip:inspect

# Matching title(s), plus a comparison against other sampled RAR products
npm run gameflip:inspect -- --search "Dinosaur Fossil"

# Exactly one owned listing, even if expired or not a RAR title
npm run gameflip:inspect -- --id <listing-id>

# Broader status search (API-default expiration filtering still applies)
npm run gameflip:inspect -- --all-statuses

# Sanitized raw JSON (can combine with --search, --id, or --all-statuses)
npm run gameflip:inspect -- --raw

# Help and offline tests; no credentials needed
npm run gameflip:inspect -- --help
npm run gameflip:test
```

Replace `<listing-id>` with the identifier, not a URL. Default filtering matches `Run A Restaurant -` case-insensitively, including names such as `1K (1000) Diamonds Gems`. `--search` is a local title-substring filter, so it cannot accidentally search another seller's listings.

For JSON redirection without npm's script banner: `npm run --silent gameflip:inspect -- --raw`. Progress goes to stderr; JSON goes to stdout. Treat reports as private business information even though credential fields are redacted. If saving reports, use the ignored `tools/gameflip/output/` directory.

## Scope and interpretation

[Gameflip's listing documentation](https://gameflip.github.io/gfapi/Listing.html) defines owner/status filters, expiration ranges, and `next_page` pagination. [The official search sample](https://gameflip.github.io/gfapi/samples/search_listing.html) confirms `v2=true` and USD-cent prices. This inspector:

- Gets the authenticated profile's owner ID, scopes every search to it, and verifies ownership of each detailed listing. It does not print the profile.
- Follows every page, preserves filters, deduplicates IDs, and fails on pagination loops or the 1,000-page safety limit instead of claiming a complete result.
- Defaults to `onsale` listings with Gameflip's default expiration filtering. `--all-statuses` requests the current SDK and legacy documented statuses (`draft`, `prepare`, `ready`, `onsale`, `sale_pending`, `sold`, `cancelled`) but keeps that same expiration scope. Neither mode sends an explicit `expiration` query parameter: production v2 returned HTTP 400 for the legacy open-ended ranges, despite their appearance in the older documentation. Pagination also removes an echoed expiration parameter. This is **not an exhaustive backup** and does not promise expired records: unsearchable/deleted records, undocumented statuses, and records without an indexed expiration may be absent. Use `--id` to read a known owned listing directly, including expired listings, without search filters.
- Reads full details, not only search summaries. Large shops may take time: requests are sequential with a short delay. Rate limits stop the run cleanly; wait before retrying. No automatic repeated authentication attempts occur.
- Shows item fields, candidate settings, lifecycle/metrics/fees, and unclassified API fields separately. The observed stock field is `qty_avail`; `qty_purchased_min` and `expire_in_days` are comparison candidates, not proof of required creation inputs. Seller reputation, sold counts, fees, and identity fields are not template inputs. Missing fields stay “not exposed”; no quantity, region, platform, or game is invented. `accept_currency` is not the price currency. Non-USD explicit currencies retain API units without an assumed conversion.
- Compares up to five distinct products, preferring Dinosaur Fossil, Host Station, Prep Kitchen, Piano, and High Tech Stove. Shared means exactly equal **in this sample**, not necessarily safe for future listings. Missing differs from null; array order matters. A single `--id` read cannot prove common settings. Data is read over time, not as an atomic snapshot.

## Safety boundary

The private transport has a fixed production HTTPS origin and only these GET routes:

- `/api/v1/account/me/profile`
- `/api/v1/listing` with the authenticated owner filter
- `/api/v1/listing/{id}` with ownership verification

There is no configurable host, HTTP method, request body, mutation method, or digital-goods retrieval. Redirects and foreign pagination URLs are blocked before credentials can follow them. Photo URLs are displayed but never fetched. The official SDK is deliberately not installed; this small client needs only Node built-ins.

Errors never print server bodies, headers, stacks, or secret values. Both table and `--raw` output redact known credentials/OTPs, sensitive fields, and URL query strings/fragments (which may be signed). Thus “raw” means the listing data structure, **not an unredacted network dump**. Do not publish reports or use them as an automatic upload template.

All automated tests use injected mock HTTP responses and public TOTP test vectors; they never call Gameflip. Real-account access and exact shop fields must be confirmed by your first local run with your own credentials. Website build/tests and bot tests remain separate; no production records or fake transactions are needed.
