import { NormalizedPosItem, IPosAdapter } from "../adapters/types";
import { IntegrationRow, SyncRule } from "../db/models/integration";
import { ZkongService } from "../services/ZkongService";

export interface RuleEngineResult {
  zkongItemPayload: Record<string, unknown>;
  computedPrice: number;
  bidirectionalSyncTriggered: boolean;
  actionsTaken: string[];
}

export class RuleEngine {
  /**
   * Evaluates normalized POS item data, applies field mappings and sync rules,
   * dispatches sync to Zkong and optional bidirectional write-back to POS.
   */
  static async processItemSync(
    item: NormalizedPosItem,
    integration: IntegrationRow,
    posAdapter: IPosAdapter
  ): Promise<RuleEngineResult> {
    const fieldMappings = integration.field_mappings || {};
    const syncRules = integration.sync_rules || [];
    const actionsTaken: string[] = [];

    // 1. Compute values based on trigger rules
    let effectivePrice = item.price;
    let bidirectionalRequired = false;

    for (const rule of syncRules) {
      if (!rule || !rule.trigger) continue;

      const trigger = rule.trigger.toLowerCase();
      if (trigger.includes("vat") && item.vatPercentage && item.vatPercentage > 0) {
        effectivePrice = item.calculatedFinalPrice ?? Math.round(item.price * (1 + item.vatPercentage / 100));
        actionsTaken.push(`Applied rule '${rule.trigger}': Final price ${effectivePrice}`);
        if (rule.actionType === "bidirectional") {
          bidirectionalRequired = true;
        }
      } else if (trigger.includes("discount") && item.discountPercentage && item.discountPercentage > 0) {
        effectivePrice = Math.round(item.price * (1 - item.discountPercentage / 100));
        actionsTaken.push(`Applied rule '${rule.trigger}': Discounted price ${effectivePrice}`);
        if (rule.actionType === "bidirectional") {
          bidirectionalRequired = true;
        }
      }
    }

    // 2. Build Zkong item payload using field_mappings
    // Defaults if mapping not explicitly set
    const barcodeField = fieldMappings["barCode"] || "sku";
    const titleField = fieldMappings["itemTitle"] || "name";
    const priceField = fieldMappings["price"] || "calculated_final_price";

    const resolvePosVal = (key: string): unknown => {
      if (key === "calculated_final_price") return effectivePrice;
      if (key === "price") return item.price;
      if (key === "name") return item.name;
      if (key === "sku") return item.sku || item.code || item.id;
      if (key === "code") return item.code || item.sku || item.id;
      if (key === "vat_percentage") return item.vatPercentage;
      return (item.raw as Record<string, unknown>)[key];
    };

    const barCode = String(resolvePosVal(barcodeField) || item.sku || item.code || item.id);
    const itemTitle = String(resolvePosVal(titleField) || item.name || barCode);
    const zkongPrice = resolvePosVal(priceField) ?? effectivePrice;

    const zkongPayload: Record<string, unknown> = {
      barCode,
      itemTitle,
      price: String(zkongPrice),
      attrCategory: "default",
      attrName: "default",
      productCode: item.code || "",
      productSku: item.sku || "",
    };

    // Map any custom mapped fields to Zkong payload
    for (const [zkKey, posKey] of Object.entries(fieldMappings)) {
      if (zkKey === "barCode" || zkKey === "itemTitle" || zkKey === "price") continue;
      const val = resolvePosVal(posKey);
      if (val !== undefined && val !== null) {
        zkongPayload[zkKey] = String(val);
      }
    }

    // 3. Dispatch to Zkong
    await ZkongService.importItems([zkongPayload], integration.zkong_configuration);
    actionsTaken.push(`Pushed to Zkong with barcode=${barCode}, price=${zkongPrice}`);

    // 4. Dispatch bi-directional write-back if required
    let bidirectionalSyncTriggered = false;
    if (bidirectionalRequired && effectivePrice !== item.price) {
      try {
        await posAdapter.updateItemField(
          item.id,
          "price",
          effectivePrice,
          integration.pos_configuration
        );
        bidirectionalSyncTriggered = true;
        actionsTaken.push(`Bi-directional sync: wrote updated price ${effectivePrice} back to POS`);
      } catch (err) {
        console.error("[rule-engine] bidirectional POS update failed:", (err as Error).message);
        actionsTaken.push(`Failed bi-directional sync to POS: ${(err as Error).message}`);
      }
    }

    return {
      zkongItemPayload: zkongPayload,
      computedPrice: effectivePrice,
      bidirectionalSyncTriggered,
      actionsTaken,
    };
  }
}
