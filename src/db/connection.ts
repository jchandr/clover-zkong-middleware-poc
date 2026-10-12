import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@db:5432/clover_zkong";

  pool = new Pool({ connectionString });
  pool.on("error", (err) => {
    console.error("[db] pool error", err);
  });
  return pool;
}

export async function initDb(): Promise<void> {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      zkong_store_id TEXT NOT NULL UNIQUE,
      clover_merchant_id TEXT NOT NULL,
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(`
    CREATE TABLE IF NOT EXISTS item_map (
      id SERIAL PRIMARY KEY,
      store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      clover_item_id TEXT NOT NULL,
      zkong_barcode TEXT NOT NULL,
      standard_price INTEGER NOT NULL,
      last_pushed_price INTEGER NOT NULL,
      promo_active BOOLEAN NOT NULL DEFAULT FALSE,
      zkong_item_id BIGINT,
      last_zkong_update_time TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(store_id, clover_item_id),
      UNIQUE(store_id, zkong_barcode)
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_item_map_barcode ON item_map(zkong_barcode);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_item_map_clover ON item_map(clover_item_id);`
  );
  await p.query(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      item_map_id INTEGER REFERENCES item_map(id) ON DELETE SET NULL,
      direction TEXT NOT NULL CHECK(direction IN ('clover->zkong','zkong->clover','reconcile')),
      action TEXT NOT NULL,
      from_price INTEGER,
      to_price INTEGER,
      reason TEXT,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS integrations (
      id SERIAL PRIMARY KEY,
      integration_id UUID NOT NULL UNIQUE,
      registering_business_name TEXT NOT NULL,
      registering_business_email TEXT NOT NULL,
      selected_pos TEXT NOT NULL,
      pos_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
      zkong_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
      field_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
      sync_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      status INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_integrations_id ON integrations(integration_id);`
  );
  await p.query(
    `CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);`
  );
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
