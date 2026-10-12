import { getPool } from "../connection";

export enum IntegrationStatus {
  DELETED = -1,
  PENDING_SETUP = 0,
  CONFIG_VERIFIED = 1,
  PAUSED = 2,
  LIVE = 3,
}

export interface CloverPosConfig {
  apiBaseUrl?: string;
  merchantId?: string;
  clientAppId?: string;
  apiToken?: string;
  cloverAuthToken?: string;
  [key: string]: unknown;
}

export interface ZkongConfig {
  account?: string;
  password?: string;
  merchantId?: string;
  agencyId?: string;
  storeId?: string;
  apiBase?: string;
  [key: string]: unknown;
}

export interface FieldMapping {
  posField: string;
  zkongField: string;
}

export interface SyncRule {
  trigger: string;
  actionType: "unidirectional" | "bidirectional";
  description?: string;
}

export interface IntegrationRow {
  id: number;
  integration_id: string;
  registering_business_name: string;
  registering_business_email: string;
  selected_pos: "square" | "toast" | "clover" | "lightspeed";
  pos_configuration: CloverPosConfig;
  zkong_configuration: ZkongConfig;
  field_mappings: Record<string, string>;
  sync_rules: SyncRule[];
  status: IntegrationStatus;
  created_at: string;
  updated_at: string;
}

export class IntegrationsRepo {
  static async create(data: {
    integration_id: string;
    registering_business_name: string;
    registering_business_email: string;
    selected_pos: string;
    pos_configuration?: Record<string, unknown>;
    zkong_configuration?: Record<string, unknown>;
    field_mappings?: Record<string, string>;
    sync_rules?: SyncRule[];
    status?: IntegrationStatus;
  }): Promise<IntegrationRow> {
    const pool = getPool();
    const res = await pool.query<IntegrationRow>(
      `
      INSERT INTO integrations (
        integration_id,
        registering_business_name,
        registering_business_email,
        selected_pos,
        pos_configuration,
        zkong_configuration,
        field_mappings,
        sync_rules,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        data.integration_id,
        data.registering_business_name,
        data.registering_business_email,
        data.selected_pos,
        JSON.stringify(data.pos_configuration || {}),
        JSON.stringify(data.zkong_configuration || {}),
        JSON.stringify(data.field_mappings || {}),
        JSON.stringify(data.sync_rules || []),
        data.status ?? IntegrationStatus.PENDING_SETUP,
      ]
    );
    return res.rows[0];
  }

  static async findByIntegrationId(integrationId: string): Promise<IntegrationRow | null> {
    const pool = getPool();
    const res = await pool.query<IntegrationRow>(
      `SELECT * FROM integrations WHERE integration_id = $1`,
      [integrationId]
    );
    return res.rows[0] || null;
  }

  static async findById(id: number): Promise<IntegrationRow | null> {
    const pool = getPool();
    const res = await pool.query<IntegrationRow>(
      `SELECT * FROM integrations WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  static async findAll(filters?: {
    search?: string;
    pos?: string;
    status?: number;
    includeDeleted?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ list: IntegrationRow[]; total: number }> {
    const pool = getPool();
    const page = Math.max(1, filters?.page || 1);
    const limit = Math.max(1, Math.min(100, filters?.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (!filters?.includeDeleted) {
      conditions.push(`status != ${IntegrationStatus.DELETED}`);
    }

    if (filters?.status !== undefined) {
      conditions.push(`status = $${idx++}`);
      values.push(filters.status);
    }

    if (filters?.pos) {
      conditions.push(`selected_pos = $${idx++}`);
      values.push(filters.pos);
    }

    if (filters?.search) {
      conditions.push(`(
        registering_business_name ILIKE $${idx} OR
        registering_business_email ILIKE $${idx} OR
        integration_id::text ILIKE $${idx}
      )`);
      values.push(`%${filters.search}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM integrations ${whereClause}`,
      values
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);

    const queryValues = [...values, limit, offset];
    const dataRes = await pool.query<IntegrationRow>(
      `SELECT * FROM integrations ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      queryValues
    );

    return {
      list: dataRes.rows,
      total,
    };
  }

  static async update(
    integrationId: string,
    updates: Partial<Omit<IntegrationRow, "id" | "integration_id" | "created_at" | "updated_at">>
  ): Promise<IntegrationRow | null> {
    const pool = getPool();
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.registering_business_name !== undefined) {
      fields.push(`registering_business_name = $${idx++}`);
      values.push(updates.registering_business_name);
    }
    if (updates.registering_business_email !== undefined) {
      fields.push(`registering_business_email = $${idx++}`);
      values.push(updates.registering_business_email);
    }
    if (updates.selected_pos !== undefined) {
      fields.push(`selected_pos = $${idx++}`);
      values.push(updates.selected_pos);
    }
    if (updates.pos_configuration !== undefined) {
      fields.push(`pos_configuration = $${idx++}`);
      values.push(JSON.stringify(updates.pos_configuration));
    }
    if (updates.zkong_configuration !== undefined) {
      fields.push(`zkong_configuration = $${idx++}`);
      values.push(JSON.stringify(updates.zkong_configuration));
    }
    if (updates.field_mappings !== undefined) {
      fields.push(`field_mappings = $${idx++}`);
      values.push(JSON.stringify(updates.field_mappings));
    }
    if (updates.sync_rules !== undefined) {
      fields.push(`sync_rules = $${idx++}`);
      values.push(JSON.stringify(updates.sync_rules));
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }

    if (fields.length === 0) return this.findByIntegrationId(integrationId);

    fields.push(`updated_at = NOW()`);
    values.push(integrationId);

    const res = await pool.query<IntegrationRow>(
      `
      UPDATE integrations
      SET ${fields.join(", ")}
      WHERE integration_id = $${idx}
      RETURNING *
      `,
      values
    );

    return res.rows[0] || null;
  }

  static async updateStatus(
    integrationId: string,
    status: IntegrationStatus
  ): Promise<IntegrationRow | null> {
    return this.update(integrationId, { status });
  }

  static async softDelete(integrationId: string): Promise<IntegrationRow | null> {
    return this.updateStatus(integrationId, IntegrationStatus.DELETED);
  }
}
