import { getPool } from "../connection";

export async function ensureDefaultStore(cloverMerchantId: string): Promise<number> {
  const pool = getPool();
  // Single logical store for POC: merchant-level (no zk-store scoping yet).
  // Uses a synthetic zkong_store_id so the FK is satisfied even for merchant-level items.
  const zkongStoreId = `merchant:${cloverMerchantId}`; // will be replaced by real ZK storeId once multi-store is needed
  const res = await pool.query<{ id: number }>(
    `
    INSERT INTO stores (zkong_store_id, clover_merchant_id, name)
    VALUES ($1, $2, $3)
    ON CONFLICT (zkong_store_id) DO UPDATE SET clover_merchant_id = EXCLUDED.clover_merchant_id
    RETURNING id
    `,
    [zkongStoreId, cloverMerchantId, `default-${cloverMerchantId}`]
  );
  return res.rows[0].id;
}
