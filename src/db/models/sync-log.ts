import { getPool } from "../connection";

export async function logSync(entry: {
  item_map_id?: number | null;
  direction: "clover->zkong" | "zkong->clover" | "reconcile";
  action: string;
  from_price?: number | null;
  to_price?: number | null;
  reason?: string | null;
  success?: boolean;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO sync_log (item_map_id, direction, action, from_price, to_price, reason, success)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      entry.item_map_id ?? null,
      entry.direction,
      entry.action,
      entry.from_price ?? null,
      entry.to_price ?? null,
      entry.reason ?? null,
      entry.success ?? true,
    ]
  );
}
