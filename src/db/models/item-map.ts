import { getPool } from "../connection";

export interface ItemMapRow {
  id: number;
  store_id: number;
  clover_item_id: string;
  zkong_barcode: string;
  standard_price: number;
  last_pushed_price: number;
  promo_active: boolean;
  zkong_item_id: number | null;
  last_zkong_update_time: string | null;
  updated_at: string;
}

export async function upsertItemMap(
  row: Omit<ItemMapRow, "id" | "updated_at">
): Promise<ItemMapRow> {
  const pool = getPool();
  const res = await pool.query<ItemMapRow>(
    `
    INSERT INTO item_map
      (store_id, clover_item_id, zkong_barcode, standard_price, last_pushed_price, promo_active, zkong_item_id, last_zkong_update_time)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (store_id, clover_item_id) DO UPDATE SET
      zkong_barcode = EXCLUDED.zkong_barcode,
      standard_price = EXCLUDED.standard_price,
      last_pushed_price = EXCLUDED.last_pushed_price,
      promo_active = EXCLUDED.promo_active,
      zkong_item_id = EXCLUDED.zkong_item_id,
      last_zkong_update_time = EXCLUDED.last_zkong_update_time,
      updated_at = NOW()
    RETURNING *
    `,
    [
      row.store_id,
      row.clover_item_id,
      row.zkong_barcode,
      row.standard_price,
      row.last_pushed_price,
      row.promo_active,
      row.zkong_item_id,
      row.last_zkong_update_time,
    ]
  );
  return res.rows[0];
}

export async function findByBarcode(
  storeId: number,
  barcode: string
): Promise<ItemMapRow | undefined> {
  const res = await getPool().query<ItemMapRow>(
    "SELECT * FROM item_map WHERE store_id=$1 AND zkong_barcode=$2",
    [storeId, barcode]
  );
  return res.rows[0];
}

export async function findByCloverId(
  storeId: number,
  cloverItemId: string
): Promise<ItemMapRow | undefined> {
  const res = await getPool().query<ItemMapRow>(
    "SELECT * FROM item_map WHERE store_id=$1 AND clover_item_id=$2",
    [storeId, cloverItemId]
  );
  return res.rows[0];
}
