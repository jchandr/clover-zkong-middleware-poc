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
