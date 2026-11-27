import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { ZodError } from "zod";
import { InfraDeskStore } from "./db.ts";
import {
  AdSyncBatchSchema,
  AssetCreateSchema,
  AssetUpdateSchema,
  LoginSchema,
  TelemetryIngestSchema,
  TicketCommentCreateSchema,
  TicketCreateSchema,
  TicketUpdateSchema,
} from "./schemas.ts";
import { signJwt, verifyJwt, type JwtClaims } from "./security.ts";
import type { Role, WsEvent } from "./types.ts";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: JwtClaims;
  }
}

export interface AppConfig {
  dbPath?: string;
  jwtSecret?: string;
  agentApiKey?: string;
  seed?: boolean;
  logger?: boolean;
}

export async function buildApp(config: AppConfig = {}): Promise<{
  app: FastifyInstance;
  store: InfraDeskStore;
}> {
  const jwtSecret =
    config.jwtSecret || process.env.JWT_SECRET || "infradesk-dev-jwt-secret-change-in-prod";
  const agentApiKey =
    config.agentApiKey || process.env.AGENT_API_KEY || "idk_live_agent_9f8e7d6c5b4a";

  const store = new InfraDeskStore(config.dbPath ?? ":memory:", {
    seed: config.seed ?? true,
  });

  const app = Fastify({ logger: config.logger ?? false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(websocket);

  const wsClients = new Set<WebSocket>();

  function broadcast(event: WsEvent): void {
    const raw = JSON.stringify(event);
    for (const client of wsClients) {
      if (client.readyState === 1) {
        client.send(raw);
      }
    }
  }

  app.addHook("onClose", async () => {
    for (const client of wsClients) {
      client.close();
    }
    wsClients.clear();
    store.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "Dados inválidos na requisição.",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message = error instanceof Error ? error.message : "Erro interno no servidor.";
    return reply.status(statusCode).send({ error: "SERVER_ERROR", message });
  });

  function extractBearerClaims(request: FastifyRequest): JwtClaims | null {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    return verifyJwt(token, jwtSecret);
  }

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const claims = extractBearerClaims(request);
    if (!claims) {
      reply.status(401).send({
        error: "UNAUTHORIZED",
        message: "Token JWT ausente, inválido ou expirado.",
      });
      return;
    }
    request.authUser = claims;
  }

  function requireRoles(allowed: Role[]) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await requireAuth(request, reply);
      if (reply.sent || !request.authUser) return;
      if (!allowed.includes(request.authUser.role)) {
        reply.status(403).send({
          error: "FORBIDDEN",
          message: `Permissão insuficiente. Requer perfil: ${allowed.join(" ou ")}.`,
        });
      }
    };
  }

  async function requireAgentOrTech(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const providedAgentKey = request.headers["x-agent-key"];
    if (typeof providedAgentKey === "string" && providedAgentKey === agentApiKey) {
      request.authUser = {
        sub: "agent",
        email: "agent@infradesk.local",
        name: "InfraDesk Endpoint Agent",
        role: "technician",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      };
      return;
    }

    const claims = extractBearerClaims(request);
    if (claims && (claims.role === "admin" || claims.role === "technician")) {
      request.authUser = claims;
      return;
    }

    reply.status(401).send({
      error: "UNAUTHORIZED_AGENT",
      message: "Forneça um header X-Agent-Key válido ou Bearer token com perfil técnico/admin.",
    });
  }

  // Health & Observability (Prometheus OpenMetrics)
  app.get("/api/health", async () => ({
    status: "ok",
    service: "infradesk-backend",
    timestamp: new Date().toISOString(),
  }));

  app.get("/metrics", async (_req, reply) => {
    const summary = store.getDashboardSummary();
    const lines = [
      "# HELP infradesk_endpoints_total Total managed endpoints by status",
      "# TYPE infradesk_endpoints_total gauge",
      `infradesk_endpoints_total{status="online"} ${summary.fleet.online}`,
      `infradesk_endpoints_total{status="idle"} ${summary.fleet.idle}`,
      `infradesk_endpoints_total{status="warning"} ${summary.fleet.warning}`,
      `infradesk_endpoints_total{status="offline"} ${summary.fleet.offline}`,
      `infradesk_endpoints_total{status="maintenance"} ${summary.fleet.maintenance}`,
      "# HELP infradesk_fleet_cpu_avg_percent Average CPU usage across endpoints",
      "# TYPE infradesk_fleet_cpu_avg_percent gauge",
      `infradesk_fleet_cpu_avg_percent ${summary.fleet.avgCpuPercent}`,
      "# HELP infradesk_tickets_active_total Active ITSM tickets",
      "# TYPE infradesk_tickets_active_total gauge",
      `infradesk_tickets_active_total ${summary.tickets.totalActive}`,
      "# HELP infradesk_sla_compliance_percent SLA compliance percentage",
      "# TYPE infradesk_sla_compliance_percent gauge",
      `infradesk_sla_compliance_percent ${summary.tickets.slaCompliancePercent}`,
    ];
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return lines.join("\n") + "\n";
  });

  // Real-Time WebSocket Stream
  app.get("/api/ws", { websocket: true }, (socket) => {
    wsClients.add(socket);
    socket.on("close", () => {
      wsClients.delete(socket);
    });
  });

  // Authentication & RBAC Session
  app.post("/api/auth/login", async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    const user = store.authenticateUser(body.email, body.password);
    if (!user) {
      return reply.status(401).send({
        error: "INVALID_CREDENTIALS",
        message: "E-mail ou senha inválidos.",
      });
    }

    const token = signJwt(
      { sub: user.id, email: user.email, name: user.name, role: user.role },
      jwtSecret
    );

    store.recordAudit({
      actorName: user.name,
      actorEmail: user.email,
      actorRole: user.role,
      action: "USER_LOGIN",
      entityType: "auth",
      entityId: user.id,
      summary: `Sessão autenticada via JWT (${user.role}).`,
      ipAddress: request.ip,
    });

    return { token, user };
  });

  app.get("/api/auth/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const user = store.getUserById(request.authUser!.sub);
    if (!user) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Usuário não encontrado." });
    }
    return { user };
  });

  app.get("/api/users", { preHandler: [requireAuth] }, async () => ({
    users: store.listUsers(),
  }));

  // Executive & Operational Dashboard Summary
  app.get("/api/dashboard/summary", { preHandler: [requireAuth] }, async () =>
    store.getDashboardSummary()
  );

  // CMDB Assets & Active Directory Sync
  app.get("/api/assets", { preHandler: [requireAuth] }, async (request) => {
    const query = request.query as { status?: string; adOu?: string; search?: string };
    return { assets: store.listAssets(query) };
  });

  app.get("/api/assets/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = store.getAssetById(id);
    if (!asset) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Ativo não encontrado." });
    }
    const telemetry = store.listAssetTelemetry(id, 24);
    const tickets = store.listTickets({ assetId: id });
    return { asset, telemetry, tickets };
  });

  app.post(
    "/api/assets",
    { preHandler: [requireRoles(["admin", "technician"])] },
    async (request, reply) => {
      const input = AssetCreateSchema.parse(request.body);
      try {
        const asset = store.createAsset(input);
        const actor = request.authUser!;
        store.recordAudit({
          actorName: actor.name,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: "ASSET_CREATED",
          entityType: "asset",
          entityId: asset.id,
          summary: `Ativo ${asset.hostname} (${asset.assetTag}) cadastrado em ${asset.adOu}.`,
          ipAddress: request.ip,
        });
        return reply.status(201).send({ asset });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("UNIQUE")) {
          return reply.status(409).send({
            error: "CONFLICT",
            message: "Já existe um ativo com este hostname ou patrimônio.",
          });
        }
        throw err;
      }
    }
  );

  app.patch(
    "/api/assets/:id",
    { preHandler: [requireRoles(["admin", "technician"])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const patch = AssetUpdateSchema.parse(request.body);
      const asset = store.updateAsset(id, patch);
      if (!asset) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Ativo não encontrado." });
      }
      const actor = request.authUser!;
      store.recordAudit({
        actorName: actor.name,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "ASSET_UPDATED",
        entityType: "asset",
        entityId: asset.id,
        summary: `Inventário atualizado para ${asset.hostname} (status: ${asset.status}).`,
        ipAddress: request.ip,
      });
      return { asset };
    }
  );

  app.delete(
    "/api/assets/:id",
    { preHandler: [requireRoles(["admin"])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = store.getAssetById(id);
      if (!existing) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Ativo não encontrado." });
      }
      store.deleteAsset(id);
      const actor = request.authUser!;
      store.recordAudit({
        actorName: actor.name,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "ASSET_DELETED",
        entityType: "asset",
        entityId: id,
        summary: `Ativo ${existing.hostname} removido do CMDB.`,
        ipAddress: request.ip,
      });
      return reply.status(204).send();
    }
  );

  app.post(
    "/api/assets/sync-ad",
    { preHandler: [requireAgentOrTech] },
    async (request) => {
      const batch = AdSyncBatchSchema.parse(request.body);
      const result = store.syncActiveDirectoryBatch(batch);
      const actor = request.authUser!;
      store.recordAudit({
        actorName: actor.name,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "AD_OU_SYNC",
        entityType: "ad_sync",
        entityId: batch.domain,
        summary: `Sincronização Active Directory (${batch.domain}): ${result.created} criados, ${result.updated} atualizados.`,
        ipAddress: request.ip,
      });
      broadcast({
        type: "asset.synced",
        timestamp: new Date().toISOString(),
        payload: { created: result.created, updated: result.updated },
      });
      return result;
    }
  );

  // Endpoint Telemetry Ingestion (Idlewatch v2 Engine)
  app.post(
    "/api/telemetry/ingest",
    { preHandler: [requireAgentOrTech] },
    async (request, reply) => {
      const payload = TelemetryIngestSchema.parse(request.body);
      const result = store.ingestTelemetry(payload);

      if (result.autoTicket) {
        store.recordAudit({
          actorName: "InfraDesk Telemetry Engine",
          actorEmail: "telemetry@infradesk.local",
          actorRole: "system",
          action: "AUTO_TICKET_TRIGGERED",
          entityType: "ticket",
          entityId: result.autoTicket.id,
          summary: `Chamado automático ${result.autoTicket.code} aberto por saturação em ${result.asset.hostname}.`,
          ipAddress: request.ip,
        });
        broadcast({
          type: "ticket.created",
          timestamp: new Date().toISOString(),
          payload: result.autoTicket,
        });
      }

      broadcast({
        type: "telemetry.ingested",
        timestamp: new Date().toISOString(),
        payload: { asset: result.asset, sample: result.sample },
      });

      return reply.status(201).send(result);
    }
  );

  // ITSM Service Desk & SLA Engine
  app.get("/api/tickets", { preHandler: [requireAuth] }, async (request) => {
    const query = request.query as {
      status?: string;
      priority?: string;
      assetId?: string;
      search?: string;
    };
    return { tickets: store.listTickets(query) };
  });

  app.get("/api/tickets/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ticket = store.getTicketById(id);
    if (!ticket) {
      return reply.status(404).send({ error: "NOT_FOUND", message: "Chamado não encontrado." });
    }
    const comments = store.listTicketComments(id);
    return { ticket, comments };
  });

  app.post(
    "/api/tickets",
    { preHandler: [requireRoles(["admin", "technician"])] },
    async (request, reply) => {
      const input = TicketCreateSchema.parse(request.body);
      const ticket = store.createTicket(input);
      const actor = request.authUser!;
      store.recordAudit({
        actorName: actor.name,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "TICKET_CREATED",
        entityType: "ticket",
        entityId: ticket.id,
        summary: `Chamado ${ticket.code} (${ticket.priority}) criado: "${ticket.title}".`,
        ipAddress: request.ip,
      });
      broadcast({
        type: "ticket.created",
        timestamp: new Date().toISOString(),
        payload: ticket,
      });
      return reply.status(201).send({ ticket });
    }
  );

  app.patch(
    "/api/tickets/:id",
    { preHandler: [requireRoles(["admin", "technician"])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const patch = TicketUpdateSchema.parse(request.body);
      const ticket = store.updateTicket(id, patch);
      if (!ticket) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Chamado não encontrado." });
      }
      const actor = request.authUser!;
      store.recordAudit({
        actorName: actor.name,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: "TICKET_UPDATED",
        entityType: "ticket",
        entityId: ticket.id,
        summary: `Chamado ${ticket.code} atualizado (status: ${ticket.status}, prioridade: ${ticket.priority}).`,
        ipAddress: request.ip,
      });
      broadcast({
        type: "ticket.updated",
        timestamp: new Date().toISOString(),
        payload: ticket,
      });
      return { ticket };
    }
  );

  app.post(
    "/api/tickets/:id/comments",
    { preHandler: [requireRoles(["admin", "technician"])] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const existing = store.getTicketById(id);
      if (!existing) {
        return reply.status(404).send({ error: "NOT_FOUND", message: "Chamado não encontrado." });
      }
      const body = TicketCommentCreateSchema.parse(request.body);
      const actor = request.authUser!;
      const comment = store.addTicketComment({
        ticketId: id,
        authorName: actor.name,
        authorRole: actor.role,
        body: body.body,
        internal: body.internal,
      });
      return reply.status(201).send({ comment });
    }
  );

  // Governance & Audit Trail
  app.get("/api/audit-logs", { preHandler: [requireAuth] }, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(200, Math.max(10, Number(query.limit) || 60));
    return { logs: store.listAuditLogs(limit) };
  });

  return { app, store };
}
