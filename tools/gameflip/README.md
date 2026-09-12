# Gameflip local tools

Standalone utilities in the existing repository. They do not integrate with or change the RAR/MR website, Discord bot, or Supabase. The **Phase 1 inspector remains strictly read-only**. The separate **Phase 2 uploader defaults to dry-run** and requires two explicit flags for writes. See [Bulk uploader](#bulk-uploader--phase-2) below.

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

## Inspector — Phase 1, READ ONLY

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

## Inspector safety boundary

The private transport has a fixed production HTTPS origin and only these GET routes:

- `/api/v1/account/me/profile`
- `/api/v1/listing` with the authenticated owner filter
- `/api/v1/listing/{id}` with ownership verification

There is no configurable host, HTTP method, request body, mutation method, or digital-goods retrieval. Redirects and foreign pagination URLs are blocked before credentials can follow them. Photo URLs are displayed but never fetched. The official SDK is deliberately not installed; this small client needs only Node built-ins.

Errors never print server bodies, headers, stacks, or secret values. Both table and `--raw` output redact known credentials/OTPs, sensitive fields, and URL query strings/fragments (which may be signed). Thus “raw” means the listing data structure, **not an unredacted network dump**. Do not publish reports or use them as an automatic upload template.

All automated tests use injected mock HTTP responses and public TOTP test vectors; they never call Gameflip. Website build/tests and bot tests remain separate; no production records or fake transactions are needed.

## Bulk uploader — Phase 2

**No live listing creation was performed to validate this implementation. Review a dry-run before considering live use.** Do not overwrite your existing `tools/gameflip/.env`; the uploader uses that same ignored local file. Never put credentials in JSON or command-line arguments.

From the repository root, first prepare your private input (copy only if `listings.json` does not already exist):

```powershell
Copy-Item tools/gameflip/listings.example.json tools/gameflip/listings.json
notepad tools/gameflip/listings.json
```

Images are optional: omit the `image` field to skip every photo operation. For custom images, place your actual PNG/JPEG product images in `tools/gameflip/images/`. The example has descriptions supplied in the Phase 2 request; it includes **no placeholder product images**. Adjust descriptions/prices/quantities to exactly what you intend to sell. Images, private `listings.json`, and `runs/` are ignored by Git. Private JSON files with other names should also be kept outside Git or added to your local ignore rules.

Run a read-only preview:

```powershell
npm run gameflip:upload -- --file tools/gameflip/listings.json
```

To preview the supplied example against existing account titles without copying it:

```powershell
npm run gameflip:upload -- --file tools/gameflip/listings.example.json
```

Existing titles are reported as `SKIP` before creation-field validation or image loading. A duplicate-only preview can therefore contain just `name` and `price_usd`, without description, quantity or image. **SKIP does not validate these fields for future creation.** New entries and draft resumptions require the creation fields below and a valid image **only if explicitly supplied**; invalid values appear as `ERROR`, never `CREATE`. `--allow-duplicate` does not bypass this validation. Dry-run makes only GET requests and does not write run state, allocate/upload photos, change stock, or publish anything. `CREATE` means local validation passed and no indexed duplicate was found, **not** that Gameflip has validated a create/publish request.

Only after reviewing the complete preview, this separate command enables live writes:

```powershell
# FUTURE LIVE USE ONLY — this was not run during implementation.
npm run gameflip:upload -- --file tools/gameflip/listings.json --execute --confirm UPLOAD
```

`--execute` alone prints the plan count but refuses all writes. The second confirmation is deliberately non-interactive and case-sensitive. `--verbose` adds sanitized request-method/stage diagnostics, never headers, response bodies or signed URLs. `--allow-duplicate` explicitly allows matching titles already in the account; it **does not bypass** duplicate input entries, recovery state, validation, ownership checks, or photo verification.

### Input contract

```json
[
  {
    "name": "Golden Chair",
    "description": "Your exact product description here.",
    "price_usd": "1.55",
    "qty_avail": 20,
    "image": "./images/golden-chair.png"
  }
]
```

- `name` becomes `Run A Restaurant - Golden Chair`. Optional `title` replaces the generated title. A pre-existing RAR prefix is not doubled. Comparison trims surrounding whitespace and ignores case; internal whitespace is not collapsed.
- `description` must be an explicit string and is sent **exactly as supplied**, including ordinary line breaks. Use `""` when the supplied product description is intentionally blank; missing/null descriptions remain errors. Empty text can be prepared locally, but its acceptance for publication on this seller's current Custom Item category has **not** been confirmed by a live write. No descriptions are generated, borrowed, or substituted after an API rejection.
- `price_usd` accepts a number or decimal string. Decimal strings are recommended for strict decimal precision. Conversion uses decimal digits and integer arithmetic, never floating-point multiplication or rounding. More than two decimal places are rejected. JSON numbers have already undergone JavaScript number parsing; use strings to preserve the original decimal spelling.
- `qty_avail` is an integer from 1–10,000, only from this JSON. No inventory database is contacted and quantities are never silently clamped. User-authorized marketplace availability (including artificial availability for zero-stock products) is not physical tracker stock and never creates inventory/events or changes acquisition cost.
- `image` is optional. Omit the field for no photo; empty strings, null and invalid paths are errors, not silent opt-outs. If supplied, it resolves relative to the **JSON file's directory**, not the terminal directory. Local absolute paths also work. URLs/network-share paths are rejected. Only non-empty regular PNG/JPEG files up to **500,000 bytes** are accepted; extension/signature/basic completeness must agree. This is not a full image decoder or malware scanner. Re-export images if validation fails.
- Tool safety caps: 200 entries / 1 MB input, 120-character title, 5,000-character description, $0.01–$10,000.00, quantity 1–10,000. These are conservative local limits, **not a claim of Gameflip's undocumented maximums**. The image cap follows the official SDK. Unsupported input fields are rejected; do not supply IDs, API payloads, owner metadata, `photo` or `cover_photo`.

The payload uses the inspected template in `upload-input.js`: `tags` is exactly **`["id: other", "type: Other"]`**, not an object or the string `Other`. All shared settings are preserved, including minimum purchase 1, 30-day expiry, public visibility, one-day coordinated digital transfer, and `accept_currency: "USD"`. `price` is integer USD cents. No additional game/platform/category IDs, seller fees, sold counts, or existing photo IDs are copied.

### Live workflow and recovery

1. Validate input and images; search the authenticated owner's listings through every returned page. Acquire an account-wide local execution lock before reading recovery state/planning a live run.
2. Before **each** new creation, repeat the entire duplicate scan. Save `create_pending` durably before sending `POST /api/v1/listing` with `status: "draft"`. Immediately save the returned listing ID.
3. GET that owned draft and verify every requested template/item field exactly. Unexpected fields, quantities, status or server coercions stop this item before publication.
4. **Only when an image is supplied:** allocate a **new** photo with `POST /api/v1/listing/{id}/photo`. PUT the local bytes to the issued HTTPS S3 URL with image Content-Type and **without Gameflip authorization**. Redirects and unexpected storage hosts are blocked. PATCH this draft's own photo to active, display order 0, and cover photo. An omitted image makes none of these calls and sets no `photo`/`cover_photo` fields; no default image is uploaded or borrowed.
5. GET and verify all fields plus the active cover photo **if an image was supplied**. PATCH to `onsale` only after verification, then GET to confirm. PATCH requests use the raw numeric document version in `If-Match`, plus atomic JSON Patch tests of version and unpublished status. Production rejected quoted/weak ETags with HTTP 412 even when unchanged; the returned ETag is still checked against the document version before writing. Omitted images do not bypass field, status, ownership, version or recovery checks.

Production compatibility verified on 2026-09-12: an approved empty description is sent as `""`, but Gameflip omits that field from readback. Only that absence is accepted as equivalent to the explicitly empty string; other text/fields remain exact. Publishing required an active cover photo and rejected $0.50 with “Listing price must be more than $0.74”. Local validation alone does not guarantee publication. Never invent description text or raise an approved price automatically. The client also supports an opt-in OTP boundary guard for callers using a measured official server clock.

The workflow follows the [official listing/photo API](https://gameflip.github.io/gfapi/Listing.html), [official in-game listing sample](https://gameflip.github.io/gfapi/samples/rl_listing.html), and [official SDK](https://github.com/gameflip/gfapi/blob/master/index.js). Only the uploader imports mutation code; the inspector's transport and tests are unchanged.

**Keep `tools/gameflip/runs/` backed up privately.** One account-scoped journal stores only title, payload/image fingerprint, listing ID, photo ID and stage. It stores no descriptions, image bytes, upload URLs, credentials or raw responses. Copying/renaming an input file still finds the same title's recovery record. Journals are atomically replaced after flushing; a write failure stops the batch. A crash may leave a `.tmp` and `.lock`; preserve the journal and inspect the last attempted stage before cleanup. Confirm no uploader is running before removing only a stale account `.lock` file; do not delete `runs/` to force another create.

- Image/validation failures retain an unpublished draft and its ID; other independent entries continue when safe. The failure line states the exact stage and known ID.
- Rerun the **same input and images** with live flags to resume that exact draft. A changed payload/image (including adding or removing the optional image), changed remote listing, or another matching listing requires review. Recovery never edits pre-existing listings merely because their title matches.
- A signed upload URL is not saved. If upload did not finish, resume allocates a fresh photo **on the same draft**. An unused pending photo may remain; no deletion endpoint is implemented. No photo ID is borrowed from another product.
- A lost create response, unreadable create response, or HTTP 5xx after a create POST is ambiguous: stop the batch and leave `create_pending`. Do **not** re-create automatically. Inspect your Gameflip seller listings and journal first; manual reconciliation is required because the API has no documented create-idempotency key. A clear validation/auth/429 rejection is recorded as `create_rejected` and can safely be attempted again after correcting the cause.
- A publish response lost after success is resolved by GET on the retained ID on the next run, not another create. Completed journal entries always skip, even with `--allow-duplicate`. If an item sells before post-publish verification, changed quantity may require manual review; the tool never restocks it to force verification.
- API calls are paced at least 250 ms apart; allocation POSTs at least 21 seconds apart (the SDK uses a three-POSTs-per-minute limit). GET/PUT/conditional PATCH transient failures and explicit 429 rejections get bounded exponential backoff, honoring `Retry-After` and supported rate-limit headers. POST network/5xx ambiguity is never blindly retried. A server-requested wait over 60 seconds stops the batch instead of retrying early. Authentication failures, ambiguous creates, unsafe pagination, journal/lock failures and exhausted rate limits halt further work.

### API limitations / what is and is not verified

- A manual **GET-only** probe on 2026-09-11 confirmed production accepts the two-ended range `1970-01-01T00:00:00.000Z,9999-12-31T23:59:59.999Z`. It returned 28 owned records (19 on sale, 9 sold). Production rejected `expiration=any`; it also rejects the legacy `expiration=now,`. The uploader uses the working finite range and all seven SDK/legacy statuses with pagination; it never silently falls back to an on-sale-only scan. The inspector deliberately retains its separate API-default expiration behavior.
- Search is not an atomic account-wide lock. Deleted/unindexed listings, records without indexed expiration, undocumented statuses or records outside the date bounds may be absent. Local journaling plus immediate rechecks prevent repeat creation by this tool with intact state; they cannot promise global uniqueness against other devices/clients or a delayed search index. Do not run multiple uploaders from separate copies of the repository.
- The published API documents a general listing schema, **not a complete current Custom Item required-field schema**. The SDK's `draft` status and the observed `qty_avail`, `qty_purchased_min`, `accept_currency`, `visibility` and expiry fields are sent and checked, but their creation-time acceptance for this seller has **not been live-tested**. The first future live attempt may fail safely and retain a draft. No unsafe fallback drops stock/minimum/template fields or publishes anyway.
- The general API describes zero or more photos and allows creation of an empty draft. That is not proof of publication-time acceptance of empty descriptions, no-image Custom Items, or every requested stock quantity. Dry-run does not submit these fields to the server. Any future server rejection is reported without adding text/photos or changing quantity to force acceptance.
- PNG/JPEG and S3 photo allocation follow the documented workflow; the current seller's new-photo URL format and server image processing have not been exercised because that would mutate the account. Unexpected hosts or missing photo metadata require review instead of a permissive fallback.
- Version-protected publication is implemented and tested with mocks, not proof of live server enforcement. Read back checks cannot compensate for a compromised/misbehaving server. No live success is claimed.

### Testing

```powershell
npm run gameflip:test
npm run check
npm --prefix discord-bot test
npm --prefix discord-bot run check
```

Uploader tests supply their own in-memory HTTP server responses, clock, credentials and temporary files. They never load `.env` or fall back to real network access. They cover default dry-run, confirmation gates, exact field/price handling, duplicate scans, pagination failures, image validation, photo transport isolation, conditional publish, partial failures, lost responses, resumability, locking and redaction. Exit status is nonzero if any entry is invalid, fails, is not attempted for safety, or setup fails; skipped duplicates are successful outcomes.
