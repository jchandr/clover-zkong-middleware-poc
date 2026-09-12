# Clover POS <-> Zkong ESL Cloud Middleware

## Status
Implementation in progress — Clover → Zkong (webhook → `batchImportItem`, cent-based) and Zkong → Clover (polling `erp/item/list` → `PUT /items/{id}`) are live and verified end-to-end (including `DELETE` and the `4200↔42` cent/ dollar round-trip fix). Prices are cent-based both ways (`unitName:1`, `price` as cents string, no implicit `/100`). Doc sources: `Zkong API 4.3.docx`, `API-Integration-overview.docx`, Postman collection in `knowledge_base/`.

## Goal
A Node.js/TypeScript middleware that keeps product catalog, prices, and inventory in sync
between Clover POS and Zkong ESL Cloud, running locally/in Docker with Postgres and Cloudflare Tunnel.

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

### Clover -> Zkong (push) — live, verified
- `POST /zk/item/batchImportItem` — upsert keyed on `barCode`, `unitName:1` (cent passthrough, no implicit `/100`)
  - Up to 20,000 items per request. Required: `barCode`, `attrCategory`, `attrName` (+ `merchantId`/`agencyId`)
  - Price mapping (live): `Clover.price` (cents integer, e.g. `3600` = $36.00) → `Zkong.price` as cents string `"3600"` with `unitName:1`. Display: Zkong Dashboard `Sale price` shows `3600` (cent-based, as you expect: `4400` → $44.00). Earlier `unitName:0` (`/100`) caused the `4200↔42` loop — fixed by switching to `1` and polling as `parseInt(cents)`.
  - `emptyNeedDelete` default `1` → always send full item payloads. `storeId=""` → merchant-level list (POC); real `storeId` when store-scoped.
- `DELETE /zk/item/batchDeleteItem` with `{"list":[barCode]}` (+ optional `storeId`) — fixed from `POST` (was returning `10009` param error); omits `storeId` when empty to delete from all stores.

### Zkong -> Clover (poll, since no webhook exists) — live, verified
- `POST /zk/erp/item/list?page=&size=50` (paginated) — each item has `price` (cents string, e.g. `"4400"`) + `updateTime`. Poller `src/polling/zkong-poll.ts:1` diffs by `barCode` + `last_zkong_update_time`/`last_pushed_price`, handles both `"4400"` and legacy `"42.00"` (integer `→ parseInt`, decimal `→ *100` heuristic), then `PUT /v3/merchants/{mId}/items/{id} {price: cents}` via `CLOVER_API_TOKEN`.
- `POST /zk/item/getItemByBarCodeAndExternalStoreId` — single-item lookup for spot checks.
- Loop fix: poller now treats Zkong's `"42"` as `4200` only when it has a decimal (`"42.00"`); plain `"4400"` stays `4400` — eliminates the `4200→42→42` corruption and the `4400→440000` overshoot.

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
│           │                       │                      │                 │           │
│           │   REST (push)         │                      │  poll (interval)│           │
│           │ <─────────────────────│                      │ ───────────────>│           │
│           │  apply Zkong-side     │                      │  /zk/erp/item/  │           │
│           │  changes              │                      │  list (diff by  │           │
│           │                       │                      │  updateTime)    │           │
└───────────┘                       │                      │                 └───────────┘
                                     │  reconciliation poll  │ ───────────────>
                                     │  (lower frequency)     │  integratedLogPage
                                     └──────────────────────┘
                                              │
                                              ▼
                                      ┌──────────────────┐
                                     │  Postgres (state): │
                                     │  db:5432 clover_zkong │
                                     │  stores, item_map, │
                                     │  sync_log          │
                                     └──────────────────┘
```

### Sync flows

| Flow | Direction | Trigger | Mechanism |
|------|-----------|---------|-----------|
| Price/catalog update | Clover -> Zkong | Clover webhook (`item.update`, `item.create`) | `POST /zk/item/batchImportItem` |
| Item delete | Clover -> Zkong | Clover webhook (`item.delete`) | `POST /zk/item/batchDeleteItem` |
| Inventory update | Clover -> Zkong | Clover webhook (`inventory.update`) | `POST /zk/item/batchImportItem` (stock fields) |
| Price/catalog update | Zkong -> Clover | Polling (interval, e.g. every 5 min) | `POST /zk/erp/item/list`, diff by `updateTime` |
| Write reconciliation | Middleware self-check | Polling (lower frequency, e.g. every 15-30 min) | `POST /zk/integratedLog/integratedLogPage` |
| Tag hardware health (optional) | Middleware self-check | Polling (low frequency) | `POST /zk/erp/esl/list` / `adminBusinessInfoList` |

### Design implications
- **No partial payloads to Zkong.** `emptyNeedDelete=1` → always send full item payloads.
- **Idempotency key:** `barCode = sku || code || cloverItem.id` (mapped in `src/services/zkong/items.ts:mapCloverToZkongItem`) — `barCode` is the upsert key; `productSku` is separate. Keep them distinct to avoid create-vs-update ambiguity.
- **Price is cent-based both ways.** Clover `price` (integer cents) ↔ Zkong `price` (cents string) with `unitName:1` (no implicit `/100`). Poller handles legacy `"42.00"` dollars as `4200` cents, but normal `"4400"` stays `4400`. This fixed both `4200↔42` and `4400→440000` bugs.
- **Echo loop:** `last_pushed_price` comparison in the webhook handler prevents `Clover→Zkong→Clover` ping-pong; `item_map` persists `standard_price`/`last_pushed_price`/`promo_active` for that.
- **Re-auth:** Zkong `Authorization` header with `401 → clear → getErpPublicKey → login → retry-once` (`src/services/zkong/client.ts:1`), token TTL 7 days per 2.2.
- **No tag render confirmation.** Polling `/zk/erp/esl/list` for `lastCommunicationTime`/`state` is still future scope.

---

## Implementation Status

The sections below reflect what has actually been built and verified so far, distinct from
the target project structure/dependencies (still planned, not yet all implemented) further
down.

### What's implemented and verified (live)

- **Middleware skeleton** (`src/`): Express with `GET /health` + `POST /webhooks/clover`. Verified: `typecheck` + `build` pass; live via `clokong.fullform.one` through Cloudflare Tunnel.
- **Clover webhook verification** (`src/webhooks/handlers/clover.ts`): static `X-Clover-Auth` vs `CLOVER_AUTH_CODE` via `timingSafeEqual` (fail-closed), plus `verificationCode` handshake. Live verified: no header→401, wrong→401, `71b6...`→200, `verificationCode`→200.
- **Clover → Zkong push** (`src/services/clover/client.ts:GET /items/{id}` via `CLOVER_API_TOKEN` + `src/services/zkong/items.ts:batchImportItem` with `unitName:1`, cent string `"3600"` for $36.00, `barCode = sku||code||id`): live verified `I:A7GYZFS51N3AY UPDATE 500000 → batchImportItem ok` and `M5 MAC MINI 4200 → ASRX79016G 4200` with cent round-trip fix (`4200→42→4200` → now `4200→4200`).
- **Clover DELETE → Zkong** (`DELETE /zk/item/batchDeleteItem` with `{list:[barCode]}`; omits empty `storeId`): fixed from `POST` (was `10009` param error), now `batchDeleteItem ok` verified after rebuild.
- **Echo loop prevention + persistence** (`src/db/models/store.ts:item_map`): `ensureDefaultStore` + `upsertItemMap` stores `standard_price`/`last_pushed_price`/`promo_active` per `(store_id, clover_item_id)`, compares `fetched price === last_pushed_price` to skip self-triggered webhooks; `DELETE` cleans `item_map`.
- **Zkong auth** (`src/utils/rsa.ts` + `src/services/zkong/auth.ts`): `GET getErpPublicKey` → `RSA PKCS1` encrypt → `POST login` (loginType 3), cached 7d minus margin, `401 → re-login → retry-once` in `src/services/zkong/client.ts`. Live verified against `esl-eu.zkong.com` (`VensweGlobalLLC` `1786427294219` → store `S1011`/`Sugandha Puja`).
- **Zkong → Clover poller** (`src/polling/zkong-poll.ts`): `POST /zk/erp/item/list` paginated `50`, `zkongPriceToCents` handles `"4400"` (=4400) and legacy `"42.00"` (=4200), diffs `last_zkong_update_time`/`last_pushed_price`, `PUT /v3/merchants/{mId}/items/{id}` via `CLOVER_API_TOKEN`, updates `item_map`+`sync_log`. Started in `src/index.ts` via `startZkongPoller()` (default 5 min, `ZKONG_POLL_INTERVAL_MS` tunable; live log `zkong poll] 4400 → pushing to Clover ...`).
- **Postgres** (`docker-compose.yml: db` `postgres:16-alpine`, `5432:5432`, `pgdata` vol, healthcheck; `src/db/connection.ts: pg Pool` + `initDb()` for `stores`/`item_map`/`sync_log`): replaces the earlier `better-sqlite3` file DB, credentials via `.env` (`POSTGRES_*`/`DATABASE_URL`), exposed for `psql`/DBeaver (`localhost:5432`/`postgres`/`clover_zkong`).
- **Docker Compose + Tunnel** (`cloudflared/Dockerfile` alpine with shell — official image is distroless `gcr.io/distroless/base-debian13:nonroot` — plus `entrypoint.sh` that `exec`s `cloudflared tunnel run --token $TUNNEL_TOKEN` when `cloudflared/.env` `TUNNEL_TOKEN` is set, else idles). Live: `clokong.fullform.one` → `middleware:3000` on `poc-net`, verified via manual `curl` + live Clover `GAAC1D37ZZDV1` events.
- **Price is cent-based both ways** (`unitName:1`, no `/100`): Clover `$36.00` (`3600`) ↔ Zkong `"3600"`; poller `parseInt` for ints + `parseFloat*100` heuristic for legacy decimals fixes the `4200↔42` and `4400→440000` bugs.

---

## Project Structure

Reflects the actual repo layout (as of the latest Clover↔Zkong round-trip fix).

```
cloverPosDemo/
├── src/
│   ├── config/env.ts           # Clover/Zkong/Postgres + CLOVER_AUTH_CODE + CLOVER_API_TOKEN
│   ├── services/
│   │   ├── clover/client.ts     # GET/PUT /v3/merchants/{mId}/items/{id} (Bearer CLOVER_API_TOKEN)
│   │   └── zkong/
│   │       ├── auth.ts          # getErpPublicKey → RSA → login → token cache (7d, 401-retry)
│   │       ├── client.ts        # axios + Authorization injection + 401 retry-once
│   │       └── items.ts         # batchImportItem (unitName:1, cents), batchDeleteItem (DELETE), mapCloverToZkongItem
│   ├── polling/zkong-poll.ts    # POST /zk/erp/item/list paginated, cent parse, → PUT Clover on diff
│   ├── db/
│   │   ├── connection.ts        # pg Pool + initDb() for stores/item_map/sync_log
│   │   └── models/
│   │       ├── store.ts         # ensureDefaultStore(merchantId)
│   │       ├── item-map.ts      # upsert/findByBarcode/findByCloverId (async pg)
│   │       └── sync-log.ts      # logSync (async pg)
│   ├── webhooks/
│   │   ├── server.ts            # Express: GET /health, POST /webhooks/clover
│   │   └── handlers/clover.ts  # verificationCode + X-Clover-Auth + fetch→push→persist + echo check + DELETE
│   ├── utils/rsa.ts             # RSA public-key password encryption (Node crypto, PKCS1)
│   └── index.ts                 # initDb retry + eager Zkong login + startServer + startZkongPoller
├── cloudflared/
│   ├── Dockerfile               # alpine + cloudflared (has shell, unlike distroless official)
│   ├── entrypoint.sh            # TUNNEL_TOKEN → run, else idle for setup
│   ├── .env.example             # TUNNEL_TOKEN template
│   └── .env                     # your token (gitignored)
├── docker-compose.yml            # db (postgres:16, 5432) + middleware (3000) + cloudflared on poc-net
├── Dockerfile                    # middleware (node:20-alpine, pg needs no native build)
├── .env.example                  # CLOVER_*, ZKONG_*, POSTGRES_*, DATABASE_URL, ZKONG_POLL_INTERVAL_MS
├── package.json / tsconfig.json
└── docs/
    ├── architecture.md
    └── USER_GUIDE.md            # price field meanings + how to use the app
```

### Environment variables

Reflects `.env.example` as written (authoritative).

```env
# Clover
CLOVER_API_BASE=https://sandbox.dev.clover.com/v3/merchants
CLOVER_MERCHANT_ID=
CLOVER_CLIENT_ID=
CLOVER_CLIENT_SECRET=
# Merchant API Token (Test Merchants → <merchant> → API Token, Bearer for item fetch/update)
CLOVER_API_TOKEN=

# Zkong
ZKONG_API_BASE=https://esl-eu.zkong.com
ZKONG_ACCOUNT=
ZKONG_PASSWORD=
ZKONG_MERCHANT_ID=
ZKONG_AGENCY_ID=

# App + Webhook Auth
PORT=3000
CLOVER_AUTH_CODE=              # Your Apps → App Settings → Webhooks → Clover Auth Code

# Postgres (db service)
POSTGRES_DB=clover_zkong
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
DATABASE_URL=postgres://postgres:postgres@db:5432/clover_zkong  # host `db` inside Docker, `localhost` from host
ZKONG_POLL_INTERVAL_MS=300000  # Zkong → Clover polling interval (ms)
```

### Dependencies

`express@5.1.0`, `dotenv@17.2.3`, `axios@1.12.2`, `pg@8.13.1`, `typescript`, `ts-node-dev`, `@types/express`/`@types/node`/`@types/pg`. `better-sqlite3` was replaced by `pg` when we moved from file DB to the separate Postgres container. Native `crypto` is used for RSA (`utils/rsa.ts`) and `timingSafeEqual`.

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

## Open Items / Next Steps
- **Resolve the three-mechanism promo ambiguity empirically** against a live Zkong sandbox
  (create a promo via each of Activity Strategy / `repricingList` / `proStartTime`, poll
  `/zk/erp/item/list`, see which one changes the polled `price`) before writing any Option 2
  scheduler/poller code.
- Confirm Zkong token TTL empirically (docs don't state one) once we have live credentials
  wired up.
- Design and implement the `item_map` / `stores` SQLite schema described above (not yet
  created -- `src/db/` doesn't exist yet).
- Implement the Zkong auth client (RSA login flow) -- next planned piece, since every other
  Zkong call depends on it.
- Implement Clover webhook envelope parsing (`merchants[mId].{items,inventory,...}`) and
  route events into the (not yet built) sync engine -- current handler only logs and acks
  after passing the auth check.
- Actually run `docker compose up` against a real Cloudflare account and a real Clover
  sandbox app once both are available, to verify the tunnel end-to-end (not yet done in this
  working environment -- no `docker` binary available here).
- Add `axios`, `better-sqlite3`, `node-cron`, `winston`, `zod` to `package.json` as sync/
  polling implementation begins.
