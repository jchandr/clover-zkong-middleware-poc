import { Request, Response } from "express";
import { IntegrationsRepo, IntegrationStatus } from "../../db/models/integration";
import { PosAdapterRegistry } from "../../adapters";
import { RuleEngine } from "../../engine/RuleEngine";
import { ZkongService } from "../../services/ZkongService";

export async function handleDynamicWebhook(req: Request, res: Response): Promise<void> {
  const integrationId = Array.isArray(req.params.integrationId)
    ? req.params.integrationId[0]
    : req.params.integrationId;

  if (!integrationId) {
    res.status(400).json({ error: "Missing integrationId in URL path" });
    return;
  }

  const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
  if (!integration) {
    console.warn(`[dynamic-webhook] Integration not found: ${integrationId}`);
    res.status(404).json({ error: "Integration not found" });
    return;
  }

  const adapter = PosAdapterRegistry.get(integration.selected_pos);
  const event = adapter.parseWebhook(req.body || {}, req.headers);

  // 1. Handle Clover Verification Handshake during onboarding setup
  if (event.eventType === "VERIFICATION" && event.verificationCode) {
    console.log(`[dynamic-webhook] Received verificationCode for ${integrationId}: ${event.verificationCode}`);

    // Persist received auth/verification code into pos_configuration
    const currentPosConfig = integration.pos_configuration || {};
    currentPosConfig.cloverAuthToken = event.verificationCode;

    await IntegrationsRepo.update(integrationId, {
      pos_configuration: currentPosConfig,
    });

    res.status(200).json({ received: true, verified: true });
    return;
  }

  // Also check if Clover sent header with static auth code during setup or live
  const cloverAuthHeader = req.header("X-Clover-Auth");
  if (cloverAuthHeader && !integration.pos_configuration.cloverAuthToken) {
    const currentPosConfig = integration.pos_configuration || {};
    currentPosConfig.cloverAuthToken = cloverAuthHeader;
    await IntegrationsRepo.update(integrationId, {
      pos_configuration: currentPosConfig,
    });
  }

  // 2. Auth verification: must match configured auth code
  if (!adapter.verifyAuth(req.headers, integration.pos_configuration)) {
    console.warn(`[dynamic-webhook] Auth verification failed for ${integrationId}`);
    res.status(401).json({ error: "Unauthorized webhook" });
    return;
  }

  // Acknowledge webhook immediately
  res.status(200).json({ received: true });

  // 3. Process execution if status is LIVE
  if (integration.status !== IntegrationStatus.LIVE) {
    console.log(
      `[dynamic-webhook] Integration ${integrationId} status is ${integration.status} (not LIVE). Acknowledged but skipped processing.`
    );
    return;
  }

  // Run async processing
  void (async () => {
    try {
      if (event.eventType === "DELETE" && event.itemId) {
        console.log(`[dynamic-webhook] Processing DELETE for item ${event.itemId}`);
        await ZkongService.deleteItems([event.itemId], integration.zkong_configuration);
        return;
      }

      if ((event.eventType === "CREATE" || event.eventType === "UPDATE") && event.itemId) {
        console.log(`[dynamic-webhook] Fetching item ${event.itemId} via ${integration.selected_pos}`);
        const posItem = await adapter.getItem(event.itemId, integration.pos_configuration);

        console.log(`[dynamic-webhook] Processing item ${posItem.name} (${posItem.id}) through RuleEngine`);
        const result = await RuleEngine.processItemSync(posItem, integration, adapter);

        console.log(
          `[dynamic-webhook] Sync complete for ${posItem.id}. Actions: ${result.actionsTaken.join(" | ")}`
        );
      }
    } catch (err) {
      console.error(`[dynamic-webhook] Error processing webhook for ${integrationId}:`, err);
    }
  })();
}
