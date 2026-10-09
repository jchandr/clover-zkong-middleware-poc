# Clover ↔ Zkong Middleware — User Guide

This guide explains how to use the POC: bidirectional price sync, the Zkong discount flow, price units, and setup/migration steps.

## Sync directions (all live)

| Direction | Status | How it works |
|-----------|--------|--------------|
| **Clover → Zkong** | **Live** | Webhook `I:<id> CREATE/UPDATE` → `GET /v3/merchants/{mId}/items/{id}` → `POST /zk/item/batchImportItem` |
| **Zkong → Clover** | **Live** | Poller (`POST /zk/erp/item/list` every `ZKONG_POLL_INTERVAL_MS`, default `1000ms`) → `POST /v3/merchants/{mId}/items/{id}` |
| **Zkong discount → Clover** | **Live** | Poller reads extended fields `custFeature1` (Was) + `custFeature2` (Discount %) → sale = `Was × (1 − Discount%/100)` → pushed to Clover |

### Discount flow (Zkong → Clover)

Zkong stores discounts in **extended (custFeature) fields**, not in `price`/`originalPrice`:

| Dashboard field | API field | Role |
|-----------------|-----------|------|
| **Was** | `custFeature1` | Original price the discount is computed from |
| **Discount %** | `custFeature2` | Percentage off (e.g. `10` = 10%) |
| **Discount Number** | `custFeature3` | Absolute sale price (used directly if set) |

Poller logic (`src/polling/zkong-poll.ts`):

```
if Discount % > 0:
    base = Was if Was > 0 else price (base)
    sale = base × (1 − Discount%/100)
elif Discount Number > 0:
    sale = Discount Number
else:
    sale = price (base)
```

- While a discount is active, both Clover and Zkong main `price` (售价) = computed sale price.
- When the discount is cleared (or `Discount %` removed), the poller restores both Clover and Zkong main `price` back to the original base price.
- The Clover webhook is **echo-suppressed** during promo sync (no loop).
- If you edit the item's price directly in Clover POS (e.g. from `$10.00` to `$20.00`), the middleware updates Zkong's selling price to `2000`, explicitly clears `Was` and `Discount %` in Zkong, and resets `promo_active` to `false`.

## Price units (important)

**Both Clover and Zkong use cents (integers).**

- Clover `$8700.00` = `870000` cents
- Zkong `price` = `870000` (cents)
- `batchImportItem` is called with `unitName: 1` (raw value, Zkong does **not** divide by 100)

Earlier bug: `unitName: 0` told Zkong to divide by 100, so `870000` became `8700`. Fixed to `unitName: 1`.

## How to use

### 1. Create / edit an item in Clover
- `https://sandbox.dev.clover.com/inventory/m/GAAC1D37ZZDV1/items` → **New Item** or edit existing
- Fill **Name**, **Price** (e.g. `$50.00` → `5000` cents), **SKU** (recommended), **Code**
- Save

### 2. Watch the middleware
```bash
docker compose logs -f middleware
```
You should see within 5s:
```
[clover webhook] received payload: {"appId":"...","merchants":{"GAAC1D37ZZDV1":[{"objectId":"I:...","type":"UPDATE"...}]}}
[sync] fetching Clover item GAAC1D37ZZDV1/<id>
[sync] fetched: <name> price=5000 sku=...
[sync] pushing to Zkong barCode=<sku|code|id>
[zkong] batchImportItem ok: 1 items
```

### 3. Verify in Zkong
- `esl-eu.zkong.com → Product Management → Merchant Products` (not Store Products)
- Search by **barCode** = the SKU you set in Clover (or Clover item `id` if SKU empty)
- Check `Specification → Sale price`

### 4. Set a discount in Zkong
- Edit the item → **Extended field** section
- Set **Was** (e.g. `1000000`) and **Discount %** (e.g. `10`) → **Save**
- Within ~1s the poller logs:
  ```
  [poller] Zkong change for <barcode>: sale=900000 base=870000 was=1000000 discount=10% promo=true
  ```
- Clover price updates to the sale price (e.g. `$9000.00`)
- Clear **Discount %** → poller logs `CLEAR_PROMO_PRICE` → Clover restored to base

### 5. Delete
- Delete item in Clover → webhook `type:DELETE` → `POST /zk/item/batchDeleteItem` → removed from Zkong

### 6. Inspect the DB (Postgres)
```bash
docker compose exec db psql -U postgres -d clover_zkong -c "SELECT clover_item_id, zkong_barcode, standard_price, last_pushed_price, promo_active FROM item_map;"
docker compose exec db psql -U postgres -d clover_zkong -c "SELECT * FROM sync_log ORDER BY id DESC LIMIT 10;"
```

## SKU / barCode best practice

- **Set `SKU` in Clover** to the barcode you want in Zkong. Mapper: `barCode = sku || code || cloverItem.id` (`src/services/zkong/items.ts`).
- The webhook handler **preserves the existing barcode** for mapped items, so re-syncing an item never creates a duplicate in Zkong.
- Keep `SKU` stable and unique per product.

## Setup & migration

### One-time SQL (required after upgrade)

The middleware does **not** auto-migrate an existing database. After pulling changes that alter the schema, run:

```bash
docker compose exec db psql -U postgres -d clover_zkong \
  -c "ALTER TABLE item_map ADD COLUMN IF NOT EXISTS promo_active BOOLEAN NOT NULL DEFAULT FALSE;"
```

(`promo_active` tracks whether a Zkong discount is currently applied to the item.)

### Environment variables

See `.env.example`. Key Zkong variables:

| Variable | Description |
|----------|-------------|
| `ZKONG_ACCOUNT` / `ZKONG_PASSWORD` | Zkong portal login |
| `ZKONG_MERCHANT_ID` | Zkong merchant ID |
| `ZKONG_AGENCY_ID` | Zkong agency/reseller ID |
| `ZKONG_API_BASE` | Default `https://esl-eu.zkong.com` |
| `ZKONG_STORE_ID` | Zkong **store** ID (from `GET /zk/store/storeList`, the `storeId` field). Optional — enables promo strategy visibility logging. |
| `ZKONG_POLL_INTERVAL_MS` | Poller interval (default `60000`; `1000` for testing) |

> **Note:** `ZKONG_STORE_ID` is the native Zkong store ID (large integer), **not** the organization ID from `organization/getList` and **not** the `id` field — use the `storeId` field from `storeList`.

## Known limitations (POC)

- **Strategy visibility requires permission.** `POST /zk/strategy/list` returns `10030 你无权限访问` unless the ERP account has the strategy menu granted. This only affects promo *visibility logging* — price sync works without it.
- **Single Clover merchant** → single logical store. Store-specific pricing is schema-ready but not routed.
- **Mid-promo base edits are reverted.** If you change the Clover base price while a discount is active, it is restored to Zkong's base when the discount ends (logged as a conflict).
- **Discount window not enforced.** The poller applies the discount whenever `Discount % > 0`; it does not check Promotion Start/End times.
