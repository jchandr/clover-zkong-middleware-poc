import { Router, Request, Response } from "express";
import { IntegrationsRepo, IntegrationStatus } from "../db/models/integration";

export const integrationsManagementRouter = Router();

// List integrations with search, filters, pagination
integrationsManagementRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { search, pos, status, page, limit, includeDeleted } = req.query;

    const result = await IntegrationsRepo.findAll({
      search: typeof search === "string" ? search : undefined,
      pos: typeof pos === "string" ? pos : undefined,
      status: typeof status === "string" ? parseInt(status, 10) : undefined,
      page: typeof page === "string" ? parseInt(page, 10) : 1,
      limit: typeof limit === "string" ? parseInt(limit, 10) : 20,
      includeDeleted: includeDeleted === "true" || includeDeleted === "1",
    });

    res.status(200).json({
      success: true,
      data: result.list,
      total: result.total,
      page: typeof page === "string" ? parseInt(page, 10) : 1,
      limit: typeof limit === "string" ? parseInt(limit, 10) : 20,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get single integration detail
integrationsManagementRouter.get("/:integrationId", async (req: Request, res: Response) => {
  try {
    const integrationId = Array.isArray(req.params.integrationId)
      ? req.params.integrationId[0]
      : req.params.integrationId;

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

// Status state transition action
integrationsManagementRouter.patch("/:integrationId/status", async (req: Request, res: Response) => {
  try {
    const integrationId = Array.isArray(req.params.integrationId)
      ? req.params.integrationId[0]
      : req.params.integrationId;

    const { action } = req.body;

    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    let targetStatus: IntegrationStatus;

    switch (action) {
      case "live":
        if (
          integration.status !== IntegrationStatus.CONFIG_VERIFIED &&
          integration.status !== IntegrationStatus.PAUSED
        ) {
          res.status(400).json({
            error: `Cannot go LIVE from status ${integration.status}. Must be CONFIG_VERIFIED (1) or PAUSED (2).`,
          });
          return;
        }
        targetStatus = IntegrationStatus.LIVE;
        break;

      case "pause":
        if (integration.status !== IntegrationStatus.LIVE) {
          res.status(400).json({
            error: `Cannot PAUSE from status ${integration.status}. Must be LIVE (3).`,
          });
          return;
        }
        targetStatus = IntegrationStatus.PAUSED;
        break;

      case "delete":
        targetStatus = IntegrationStatus.DELETED;
        break;

      case "restore":
        if (integration.status !== IntegrationStatus.DELETED) {
          res.status(400).json({
            error: `Cannot RESTORE from status ${integration.status}. Must be DELETED (-1).`,
          });
          return;
        }
        targetStatus = IntegrationStatus.PAUSED;
        break;

      case "verify":
        targetStatus = IntegrationStatus.CONFIG_VERIFIED;
        break;

      default:
        res.status(400).json({
          error: "Invalid action. Supported actions: 'live', 'pause', 'delete', 'restore', 'verify'",
        });
        return;
    }

    const updated = await IntegrationsRepo.updateStatus(integrationId, targetStatus);
    res.status(200).json({
      success: true,
      action,
      previousStatus: integration.status,
      currentStatus: targetStatus,
      integration: updated,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Soft delete integration
integrationsManagementRouter.delete("/:integrationId", async (req: Request, res: Response) => {
  try {
    const integrationId = Array.isArray(req.params.integrationId)
      ? req.params.integrationId[0]
      : req.params.integrationId;

    const updated = await IntegrationsRepo.softDelete(integrationId);
    if (!updated) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }
    res.status(200).json({
      success: true,
      message: "Integration soft-deleted successfully",
      integration: updated,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Update integration configuration (field mappings, sync rules, etc.)
// Only allowed when integration is NOT LIVE
integrationsManagementRouter.patch("/:integrationId/config", async (req: Request, res: Response) => {
  try {
    const integrationId = Array.isArray(req.params.integrationId)
      ? req.params.integrationId[0]
      : req.params.integrationId;

    const { field_mappings, sync_rules, pos_configuration, zkong_configuration, registering_business_name, registering_business_email } = req.body;

    const integration = await IntegrationsRepo.findByIntegrationId(integrationId);
    if (!integration) {
      res.status(404).json({ error: "Integration not found" });
      return;
    }

    // Prevent editing LIVE integrations
    if (integration.status === 3 /* LIVE */) {
      res.status(400).json({
        error: "Cannot edit LIVE integration. Please pause the integration first.",
        currentStatus: integration.status,
        requiredAction: "pause"
      });
      return;
    }

    // POS type cannot be changed after onboarding
    if (pos_configuration && pos_configuration.posType && pos_configuration.posType !== integration.selected_pos) {
      res.status(400).json({
        error: "POS type cannot be changed after onboarding. It is fixed during initial setup."
      });
      return;
    }

    const updateData: Partial<typeof integration> = {};

    if (field_mappings !== undefined) updateData.field_mappings = field_mappings;
    if (sync_rules !== undefined) updateData.sync_rules = sync_rules;
    if (pos_configuration !== undefined) updateData.pos_configuration = { ...integration.pos_configuration, ...pos_configuration };
    if (zkong_configuration !== undefined) updateData.zkong_configuration = { ...integration.zkong_configuration, ...zkong_configuration };
    if (registering_business_name !== undefined) updateData.registering_business_name = registering_business_name;
    if (registering_business_email !== undefined) updateData.registering_business_email = registering_business_email;

    const updated = await IntegrationsRepo.update(integrationId, updateData);

    res.status(200).json({
      success: true,
      message: "Integration configuration updated",
      integration: updated,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
