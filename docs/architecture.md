# Clover POS <-> Zkong ESL Cloud Middleware

## Status
**Implemented and running.** Bidirectional price sync is live: Clover → Zkong via webhook,
Zkong → Clover via poller, and Zkong discounts → Clover via extended-field detection.
See **Implementation Status** below and `docs/USER_GUIDE.md` for usage.

## Goal
A Node.js/TypeScript middleware that keeps product catalog, prices, and inventory in sync
between Clover POS and Zkong ESL Cloud, running locally/in Docker.

---

## Key Finding: Zkong Has No Webhook for Standard Price/Catalog Updates

This was the central open question of the planning phase. Conclusion, confirmed by reading
Zkong's API 4.3 spec and their own integration overview doc:

- There is **no dashboard field** in the Zkong `homePage` console to register a webhook URL
  for standard ESL price tag / product updates. Sync there is request/response, not
  event-driven.
- Zkong does have one push-callback mechanism (`POST /zk/config/settingCallbackUrl`,
  section 4.23 of the API doc), but it is scoped **only** to picking-light (PTL) hardware:
  light-off reports and short/long button-press events. It is unrelated to price tag
  content sync and registered via an API call, not a UI setting.
- There is a second callback (`4.30`, PTL Button Information Push) which is also PTL-only
  and configured out-of-band (you give Zkong a URL manually, no registration API).
- Standard product/price/inventory sync to ESL tags is done via
  `POST /zk/item/batchImportItem` (request/response, immediate success/fail).
- There is no push notification for "tag successfully rendered the new price" and no push
  notification for "someone edited a product in the Zkong console." Both must be detected
  by polling.

This means the middleware **cannot** be symmetric (webhook both ways). It has to be:
- Clover -> Zkong: event-driven (Clover webhook triggers immediate write to Zkong)
- Zkong -> Clover: polling only (no equivalent event source exists on the Zkong side)

## Clover Side (reference)

- REST API (OAuth2) + webhooks. Webhooks require a public HTTPS endpoint (localhost does
  not work), and require the corresponding Read permission (e.g. Read Inventory) on the
  installed app.
- Relevant data model: Items, Categories, Inventory, Orders, Payments, Employees, Customers.
- We will use Clover webhooks (`item.create`, `item.update`, `item.delete`,
  `inventory.update`) as the primary trigger for pushing changes to Zkong.

## Zkong Side (confirmed endpoints)

Base host used in all examples: `esl-eu.zkong.com` (EU server; matches the login URL the
user has credentials for, `https://esl-eu.zkong.com/template/merchantTemplate`).

### Auth flow
1. `GET /zk/user/getErpPublicKey` -> RSA public key
2. Encrypt password with that key (RSA)
3. `POST /zk/user/login` with `{ account, password: <RSA-encrypted>, loginType: 3 }` -> returns token
4. Send `Authorization: <token>` header on every subsequent request
5. On `401`, re-login and retry (no documented fixed token TTL; treat as reactive re-auth)

### Clover -> Zkong (push)
- `POST /zk/item/batchImportItem`
  - Upsert semantics keyed on `barCode`
  - Up to 20,000 items per request
  - Required fields per item: `barCode`, `attrCategory`, `attrName` (plus `merchantId`,
    `agencyId` at the request level)
  - Price fields: `originalPrice`, `price`, `memberPrice`
  - `emptyNeedDelete` query param: `0` = keep original value when new field is empty,
    `1` = overwrite with empty (default `1`) -> **we must always send full item payloads**,
    not partial diffs, or we risk blanking fields we didn't intend to touch.
  - `storeId` empty -> writes to merchant-level product list; `storeId` set -> writes to
    that store only. `externalStoreId` + `useExternalStoreId=1` supported as an alternative,
    but the external store ID must already exist in Zkong.
  - Response is synchronous success/fail (per item and overall) -- this confirms the write
    landed in Zkong's DB, not that the physical tag has re-rendered yet.
- `POST /zk/item/batchDeleteItem` -- remove items by barcode.

### Zkong -> Clover (poll, since no webhook exists)
- `POST /zk/erp/item/list` (paginated, supports `storeId`/`externalStoreId`) -- each item
  includes `updateTime`. This is the primary polling target: track last-seen `updateTime`
  per barcode and diff on each poll cycle to detect changes made directly in the Zkong
  console, then push those deltas to Clover.
- `POST /zk/item/getItemByBarCodeAndExternalStoreId` -- single-item lookup, useful for
  targeted verification/spot checks.

### Reconciliation / audit
- `POST /zk/integratedLog/integratedLogPage` -- filterable by `startTime`, `endTime`,
  `status` (1 all success / 2 partial / 3 all failed), `requestId`. Use this to confirm our
  own `batchImportItem` calls actually succeeded (catches silent partial failures via
  `importTotal` / `successTotal` / `errTotal`), independent of the immediate HTTP response.

### Tag hardware status (secondary, not required for price sync)
- `POST /zk/erp/esl/list` or `POST /zk/erp/esl/adminBusinessInfoList` -- returns `state`
  (online/offline), `battery`, `bindState`, `lastCommunicationTime` per tag. Useful for an
  operational health view (e.g. "this tag hasn't checked in, price update may not have
  rendered"), but not part of the core sync loop.

### Promotional / time-based / discounted pricing -- Activity Strategy API (section 8)

Zkong has a dedicated, server-side-scheduled promotion engine. This is a separate concern
from the base `batchImportItem` price sync and should **not** be reimplemented in our
middleware (no cron/scheduling logic needed on our side for promo timing) -- Zkong executes
the schedule natively.

- `POST /zk/strategy/create` -- create a promotion strategy
- `POST /zk/strategy/edit` -- edit an existing strategy (8.2, same field set as create)
- `POST /zk/strategy/list/{page}/{size}?isValid=true|false` -- paginated list, filterable by
  active vs. expired
- `GET /zk/strategy/get/{id}` -- full strategy detail
- `DELETE /zk/strategy/delete/{id}`
- `PUT /zk/strategy/enable/{id}` / `PUT /zk/strategy/disable/{id}`

**Scheduling model** (set at creation, drives Zkong's internal cron):
- `startDate` / `endDate` -- epoch ms, overall campaign validity window
- `triggerType`: `1` = fixed cycle, `2` = continuous triggering
- `periodType`: `0` = daily, `1` = weekly, `2` = monthly
- `periodValue`: which days apply (e.g. `[2,6,1]` for weekly = Mon/Fri/Sun); empty array if
  `periodType=0`
- `periodTimes`: `["HH:mm:ss", "HH:mm:ss"]` daily start/end clock time -- enables
  "happy hour" style recurring discounts, not just a flat date range
- The response (`8.3`/`8.4`) exposes the derived `triggerCronExp` / `restoreCronExp` and
  `applyJobId` / `restoreJobId` -- confirming Zkong applies and restores pricing on its own
  schedule; our middleware does not need to poll to trigger price changes.

**Per-item promo fields** (`itemActions[].fieldValues`, keyed by Zkong `itemId`):
`price`, `memberPrice`, `originalPrice`, `promotionText`, `unit`, `classLevel`,
`productArea`, and `custFeature1` through `custFeature15` (a subset of the 50 extension
fields available on the base item record). `selectFieldNameNum` (max 5 values, range 0-19)
controls which of these extra fields actually render on the tag alongside price/member
price during the promo window.

**Answer to "can we add custom fields for promotional/time-based/discounted pricing":**
Yes -- this is a first-class, native Zkong capability, richer than a simple custom field
would be (it includes scheduling, recurring windows, and automatic apply/restore). This
does **not** need to exist as a custom field on the Clover side. Clover keeps the merchant's
real/base price; Zkong's Activity Strategy owns the promotional overlay independently and
restores the original values automatically when the promo window ends (per `restoreJobId`).
Our middleware's job is limited to:
- Mapping which Clover item a strategy targets (Clover `itemId` -> Zkong `itemId`/`barCode`)
- Exposing a way to create/edit/enable/disable/delete strategies (internal API or admin UI,
  TBD) that calls the section 8 endpoints
- Optionally polling `8.3 list` at low frequency for reporting/visibility ("what promos are
  currently active"), not for execution -- execution is entirely server-side on Zkong.

---

## Decision: Reflecting Zkong Promotional Pricing in Clover (Option 2)

The above design keeps Clover and Zkong pricing independent -- Zkong's Activity Strategy
overlays the tag display only, Clover's `price` stays untouched. That was ruled out for this
project: **the explicit goal of this POC is for Zkong-side promotional/time-based pricing to
be reflected in Clover automatically**, not just on the shelf label.

### Options considered and ruled out

- **Custom fields on Clover items:** not possible. Clover's Item schema has no generic
  key/value metadata bucket (confirmed against the `POST /v3/merchants/{mId}/items` schema).
  The only "extra" slots are `tags`, `code`, `alternateName`, and the variant
  `attributes`/`options` system -- none suitable for a promo price or scheduling data.
- **Clover Discounts API (`/v3/merchants/{mId}/discounts`, order/line-item discount
  endpoints):** checked all 5 CRUD verbs (get all, create, get single, update, delete) plus
  the order-level and line-item-level discount creation endpoints. Confirmed:
  - The discount object has no scheduling fields anywhere (`id`, `discount.id`, `approver.id`,
    `name`, `amount`, `percentage` -- that's the complete schema, identical on every verb).
  - Discounts are **transactional, not standing**. Clover's own data model docs describe
    discounts as "amount or percentage discount... applied to the **order subtotal**" --
    every discount must be explicitly attached to a specific `orderId` (and `lineItemId` for
    line-item scope) at the time that order is built. There is no mechanism to say "apply
    this discount automatically to every future order containing this item." Making this
    behave like an automatic promo would require intercepting every order as it's created
    and attaching the discount in real time -- a much larger integration than a price sync,
    and it still would not "reflect" as a changed price the way a shelf tag does.
  - Conclusion: ruled out. Doesn't solve the automatic/standing requirement, and still lacks
    scheduling even if it did.
- **Mutate Clover's `price` field directly, on our own schedule (Option 2): SELECTED.**
  `price` is a plain field on the Item object; writing to it takes effect immediately for
  any order pulled from inventory afterward, with no per-order association step and no
  ambiguity about auto-apply. The tradeoff (previously flagged, now accepted): our
  middleware becomes the scheduler, since Zkong's Activity Strategy cron only affects the
  tag, not Clover. We must poll Zkong's `strategy/list` (8.3) to detect when a strategy's
  window opens/closes and write to Clover's `price` at the right moments.

  > ✅ **IMPLEMENTED (2026-10-07).** The poller now does exactly this — but reads the
  > discount from `custFeature1`/`custFeature2` (Was / Discount %) instead of `strategy/list`,
  > because empirical testing showed the dashboard's Was/Discount fields are extended fields,
  > not strategy-driven. See "Discount detection — key finding" above.

### Follow-on problems this decision creates, and how we resolve them

Selecting Option 2 immediately raises three problems that don't have solutions on the
Clover side, since Clover only ever exposes a single mutable `price` field. All three are
resolved at the **middleware's data layer**, not by anything Clover or Zkong provide
natively.

#### 1. Where does the standard (non-promotional) price live once we've overwritten it?

Clover's `price` field holds one value. The moment we write a promo price into it, the
merchant's real/standard price is gone from Clover's own storage -- there is nothing in
Clover to "read back" once overwritten. **The standard price must be stored and owned by
our middleware, not derived from Clover after the fact.**

Resolution: the `item_map` table (previously just a Clover-itemId <-> Zkong-barcode
mapping) becomes the source of truth for pricing state:

```
item_map
├── id
├── store_id            -- FK -> stores (see problem 3)
├── clover_item_id
├── zkong_barcode
├── standard_price       -- merchant's real price. Owned by us. Never derived from
│                           Clover's current `price` field once a promo is active.
├── last_pushed_price    -- the exact price we last wrote to Clover. Used for echo
│                           detection (see problem 2).
├── active_promo_id      -- nullable. Zkong strategy id currently in effect, if any.
├── active_promo_price   -- nullable. The promo price, mirrored from Zkong for our own
│                           bookkeeping/reporting.
├── promo_active         -- boolean
└── updated_at
```

Lifecycle, matching the four bullets from the original question:

1. **Item created in Clover with standard price X.** Webhook fires -> we set
   `standard_price = X`, `last_pushed_price = X`, push to Zkong via `batchImportItem`.
2. **User activates/creates a promo in Zkong.** Detected on our poll of `strategy/list`
   (8.3). We do **not** touch `standard_price`. We set `active_promo_id`,
   `active_promo_price`, `promo_active = true`, then write `active_promo_price` into
   Clover's `price` field and update `last_pushed_price` to match.
3. **User resets/ends the promo in Zkong** (strategy disabled, deleted, or its `endDate`
   passes -- detected on the same poll). We write `standard_price` back into Clover's
   `price` field, clear `active_promo_id` / `active_promo_price`, set
   `promo_active = false`, and update `last_pushed_price = standard_price`.

   This directly answers the original question: **the standard price was never actually
   lost, because it was never solely stored in Clover in the first place once a promo
   exists.** Our DB is the durable copy; Clover's `price` field is treated as a "currently
   displayed value" that we manage, not as the standard price's storage location.

#### 2. Webhook echo loop

Writing to Clover's `price` field (steps 2 and 3 above) causes Clover to fire an
`item.update` webhook back to us, indistinguishable at first glance from a genuine
merchant-initiated price edit. Left unhandled, our middleware would interpret its own
write as "the merchant changed the standard price" and overwrite `standard_price` with
whatever promo price we just pushed -- corrupting the one durable copy we need to restore
later.

Resolution: on every incoming Clover `item.update` webhook, compare the webhook's `price`
against `item_map.last_pushed_price` for that item.
- **Match -> echo of our own write.** Ignore; do not touch `standard_price`.
- **Mismatch -> genuine external edit** (merchant changed it directly in Clover, or via
  some other integration). Treat as a new `standard_price`.
  - If no promo is currently active (`promo_active = false`), push it to Zkong immediately
    as usual.
  - If a promo **is** currently active (`promo_active = true`), do **not** let it
    overwrite the live promo price on the tag. Store it as a pending `standard_price`
    update to be applied once the promo ends, and log it as a conflict (merchant edited the
    base price while a promo was live) for visibility rather than silently discarding it or
    silently fighting with the active Zkong strategy.

#### 3. Store-specific pricing

Zkong models multiple stores natively (`storeId`/`externalStoreId` scoping throughout the
API; Activity Strategies are created per-store, so the same barcode can have different
promo states in different stores out of the box). Clover's REST API is scoped per merchant
account (`mId`), and a Clover merchant account generally represents one physical location --
Clover has no "store" sub-entity inside a single merchant's inventory.

**Decision for this POC (confirmed with user): single Clover merchant account.** This
removes the need for our middleware to manage multiple Clover OAuth credentials or route
webhooks by `merchantId` -- out of scope for now, revisit if the project grows into a real
multi-location deployment.

This still leaves a structural mismatch worth being explicit about: if the *same* Clover
item is bound to *multiple* Zkong stores, and those stores have different promo states at
the same time (e.g. Store A has an active promo, Store B does not), Clover's single `price`
field cannot represent both simultaneously -- there is no code-level fix for this, it's a
one-to-many-collapsing-to-one-to-one problem.

**POC scope restriction:** each synced item is expected to be bound in exactly one Zkong
store. Multi-store-per-item is explicitly out of scope for this POC. If it's later needed,
options to revisit at that point (not decided now, since unvalidated against real business
need):
- Define an explicit precedence rule (e.g. one store is "primary" for Clover-reflection
  purposes, others are display-only on their own tags).
- Detect multi-store bindings and skip Clover price sync for those items (log a conflict)
  rather than guessing which store's state should win.

Schema still carries a `store_id` dimension (mapping to a Zkong `storeId`/`externalStoreId`)
even though only one Clover merchant exists, so `standard_price` / `promo_active` state is
tracked per `(store_id, clover_item_id)` pair, not globally per barcode -- this keeps the
POC's scope restriction explicit and enforceable (we can detect and reject/warn on
multi-store bindings) rather than implicit:

```
stores
├── id
├── zkong_store_id       -- or externalStoreId
├── clover_merchant_id   -- single value for this POC, still modeled as a column
└── name
```

### Scheduling implication

Since Zkong's own cron (`triggerCronExp`/`restoreCronExp`) only drives the tag, our
middleware must independently track each strategy's effective window and poll frequently
enough that Clover's `price` field flips close to when the tag does. This is a real
duplication of Zkong's scheduling logic, accepted as a tradeoff of this decision:
- Poll `POST /zk/strategy/list/{page}/{size}?isValid=true` on an interval (needs to be
  tighter than the general `updateTime` catalog poll, since promo start/end times are
  precise to the second in `periodTimes`, and we're detecting them after the fact rather
  than being triggered by them).
- On each poll, diff each mapped item's `promo_active` state against what the strategy list
  says should currently be true (given `startDate`/`endDate` and, for recurring strategies,
  whether "now" falls inside today's `periodTimes` window) and push the appropriate price
  (`active_promo_price` or `standard_price`) to Clover when the state flips.
- Accept that there will be a polling-interval-sized lag between the tag's price change and
  Clover's -- state this explicitly as a known limitation of the POC rather than promising
  perfect simultaneity.

---

## Open Question: Which Zkong Mechanism Actually Drives Promo Pricing?

> ✅ **RESOLVED (2026-10-07).** Empirical testing against the live Zkong sandbox showed that
> none of the three documented mechanisms (`repricingList`, `proStartTime`/`proEndTime`,
> Activity Strategy) is what the dashboard's **Was** / **Discount %** fields write to. Those
> dashboard fields map to **extended (custFeature) fields** — `custFeature1`/`custFeature2`/
> `custFeature3` — which do not modify `price`. The poller reads these directly. See
> "Discount detection — key finding" under Revised Architecture above. The three-mechanism
> investigation below is retained for historical context.

Before writing any scheduling/polling code against the Activity Strategy API (section 8),
a full pass through every file in `knowledge_base/` (docx, both API PDFs, the Postman
collection, the OCR'd Postman-example PDF, the deployment-requirements PDF, and
`Field size.xlsx`) turned up **three separate, overlapping promo-adjacent mechanisms** in
Zkong's API, with no documentation anywhere explaining their relationship:

1. **Activity Strategy (section 8)** -- `/zk/strategy/create` etc. Own object, own lifecycle
   (enable/disable/delete), own Zkong-side cron (`triggerCronExp`/`restoreCronExp`,
   `applyJobId`/`restoreJobId`). Strong evidence this is tag-render-side only.
2. **`repricingList`** -- embedded directly in the `batchImportItem`/`batchStoreImportItem`
   item payload (section 3.1/3.9). Up to 30 entries per item, each with `repricingType`
   (1/2/3 -> Price1/Price2/Price3), `repricingDateStart/End`, `repricingTimeStart/End`, and
   either `price` or `discount`. Submitted through the *same* endpoint we already use for
   regular catalog sync.
3. **`proStartTime`/`proEndTime`** -- a single start/end timestamp pair directly on the base
   item record (not a list), alongside `promotionText`.

**Confirmed by exhaustive review (per explicit instruction to not conclude before checking
every file):**
- `Zkong_API_4.2.pdf` (older/parallel version of the 4.3 docx) contains identical content
  for all three mechanisms and the Activity Strategy section -- no additional explanatory
  text not already in the 4.3 docx.
- `strategy API manual.pdf` only documents the barcode -> itemId -> strategy workflow
  (get itemId via 3.6, get strategy id via 8.3) -- doesn't address the relationship to
  `repricingList`/`proStartTime`.
- `API examples.pdf` (a "Print to PDF" export with no extractable text layer -- rendered as
  images and OCR'd via `tesseract` after installing `poppler-utils` and `tesseract-ocr`) is
  just live Postman request/response captures matching the docx and Postman JSON. No new
  mechanism, no example populating `repricingList` or clarifying read-back behavior.
- `ZKONG ESL Server Deployment Requirements_v2.0.pdf` is pure infrastructure/hardware sizing
  guidance (server specs, refresh-time estimates, DB config) -- confirmed via full-text
  extraction, zero mentions of `repricing`/`proStartTime`/`strategy`.
- `Field size.xlsx` (parsed via raw OOXML shared-strings extraction) is just an import
  field-name/data-type/length-limit reference table for validation -- adds nothing about
  promo semantics.
- `API-Integration-overview.docx` (the vendor's own condensed guide) does not mention
  `repricingList`, `proStartTime`/`proEndTime`, or Activity Strategy at all -- it only
  documents the plain `batchImportItem` flow for basic catalog/price sync.

**Unresolved (not answered anywhere in the available documentation):**
- Whether `repricingList` and `proStartTime`/`proEndTime` are the same underlying mechanism
  read back two different ways, or genuinely independent fields.
- Whether activating any of the three mechanisms changes what `POST /zk/erp/item/list`
  returns for `price` in real time, or whether that endpoint always reflects a static price
  regardless of an active promo (with the promo being purely a tag-rendering-time overlay).
- Whether `repricingList`/`proStartTime` are Zkong-scheduler-driven the same way Activity
  Strategy is (auto apply/restore), or just descriptive metadata with no automatic effect.
- Whether the three mechanisms can coexist on the same item without conflict.

**Decision: do not build the Option 2 scheduler against Activity Strategy (or any of the
three mechanisms) until this is resolved empirically against a live Zkong sandbox.** The
plan is: once Zkong sandbox credentials are available, create a test promo via each
mechanism in turn and poll `/zk/erp/item/list` for that barcode during the active window to
see which one (if any) actually changes the polled `price`. This determines which mechanism
our Option 2 poller should watch -- building against the wrong one would mean redoing both
the poller and the `item_map` scheduling logic.

---

## Revised Architecture

```
Clover POS                          Middleware (Node.js/TS)                  Zkong ESL Cloud
┌───────────┐   webhook (push)      ┌──────────────────────┐   REST (push)   ┌───────────┐
│           │ ─────────────────────>│                      │ ───────────────>│           │
│           │  item/inventory events│   Sync Engine         │ batchImportItem │           │
│           │                       │                      │  (unitName: 1)  │           │
│           │   REST (push)         │                      │  poll (interval)│           │
│           │ <─────────────────────│                      │ ───────────────>│           │
│           │  apply Zkong-side     │                      │  /zk/erp/item/  │           │
│           │  price + discount     │                      │  list?page=&size│           │
│           │                       │                      │  (query params) │           │
└───────────┘                       │                      │                 └───────────┘
                                      │  strategy poll       │ ───────────────>
                                      │  (visibility only)    │  /zk/strategy/  │
                                      │                      │  list (1/min)   │
                                      └──────────────────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  Postgres (state):│
                                      │  - item_map      │
                                      │    (barcode map,  │
                                      │     last_pushed,  │
                                      │     promo_active) │
                                      │  - sync_log      │
                                      │  - stores        │
                                      └──────────────────┘
```

### Sync flows (as implemented)

| Flow | Direction | Trigger | Mechanism |
|------|-----------|---------|-----------|
| Price/catalog update | Clover → Zkong | Clover webhook (`item.create`/`item.update`) | `POST /zk/item/batchImportItem` (`unitName: 1`, raw cents) |
| Item delete | Clover → Zkong | Clover webhook (`item.delete`) | `POST /zk/item/batchDeleteItem` |
| Price update | Zkong → Clover | Poller (`ZKONG_POLL_INTERVAL_MS`, default 1000ms) | `POST /zk/erp/item/list?page=&size=` → diff → `POST /v3/merchants/{mId}/items/{id}` |
| Discount apply/restore | Zkong → Clover | Same poll — reads `custFeature1` (Was) + `custFeature2` (Discount %) | sale = `(Was || base) × (1 − d%)` (or `custFeature3` Discount Number) → pushed to Clover |
| Promo strategy visibility | Zkong → logs | Poller (1×/min, needs `ZKONG_STORE_ID`) | `POST /zk/strategy/list/1/50?isValid=true` — **blocked by account permission (10030)** |

### Discount detection — key finding

Zkong does **not** drive discounts through `price`/`originalPrice`. The dashboard's
**Was** / **Discount %** / **Discount Number** fields are **extended (custFeature) fields**:

| Dashboard field | API field | Meaning |
|-----------------|-----------|---------|
| Was | `custFeature1` | Original price the discount is computed from |
| Discount % | `custFeature2` | Percentage off |
| Discount Number | `custFeature3` | Absolute sale price (used directly if set) |
| Promotion Start / End | `custFeature4` / `custFeature5` | Promo window (not currently enforced) |

The poller computes the sale price and pushes it to both Clover and Zkong main `price` (售价)
fields. When the discount is cleared, both sides are restored to the original base price.

### Price units

**Both Clover and Zkong use cents (integers).** `batchImportItem` is called with
`unitName: 1` (raw value — Zkong does not divide by 100). Earlier `unitName: 0` bug
caused `870000` to be stored as `8700`.

---

## Implementation Status

The sections below reflect what has actually been built and verified so far, distinct from
the target project structure/dependencies (still planned, not yet all implemented) further
down.

### What's implemented and verified

- **Middleware skeleton** (`src/`): Express server with `GET /health` and
  `POST /webhooks/clover`. Boots via `npm run build && npm start` (or `npm run dev`).
  Verified: `npm run typecheck` and `npm run build` pass; manual smoke test of both routes
  confirmed correct responses (see webhook verification testing below).
- **Clover webhook verification** (`src/webhooks/handlers/clover.ts`,
  `src/config/env.ts`): implemented per Clover's actual documented mechanism (confirmed by
  extracting the rendered doc page's embedded JSON, since `docs.clover.com/docs/webhooks`
  truncates the relevant section on normal fetch) -- Clover uses a **static shared value**,
  not a per-request HMAC signature:
  - One-time callback URL verification: Clover POSTs a `verificationCode` in the body when
    the webhook URL is first configured in the Dashboard. Handler detects this
    (`typeof body.verificationCode === "string"`), logs it, returns 200 without requiring
    auth (Clover doesn't send the auth header on this first request).
  - Every subsequent real webhook carries a static `X-Clover-Auth` header, whose expected
    value is the "Clover Auth Code" shown under Your Apps > App Settings > Webhooks in the
    Dashboard. Verified via `crypto.timingSafeEqual` (constant-time comparison) against
    `CLOVER_AUTH_CODE` from env. Fails closed: if `CLOVER_AUTH_CODE` is unset, every request
    is rejected rather than silently accepted.
  - Tested manually (no auth header -> 401; wrong header -> 401; correct header -> 200;
    `verificationCode` payload -> 200 without auth check). All four cases passed.
  - Explicitly NOT yet implemented: parsing Clover's actual webhook envelope
    (`merchants[mId].{items,inventory,...}`) into sync actions -- current handler only logs
    and acks. That's the next piece of sync-engine work, not a security gap.
    **Update: this is now implemented** (see "Sync engine" below).
- **Docker Compose + Cloudflare Tunnel** (`docker-compose.yml`, `cloudflared/`): two
  services, `middleware` and `cloudflared`, on a shared bridge network (`poc-net`) so
  `cloudflared` can reach the middleware container by service name
  (`http://middleware:3000`) without relying on `localhost`.
  - **Key correction made during setup:** the official `cloudflare/cloudflared` Docker Hub
    image is distroless (confirmed from its own Dockerfile -- final stage is
    `gcr.io/distroless/base-debian13:nonroot`, only the compiled binary is copied in). It has
    no shell at all, so `docker exec -it` into it does not work. Built a custom image on
    `alpine:3.20` instead (`cloudflared/Dockerfile`) that downloads the `cloudflared` binary
    and provides a real shell for interactive setup.
  - **Second correction:** traffic forwarding was never actually dependent on having a shell
    open -- `cloudflared tunnel run` running as the container's main process (PID 1) is what
    holds the connection to Cloudflare's edge and proxies to the middleware; the shell is
    only needed once, up front, for the interactive `tunnel login`/`create`/`route dns`
    handshake. The first version of the container just idled forever
    (`tail -f /dev/null`) and never transitioned into forwarding traffic. Fixed with
    `cloudflared/entrypoint.sh`: checks for `/root/.cloudflared/config.yml` on startup --
    absent -> idle (shell-in mode); present -> `exec cloudflared tunnel run` as PID 1
    (active forwarding mode). `docker compose restart cloudflared` is the switch between the
    two modes after you've written the config.
  - `cloudflared/config.example.yml` documents the config file to write once the tunnel is
    created (`tunnel` id, `credentials-file` path, `ingress` rule pointing at
    `http://middleware:3000`, catch-all `http_status:404`).
  - Tunnel credentials/config persist across container restarts via the `cloudflared-data`
    named volume, mounted at `/root/.cloudflared`.
  - **Not yet done:** actually running `docker compose up` against a real Cloudflare account
    (no `docker` binary available in this working environment to verify the compose file
    executes -- verification so far is limited to `docker compose config`-equivalent manual
    review, Dockerfile logic review, and `sh -n` syntax-checking `entrypoint.sh`. The Node
    build/typecheck/runtime smoke tests were run directly via a locally-installed Node, not
    through Docker.)
    **Update: the stack is now running** — middleware, Postgres (`db`), and cloudflared are up
    via `docker compose up -d --build`, and the user is testing the live sync flow.

### Environment setup used for local verification (this sandbox)

Docker was not available in this working environment. To verify the Node code directly,
these were installed via `apk` (Alpine): `nodejs`, `npm`, plus `libarchive-tools` (RAR
extraction), `7zip`, `poppler-utils` (`pdftotext`/`pdftoppm`), and `tesseract-ocr` +
`tesseract-ocr-data-eng` (OCR for the screenshot-based `API examples.pdf`). These were for
documentation investigation and local code verification only -- they are not part of the
project's runtime and are not referenced by the Dockerfiles.

### Sync engine (implemented and running)

- **Clover → Zkong** (`src/webhooks/handlers/clover.ts`): parses the `merchants[mId]` envelope,
  fetches the full item via `GET /v3/merchants/{mId}/items/{id}`, maps it to a Zkong item, and
  upserts via `POST /zk/item/batchImportItem`. Deletes route to `batchDeleteItem`.
  - **Barcode preservation:** if an item is already mapped in `item_map`, the existing
    `zkong_barcode` is reused so re-syncing never creates a duplicate Zkong product.
  - **Echo suppression:** if the Clover price equals `last_pushed_price`, the webhook is
    ignored (prevents poll ↔ webhook loops).
  - **Promo suppression:** while `promo_active` is true, Clover price changes are **not**
    pushed to Zkong (Zkong owns the sale price). The new base is recorded and restored when
    the discount ends.
- **Zkong → Clover poller** (`src/polling/zkong-poll.ts`): pages `POST /zk/erp/item/list`
  (`page`/`size` as query params), diffs against `item_map`, and pushes changes to Clover
  via `POST /v3/merchants/{mId}/items/{id}`.
  - **Discount logic:** reads `custFeature1` (Was) + `custFeature2` (Discount %) and computes
    sale = `Was × (1 − d%)` (or `custFeature3` Discount Number directly). Pushes sale price
    to Clover while active; restores base price when cleared.
  - **Strategy visibility:** `POST /zk/strategy/list` (1×/min) logs active promo windows.
    Requires `ZKONG_STORE_ID` and an account with strategy-menu permission (currently blocked
    by error `10030`).
- **Postgres persistence** (`src/db/`): `item_map` (barcode map, `standard_price`,
  `last_pushed_price`, `promo_active`), `sync_log` (audit trail), `stores`. Schema
  auto-created on startup; `promo_active` added via one-time `ALTER TABLE` migration.
- **Auth** (`src/services/zkong/`): RSA login flow with token caching and 401 → re-login →
  retry-once.

---

## Project Structure

Reflects the actual repo layout as implemented.

```
cloverPosDemo/
├── src/
│   ├── config/
│   │   └── env.ts               # Clover/Zkong config + CLOVER_AUTH_CODE
│   ├── services/
│   │   ├── clover/
│   │   │   └── client.ts          # getCloverItem, updateCloverItem
│   │   └── zkong/
│   │       ├── client.ts        # axios client + 401 retry-once wrapper
│   │       ├── auth.ts          # getErpPublicKey -> RSA encrypt -> login -> token cache
│   │       └── items.ts         # batchImportItem, batchDeleteItem, mapCloverToZkongItem
│   ├── webhooks/
│   │   ├── server.ts            # Express app: GET /health, POST /webhooks/clover
│   │   └── handlers/
│   │       └── clover.ts        # verificationCode + X-Clover-Auth + sync to Zkong
│   ├── polling/
│   │   └── zkong-poll.ts        # Zkong → Clover poller + discount logic
│   ├── db/
│   │   ├── connection.ts        # Postgres pool + initDb
│   │   └── models/
│   │       ├── item-map.ts      # Clover itemId ↔ Zkong barCode + promo state
│   │       ├── store.ts         # ensureDefaultStore
│   │       └── sync-log.ts      # audit trail
│   └── index.ts                 # entrypoint: starts Express + Zkong poller
├── cloudflared/
│   ├── Dockerfile               # alpine + cloudflared binary (has a shell, unlike official image)
│   ├── entrypoint.sh            # idle-until-configured / run-tunnel switch
│   └── config.example.yml       # template for /root/.cloudflared/config.yml
├── .env.example
├── .gitignore
├── docker-compose.yml            # middleware + db + cloudflared services on shared network
├── Dockerfile                    # middleware container (node:20-alpine)
├── tsconfig.json
├── package.json
└── docs/
    ├── USER_GUIDE.md             # setup, discount flow, migration (this branch)
    └── architecture.md           # this file
```

### Environment variables

Reflects `.env.example` as actually written (see file for authoritative source).

```env
# Clover
CLOVER_API_BASE=https://sandbox.dev.clover.com/v3/merchants
CLOVER_MERCHANT_ID=
CLOVER_CLIENT_ID=

# Zkong
ZKONG_API_BASE=https://esl-eu.zkong.com
ZKONG_ACCOUNT=
ZKONG_PASSWORD=
ZKONG_MERCHANT_ID=
ZKONG_AGENCY_ID=

# App
PORT=3000
# The "Clover Auth Code" from Your Apps > App Settings > Webhooks in the
# Clover Developer Dashboard. Required for webhook requests to be accepted.
CLOVER_AUTH_CODE=
ZKONG_API_BASE=https://esl-eu.zkong.com
ZKONG_ACCOUNT=
ZKONG_PASSWORD=
ZKONG_MERCHANT_ID=
ZKONG_AGENCY_ID=
ZKONG_STORE_ID=
ZKONG_POLL_INTERVAL_MS=1000
```

### Dependencies

**Installed** (`package.json`): `express` (5.1.0), `dotenv` (17.2.3), `axios` (HTTP client for
Clover/Zkong REST calls), `pg` (Postgres client), `typescript`, `ts-node-dev`, `@types/express`,
`@types/node`, `@types/pg`.

**Not used:** `better-sqlite3` (replaced by Postgres), `node-cron` (replaced by `setInterval`),
`winston` (replaced by `console`), `zod` (replaced by manual validation). Node's built-in
`crypto` module is used for both the Zkong RSA login flow and the Clover webhook auth
comparison (`crypto.timingSafeEqual`).

---

## Discussion Log (chronological summary)

1. **Initial ask:** plan a middleware between Clover POS and Zkong ESL cloud.
   Clarified requirements: full bidirectional sync (price/inventory/catalog),
   Node.js/TypeScript, both polling and webhooks, local/Docker deployment.
2. **First draft architecture** assumed symmetric webhook + polling on both sides,
   based on Clover's public docs (which do support webhooks) and Zkong's marketing
   page claim of "200+ API interfaces" (no detail on webhook support at that point).
3. **User pushback:** "Why are we polling Zkong? Doesn't Zkong have a webhook to call
   when a tag is updated?" -- correct challenge; the original plan's Zkong-side webhook
   assumption was speculative, not verified against real docs.
4. **User provided the Zkong login/config URL** (`esl-eu.zkong.com/template/merchantTemplate`)
   asking where to attach a webhook URL. Investigation showed this is a client-rendered
   SPA with no public API docs discoverable by URL guessing.
5. **User supplied `knowledge_base/` folder** with Zkong PDFs and `.rar` archives.
   Extracted both archives (`Customer API integration.rar`, `EPD_Template.rar`) using
   `bsdtar` (installed via `apk add libarchive-tools`, since the busybox/7zip default
   image lacked RAR support). Confirmed contents:
   - `Zkong API 4.3.docx` -- full API reference (auth, product sync, ESL binding,
     templates, stores, callbacks, LCD, activity strategies, error codes)
   - `API-Integration-overview.docx` -- vendor's own condensed integration guide
   - `Zkong API EU server examples Postman v6+.json` -- Postman collection with live
     example requests against `esl-eu.zkong.com`
   - `Field size.xlsx`, `API examples.pdf`, `API introduction video.mkv` (not yet reviewed)
   - `EPD_Template/` -- label template image mockups, not API-relevant
6. **Read the docx (via unzip + XML text extraction, since no `pandoc`/`python3` was
   available in this environment)** and found section 4.23 "Set Merchant Response
   Callback URL for Picking ESLs" -- a real callback mechanism, but scoped to picking
   light hardware (LED off / button press), not standard price tag sync.
7. **User asked to keep reading until reaching a solid conclusion.** Continued through:
   - 3.10 Integrated Log Query (`/zk/integratedLog/integratedLogPage`) -- poll-only,
     good for reconciliation.
   - 3.11 / 3.6-3.9 product query endpoints -- confirmed `updateTime` field exists on
     item records, enabling delta-polling.
   - 4.26 Query ESL Status and Related Business Information
     (`/zk/erp/esl/adminBusinessInfoList`) -- poll-only tag hardware status.
   - 4.30 PTL Button Information Push -- second PTL-only callback, configured out of
     band, not via any registration API.
   - `API-Integration-overview.docx` -- vendor's own recommended flow, entirely
     request/response, confirming no webhook exists for standard product/price sync.
8. **Conclusion reached:** Zkong has no webhook for standard catalog/price sync. All
   Zkong -> middleware detection must be polling-based (`/zk/erp/item/list` diffed by
   `updateTime`). Clover -> Zkong sync remains webhook-triggered and synchronous
   (`batchImportItem`).
9. **User asked whether Clover custom fields could hold Zkong promotional/discounted/
   time-based pricing.** Checked Clover's Item schema (no generic custom-fields bucket) and
   Clover's Discounts API (all 5 CRUD verbs). Found Zkong's own native Activity Strategy
   system (section 8: create/edit/list/get/delete/enable/disable, server-side cron-driven
   apply/restore) as the mechanism for promotional pricing on the Zkong side.
10. **User stated the architecture as understood:** updating promo pricing in Zkong should
    reflect in Clover's custom fields. Corrected: Clover has no custom-fields concept, and
    the original design kept Zkong's Activity Strategy tag-side-only, deliberately not
    touching Clover. Presented three options for actually reflecting Zkong promos in Clover:
    (1) leave Clover untouched (shelf-display-only), (2) mutate Clover's `price` field
    directly on our own schedule, (3) use Clover's Discounts API on our own schedule.
11. **User ruled out option 1** (explicit POC goal is to avoid shelf-display-only) and asked
    to check option 3's feasibility first. Checked all 5 Discounts CRUD endpoints plus
    order-level and line-item-level discount creation: no scheduling fields anywhere, and
    discounts are transactional (must be explicitly attached to a specific `orderId`/
    `lineItemId` at order-build time) rather than a standing/automatic property of an item.
    Checked Clover's Orders/Register docs (`working-with-orders`, `creating-custom-orders`)
    to confirm discounts don't auto-apply without being explicitly attached per order --
    confirmed. Option 3 ruled out; option 2 (mutate `price` directly, on our own schedule)
    selected, documented above under "Decision: Reflecting Zkong Promotional Pricing in
    Clover (Option 2)".
12. **User asked three follow-up questions about Option 2:** where does the standard price
    live once overwritten, and how does store-specific pricing work. Resolved via the
    `item_map`/`stores` data model above (standard_price/last_pushed_price/active_promo_*
    fields, webhook-echo detection via last_pushed_price comparison, single-Clover-merchant
    POC scope with multi-Zkong-store-per-item explicitly out of scope).
13. **User asked to discuss the scheduling tradeoff further before implementing.** This
    surfaced that "poll strategy/list and replicate its cron" was itself an unverified
    assumption -- investigation found `repricingList` and `proStartTime`/`proEndTime` as two
    additional, undocumented-relationship promo mechanisms beyond Activity Strategy (see
    "Open Question: Which Zkong Mechanism Actually Drives Promo Pricing?" above).
14. **User explicitly instructed: do not conclude before going through every item in
    `knowledge_base/`.** Installed `poppler-utils` and `tesseract-ocr` to read the two
    previously-unreviewed PDFs and the xlsx; confirmed via full-text extraction that none of
    them resolve the three-mechanism ambiguity (see above). Decision: resolve empirically
    against a live Zkong sandbox before writing scheduler code, rather than guess.
15. **User asked to set up Cloudflare Tunnel + Docker Compose so Clover webhooks could reach
    the local middleware, with shell access to configure the tunnel.** Built the middleware
    skeleton (Express, `/health` + `/webhooks/clover` stub), a `Dockerfile` for it, and a
    custom `cloudflared` image on Alpine (since the official image is distroless/shell-less).
    Verified the Node code directly (typecheck, build, runtime smoke test of both routes) by
    installing Node via `apk` in this sandbox, since no `docker` binary was available here to
    verify the compose file end-to-end.
16. **User asked how traffic forwarding would work without a shell in the cloudflared
    container**, correctly catching that the first version's container only idled
    (`tail -f /dev/null`) and never started forwarding. Fixed with `entrypoint.sh`: idle
    until `config.yml` exists, then `exec cloudflared tunnel run` as PID 1. Clarified that
    the shell was only ever needed for one-time interactive setup, not for ongoing
    forwarding.
17. **User asked to implement Clover webhook signature verification.** Investigated
    `docs.clover.com/docs/webhooks`, which truncates the relevant section on normal
    markdown/text fetch; recovered the actual content from the page's embedded JSON in the
    raw HTML fetch. Found Clover's real mechanism is a static shared value (`X-Clover-Auth`
    header, compared against the "Clover Auth Code" from App Settings), not a per-request
    HMAC signature -- plus a one-time `verificationCode` handshake for initial setup.
    Implemented both in `src/webhooks/handlers/clover.ts` using `crypto.timingSafeEqual`,
    fail-closed if `CLOVER_AUTH_CODE` is unset. Verified with four manual test cases (missing
    header, wrong header, correct header, verificationCode handshake) -- all passed.
18. **User switched to the `alternate` branch** (Clover↔Zkong communication only, no UI) and
    asked to implement the discount-aware sync. Clarified requirements: (a) poll Zkong for
    active promo details, (b) detect discounts by reading Zkong fields, (c) push sale price
    to Clover during the promo window and restore base when it ends, (d) suppress the Clover
    webhook from overwriting Zkong's sale price while a discount is active, (e) do not store
    the "Was" price (ESL display only), (f) both sides use cents.
19. **Implemented the Zkong → Clover poller** (`src/polling/zkong-poll.ts`): pages
    `/zk/erp/item/list`, diffs against `item_map`, pushes price changes to Clover. Added
    `promo_active` to `item_map`, echo suppression via `last_pushed_price`, and a
    `ZKONG_STORE_ID`-gated strategy-list visibility poll.
20. **Fixed `zkongPriceToCents`** — removed a `num < 100 ? num*100 : num` heuristic that
    corrupted sub-$1 prices.
21. **Fixed `erp/item/list` request** — `page`/`size` must be query params (not body), and
    `merchantId`/`agencyId` are not valid params (caused `11111 操作失败`). Pagination now
    derives total pages from `totalElements`.
22. **Fixed price-unit bug** — `batchImportItem` was sending `unitName: 0` (Zkong divides by
    100), so Clover `870000` became Zkong `8700`. Changed to `unitName: 1` (raw cents).
    Clover and Zkong both store cents.
23. **Fixed duplicate Zkong items** — the webhook handler now preserves the existing
    `zkong_barcode` for mapped items, so re-syncing never creates a duplicate.
24. **Discovered Zkong discounts are extended fields, not price fields.** Empirical testing
    (debug dump of `custFeature1`–`custFeature50`) showed the dashboard's **Was** = `custFeature1`,
    **Discount %** = `custFeature2`, **Discount Number** = `custFeature3`. These do not modify
    `price`/`originalPrice`. The poller was updated to compute sale = `Was × (1 − d%)` and
    push it to Clover. Verified end-to-end: setting Was=1000000 + Discount=15% → Clover $8,500;
    clearing → Clover restored to base $8,300.
25. **Strategy visibility blocked by account permission** — `/zk/strategy/list` returns `10030
    你无权限访问` (no menu/store access). Requires granting the ERP account strategy-menu
    access in the Zkong dashboard. Does not affect price sync.
26. **Documented everything** — updated `docs/USER_GUIDE.md` (sync directions, discount flow,
    price units, migration, limitations), `README.md` (env vars, migration SQL, implementation
    status, project structure), and this architecture doc.

## Open Items / Next Steps
- **Resolve the three-mechanism promo ambiguity** — ✅ **RESOLVED.** Empirical testing
  showed Zkong discounts are stored in **extended (custFeature) fields**, not in
  `price`/`originalPrice`/`repricingList`. The poller reads `custFeature1`/`custFeature2`/
  `custFeature3` and computes the sale price. See "Discount detection — key finding" above.
- **Confirm Zkong token TTL empirically** — token is cached and refreshed on 401; exact TTL
  still undocumented.
- **Design and implement the `item_map` / `stores` schema** — ✅ **DONE** (Postgres, not SQLite).
- **Implement the Zkong auth client** — ✅ **DONE** (RSA login, token cache, 401 retry).
- **Implement Clover webhook envelope parsing** — ✅ **DONE** (see "Sync engine" above).
- **Actually run `docker compose up`** — ✅ **DONE** (stack is running and being tested).
- **Add dependencies** — `axios` added; `pg` used instead of `better-sqlite3`; `node-cron`,
  `winston`, `zod` not needed (native `setInterval`, `console`, manual validation).
- **Strategy visibility** — blocked by account permission (`10030`). Needs the ERP account to
  be granted strategy-menu access in the Zkong dashboard. Only affects logging, not sync.
- **Discount window enforcement** — Promotion Start/End (`custFeature4`/`custFeature5`) are
  not currently checked; the discount applies whenever `Discount % > 0`.
- **Clover POS price edits override Zkong discounts.** If an item's price is updated directly in Clover POS, the middleware pushes the new price to Zkong selling price (`price`), clears `custFeature1` (Was) and `custFeature2` (Discount %) in Zkong, and resets `promo_active` to `false`.
