import { getPool } from "../connection";

export interface StoreRow {
  id: number;
  zkong_store_id: string;
  clover_merchant_id: string;
  name: string | null;
  created_at: string;
}

export async function ensureDefaultStore(
  zkongStoreId: string = "",
  cloverMerchantId: string = ""
): Promise<StoreRow> {
  const pool = getPool();
  const res = await pool.query<StoreRow>(
    `
    INSERT INTO stores (zkong_store_id, clover_merchant_id, name)
    VALUES ($1, $2, 'Default Store')
    ON CONFLICT (zkong_store_id) DO UPDATE SET clover_merchant_id = EXCLUDED.clover_merchant_id
    RETURNING *
    `,
    [zkongStoreId, cloverMerchantId]
  );
  return res.rows[0];
}
