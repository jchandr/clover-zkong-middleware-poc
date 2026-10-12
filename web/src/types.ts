export interface Integration {
  id: number;
  integration_id: string;
  registering_business_name: string;
  registering_business_email: string;
  selected_pos: 'square' | 'toast' | 'clover' | 'lightspeed';
  pos_configuration: {
    apiBaseUrl?: string;
    merchantId?: string;
    clientAppId?: string;
    apiToken?: string;
    cloverAuthToken?: string;
    [key: string]: unknown;
  };
  zkong_configuration: {
    account?: string;
    password?: string;
    merchantId?: string;
    agencyId?: string;
    storeId?: string;
    apiBase?: string;
    [key: string]: unknown;
  };
  field_mappings: Record<string, string>;
  sync_rules: Array<{
    trigger: string;
    actionType: 'unidirectional' | 'bidirectional';
    description?: string;
  }>;
  status: number; // 0=PENDING, 1=VERIFIED, 2=PAUSED, 3=LIVE, -1=DELETED
  created_at: string;
  updated_at: string;
}

export interface SchemaField {
  key: string;
  label: string;
  type: string;
  description?: string;
}
