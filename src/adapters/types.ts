export interface NormalizedPosItem {
  id: string;
  name: string;
  price: number; // in cents
  sku?: string;
  code?: string;
  vatPercentage?: number;
  discountPercentage?: number;
  calculatedFinalPrice?: number; // e.g. price after vat or promo
  raw: Record<string, unknown>;
}

export interface PosWebhookEvent {
  eventType: "CREATE" | "UPDATE" | "DELETE" | "VERIFICATION" | "UNKNOWN";
  objectId?: string;
  itemId?: string;
  rawPayload: Record<string, unknown>;
  verificationCode?: string;
  authHeader?: string;
}

export interface IPosAdapter {
  readonly posType: string;
  parseWebhook(reqBody: Record<string, unknown>, headers: Record<string, string | string[] | undefined>): PosWebhookEvent;
  verifyAuth(headers: Record<string, string | string[] | undefined>, config: Record<string, unknown>): boolean;
  getItem(itemId: string, config: Record<string, unknown>): Promise<NormalizedPosItem>;
  updateItemField(itemId: string, fieldName: string, value: unknown, config: Record<string, unknown>): Promise<boolean>;
  getSchemaFields(): Array<{ key: string; label: string; type: "string" | "number" | "calculated" }>;
}
