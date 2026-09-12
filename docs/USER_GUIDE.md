# Clover ↔ Zkong Middleware — User Guide

This guide explains how to use the POC as it exists today, what each Zkong price field means, and what is still one-way.

## Current sync direction (important)

| Direction | Status | How it works |
|-----------|--------|--------------|
| **Clover → Zkong** | **Live** | Webhook `I:<id> CREATE/UPDATE` → `GET /v3/merchants/{mId}/items/{id}` → `POST /zk/item/batchImportItem` |
| **Zkong → Clover** | **Not yet implemented** | Planned as polling (`POST /zk/erp/item/list` diff by `updateTime` + `strategy/list` for promos). Manual edits in Zkong Dashboard (like your `9500`) will **not** appear in Clover until this leg is built. |
| **Zkong promo strategy → Clover `price`** | **Designed, not built** | Requires `item_map` standard/promo state + polling `strategy/list` — deferred until empirical test of which Zkong mechanism actually changes the polled `price`. |

**So your test is expected:** changing `Sale price: 9500` in `esl-eu.zkong.com/productmanager/...` stays in Zkong only for now. It will not update `GAAC1D37ZZDV1` in Clover until the polling leg lands.

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

Zkong `Specification` shows three price columns. Only **Sale price** is driven by Clover today.

| Zkong field | API field | Meaning on ESL tag | Current middleware mapping |
|-------------|-----------|-------------------|----------------------------|
| **Sale price** | `price` | The price actually charged and displayed large on the tag. This is the *current* price. | `Clover.price` (cents, integer) → `Zkong.price` as string with `unitName:0` (Zkong divides by 100). Example: Clover `5000` → Zkong `5000` → tag shows `50.00`. Your `9500` edit stays as Zkong-only until the reverse sync is built. |
| **Original price** | `originalPrice` | MSRP / reference price, usually shown smaller and crossed out next to Sale price (e.g. “Was $65.00”). Used for “discount” visuals. | **Not mapped** — left empty (`Please enter` in your screenshot). Clover has no equivalent (`cost` is wholesale, not MSRP). Could be filled later from `Clover.cost` or a fixed offset if you need it. Template must be configured to show it, otherwise empty is fine. |
| **Member price** | `memberPrice` | Loyalty/member card price, secondary tier shown only to members. | **Not mapped** — left empty. Would be driven by Zkong `strategy` promo `fieldValues.memberPrice` or a future Clover loyalty source. |

**Template note:** which prices appear on the physical ESL is determined by the **Zkong template** assigned to the tag (`templateAttrCategory`/`templateAttr`), not just the data. If your template only renders Sale price, Original/Member being empty is expected and correct.

## SKU / barCode best practice

- **Set `SKU` in Clover** to the barcode you want in Zkong. The mapper uses `barCode = sku || code || cloverItem.id` (`src/services/zkong/items.ts:mapCloverToZkongItem`). If SKU is empty it falls back to the opaque Clover `id` (`A7GYZFS51N3AY`) — valid but hard to search.
- Keep `SKU` stable and unique per product. Changing it creates a new Zkong product (old barCode remains until deleted).

## Known limitations (POC)

- One-way only (Clover → Zkong). Zkong → Clover polling and the `item_map` promo state (`standard_price`/`last_pushed_price`/`promo_active`) are designed but not yet wired.
- Single Clover merchant (`GAAC1D37ZZDV1`) → single logical store. Store-specific pricing (`storeId` scoping) is schema-ready but not yet routed.
- No polling-interval lag to document yet — will be documented once the Zkong poll is implemented.
