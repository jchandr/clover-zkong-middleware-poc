# Clover ↔ Zkong Middleware — User Guide

This guide explains how to use the POC as it exists today, what each Zkong price field means, and what is still one-way.

## Current sync direction

| Direction | Status | How it works |
|-----------|--------|--------------|
| **Clover → Zkong** | **Live** | Webhook `I:<id> CREATE/UPDATE` → `GET /v3/merchants/{mId}/items/{id}` (`CLOVER_API_TOKEN`) → `POST /zk/item/batchImportItem` with `unitName:1`, `price` as cents string (`3600` = $36.00), `barCode=sku‖code‖id`; persisted in `item_map` (`standard_price`/`last_pushed_price`) |
| **Zkong → Clover** | **Live** | Polling `POST /zk/erp/item/list` (paginated 50, every `ZKONG_POLL_INTERVAL_MS`) → `zkongPriceToCents` (handles `"4400"` as 4400 and legacy `"42.00"` as 4200) → `PUT /v3/merchants/{mId}/items/{id}` (`CLOVER_API_TOKEN`); echo check via `last_pushed_price` prevents ping-pong |
| **Zkong promo strategy → Clover `price`** | **Designed, deferred** | Needs `item_map` `promo_active` + polling `strategy/list` — deferred until empirical test of `activity` vs `repricingList` vs `proStartTime` determines which changes the polled `price` |

**So your `9500` test now flows back:** editing `Sale price: 9500` (cents) in Zkong at `esl-eu.zkong.com/productmanager/.../209683266...` → next poll (≤ `ZKONG_POLL_INTERVAL_MS`) → Clover `GAAC1D37ZZDV1` price becomes `9500` ($95.00). Earlier one-way limitation is lifted.

## How to use (Clover → Zkong flow)

### 1. Create / edit an item in Clover
- `https://sandbox.dev.clover.com/inventory/m/GAAC1D37ZZDV1/items` → **New Item** or edit existing
- Fill **Name**, **Price** (e.g. `$50.00` → `5000` cents), **SKU** (recommended, see below), **Code**
- Save

### 2. Watch the middleware
```bash
docker compose logs -f middleware
```
You should see within 5s:
```
[clover webhook] received payload: {"appId":"34WZ9HQM8M0G0","merchants":{"GAAC1D37ZZDV1":[{"objectId":"I:...","type":"UPDATE"...}]}}
[sync] fetching Clover item GAAC1D37ZZDV1/<id>
[sync] fetched: <name> price=5000 sku=...
[sync] pushing to Zkong barCode=<sku|code|id>
[zkong] batchImportItem ok: 1 items
```

### 3. Verify in Zkong
- `esl-eu.zkong.com → Product Management → Merchant Products` (not Store Products)
- Search by **barCode** = the SKU you set in Clover (or the Clover item `id` if SKU was empty, e.g. `A7GYZFS51N3AY`), or by **Title**
- Check `Specification → Sale price`. You do **not** need to set Store filter if `storeId=""` (merchant-level). If you use store-specific import, filter by `Sugandha Puja` / `1787791370298`.

### 4. Delete
- Delete item in Clover Inventory → webhook `type:DELETE` → `POST /zk/item/batchDeleteItem` with `list:[barCode]` → removed from Zkong product list. Check `sync_log` for audit.

### 5. Inspect the DB (Postgres)
```bash
docker compose exec middleware node -e "
const {getPool}=require('./dist/db/connection.js');
(async()=>{
  const p=getPool();
  console.log(await p.query('SELECT * FROM item_map'));
})();
"
# or from host:
PGPASSWORD=postgres psql -h localhost -U postgres -d clover_zkong -c "SELECT clover_item_id, zkong_barcode, standard_price, promo_active FROM item_map;"
```

## Price fields — what they mean

Zkong `Specification` shows three price columns. **Sale price** is now synced both ways, cent-based.

| Zkong field | API field | Meaning on ESL tag | Current middleware mapping |
|-------------|-----------|-------------------|----------------------------|
| **Sale price** | `price` | The price actually charged and displayed large on the tag. This is the *current* price. | **Cent-based both ways** with `unitName:1` (no implicit `/100`): Clover `3600` ($36.00) ↔ Zkong `"3600"`; Zkong `"4400"` ↔ Clover `4400` ($44.00). Legacy `"42.00"` is handled as `4200`. Fixed from `unitName:0` which caused `4200↔42` and `4400→440000` loops. |
| **Original price** | `originalPrice` | MSRP / reference price, usually shown smaller and crossed out next to Sale price (e.g. “Was $65.00”). Used for “discount” visuals. | **Not mapped** — left empty (`Please enter` in your screenshot). Clover has no equivalent (`cost` is wholesale, not MSRP). Could be filled later from `Clover.cost` or a fixed offset if you need it. Template must be configured to show it, otherwise empty is fine. |
| **Member price** | `memberPrice` | Loyalty/member card price, secondary tier shown only to members. | **Not mapped** — left empty. Would be driven by Zkong `strategy` promo `fieldValues.memberPrice` or a future Clover loyalty source. |

**Template note:** which prices appear on the physical ESL is determined by the **Zkong template** assigned to the tag (`templateAttrCategory`/`templateAttr`), not just the data. If your template only renders Sale price, Original/Member being empty is expected and correct.

## SKU / barCode best practice

- **Set `SKU` in Clover** to the barcode you want in Zkong. The mapper uses `barCode = sku || code || cloverItem.id` (`src/services/zkong/items.ts:mapCloverToZkongItem`). If SKU is empty it falls back to the opaque Clover `id` (`A7GYZFS51N3AY`) — valid but hard to search.
- Keep `SKU` stable and unique per product. Changing it creates a new Zkong product (old barCode remains until deleted).

## Known limitations (POC)

- **Single Clover merchant** (`GAAC1D37ZZDV1`, app `34WZ9HQM8M0G0`) → single logical store. Store-specific pricing (`storeId` scoping) is schema-ready (`stores` table, `store_id` FK) but not yet routed per-store; merchant-level `storeId=""` is used.
- **Polling lag:** Zkong → Clover changes appear after next `ZKONG_POLL_INTERVAL_MS` (default 5 min, set `60000` in `.env` for 1-min feedback during POC).
- **Promo preservation:** `item_map.standard_price` correctly queues Clover edits made while a promo is active (`UPDATE_PENDING_PROMO`), but full `strategy` scheduling (auto-restore via `strategy/list` cron) is still deferred pending the empirical test.
