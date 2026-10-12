import { Router, Request, Response } from "express";
import * as crypto from "crypto";
import axios from "axios";
import { IntegrationsRepo, IntegrationStatus, CloverPosConfig, ZkongConfig } from "../db/models/integration";
import { PosAdapterRegistry } from "../adapters";
import { ZkongService } from "../services/ZkongService";

export const onboardingRouter = Router();

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || "";
  return param || "";
}

// STEP 1 & 2: Create Integration
onboardingRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const { businessName, businessEmail, selectedPos } = req.body;

    if (!businessName || !businessEmail) {
      res.status(400).json({ error: "businessName and businessEmail are required" });
      return;
    }

    const pos = (selectedPos || "clover").toLowerCase();
    const integrationId = crypto.randomUUID();

    const integration = await IntegrationsRepo.create({
      integration_id: integrationId,
      registering_business_name: businessName,
      registering_business_email: businessEmail,
      selected_pos: pos,
      status: IntegrationStatus.PENDING_SETUP,
    });

    res.status(201).json({
      success: true,
      integrationId: integration.integration_id,
      webhookUrl: `/webhooks/${integration.integration_id}`,
      integration,
    });
  } catch (err) {
    console.error("[onboarding/create] error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get single integration state
onboardingRouter.get("/:integrationId", async (req: Request, res: Response) => {
  try {
    const integrationId = getParam(req.params.integrationId);
    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    res.status(200).json({ success: true, integration });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// STEP 3: Save & Verify POS Configuration
onboardingRouter.post("/:integrationId/pos-config", async (req: Request, res: Response) => {
  try {
    const integrationId = getParam(req.params.integrationId);
    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    const { apiBaseUrl, merchantId, clientAppId, apiToken, cloverAuthToken } = req.body;
    const posConfig: CloverPosConfig = {
      apiBaseUrl: apiBaseUrl ? String(apiBaseUrl).replace(/\/$/, "") : "https://sandbox.dev.clover.com/v3/merchants",
      merchantId: merchantId ? String(merchantId).trim() : undefined,
      clientAppId: clientAppId ? String(clientAppId).trim() : undefined,
      apiToken: apiToken ? String(apiToken).trim() : undefined,
      cloverAuthToken: cloverAuthToken ? String(cloverAuthToken).trim() : integration.pos_configuration?.cloverAuthToken,
    };

    const updated = await IntegrationsRepo.update(integrationId, {
      pos_configuration: posConfig,
    });

    res.status(200).json({
      success: true,
      integration: updated,
      webhookUrl: `/webhooks/${integrationId}`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Refresh Auth Token from DB (Webhook handshake result)
onboardingRouter.get("/:integrationId/pos-auth-token", async (req: Request, res: Response) => {
  try {
    const integrationId = getParam(req.params.integrationId);
    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    const token = integration.pos_configuration?.cloverAuthToken || "";
    res.status(200).json({ success: true, cloverAuthToken: token });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Verify Clover API Token / Connection
onboardingRouter.post("/:integrationId/verify-pos", async (req: Request, res: Response) => {
  try {
    const integrationId = getParam(req.params.integrationId);
    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    const posConfig = integration.pos_configuration;
    if (!posConfig.merchantId || !posConfig.apiToken) {
      res.status(400).json({ error: "Clover Merchant ID and API Token are required for verification" });
      return;
    }

    const apiBase = (posConfig.apiBaseUrl || "https://sandbox.dev.clover.com/v3/merchants").replace(/\/$/, "");
    const testUrl = `${apiBase}/${posConfig.merchantId}/items?limit=1`;

    const response = await axios.get(testUrl, {
      headers: {
        Authorization: `Bearer ${posConfig.apiToken}`,
        Accept: "application/json",
      },
      timeout: 10_000,
    });

    res.status(200).json({
      success: true,
      verified: true,
      message: "Clover connection verified successfully",
      itemCount: response.data?.elements?.length ?? 0,
    });
  } catch (err) {
    console.error("[verify-pos] failed:", err);
    res.status(400).json({
      success: false,
      verified: false,
      error: `Clover verification failed: ${(err as Error).message}`,
    });
  }
});

// STEP 4: Save & Verify Zkong Configuration + Pull Schemas
onboardingRouter.post("/:integrationId/zkong-config", async (req: Request, res: Response) => {
  try {
    const integrationId = getParam(req.params.integrationId);
    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    const { account, password, merchantId, agencyId, storeId, apiBase } = req.body;
    const zkongConfig: ZkongConfig = {
      account: account ? String(account).trim() : "",
      password: password ? String(password).trim() : "",
      merchantId: merchantId ? String(merchantId).trim() : "",
      agencyId: agencyId ? String(agencyId).trim() : "",
      storeId: storeId ? String(storeId).trim() : "",
      apiBase: apiBase ? String(apiBase).trim() : "https://esl-eu.zkong.com",
    };

    // Authenticate and pull supported fields
    await ZkongService.authenticate(zkongConfig);
    const zkongFields = await ZkongService.fetchSupportedFields(zkongConfig);

    // Get POS schema fields
    const adapter = PosAdapterRegistry.get(integration.selected_pos);
    const posFields = adapter.getSchemaFields();

    // Mark status as CONFIG_VERIFIED (1) if POS credentials exist
    const newStatus = integration.pos_configuration?.apiToken 
      ? IntegrationStatus.CONFIG_VERIFIED 
      : integration.status;

    const updated = await IntegrationsRepo.update(integrationId, {
      zkong_configuration: zkongConfig,
      status: newStatus,
    });

    res.status(200).json({
      success: true,
      verified: true,
      integration: updated,
      zkongFields,
      posFields,
    });
  } catch (err) {
    console.error("[zkong-config] failed:", err);
    res.status(400).json({
      success: false,
      error: `Zkong verification failed: ${(err as Error).message}`,
    });
  }
});

// STEP 5: Save Field Mappings and Automation Rules -> Set Status LIVE
onboardingRouter.post("/:integrationId/complete", async (req: Request, res: Response) => {
  try {
    const integrationId = getParam(req.params.integrationId);
    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    const { fieldMappings, syncRules } = req.body;

    const updated = await IntegrationsRepo.update(integrationId, {
      field_mappings: fieldMappings || {},
      sync_rules: syncRules || [],
      status: IntegrationStatus.LIVE, // Status 3 = LIVE
    });

    res.status(200).json({
      success: true,
      message: "Onboarding completed! Integration is now LIVE.",
      integration: updated,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
