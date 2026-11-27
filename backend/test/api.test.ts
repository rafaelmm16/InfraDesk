import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildApp } from "../src/app.ts";
import { hashPassword, signJwt, verifyJwt, verifyPassword } from "../src/security.ts";
import { computeSlaDueAt, evaluateSla } from "../src/sla.ts";

describe("Security & SLA Core Primitives", () => {
  it("hashes and verifies passwords with scrypt timing-safe check", () => {
    const hash = hashPassword("StrongPass#2026");
    assert.equal(verifyPassword("StrongPass#2026", hash), true);
    assert.equal(verifyPassword("WrongPass", hash), false);
  });

  it("signs and verifies HS256 JWT tokens and rejects tampered tokens", () => {
    const secret = "unit-test-secret";
    const token = signJwt(
      { sub: "u1", email: "rafael@test.dev", name: "Rafael", role: "admin" },
      secret,
      300
    );
    const decoded = verifyJwt(token, secret);
    assert.ok(decoded);
    assert.equal(decoded.role, "admin");
    assert.equal(verifyJwt(`${token}tampered`, secret), null);
    assert.equal(verifyJwt(token, "wrong-secret"), null);
  });

  it("evaluates SLA states accurately across lifecycle", () => {
    const created = new Date("2026-11-27T10:00:00.000Z");
    const due = computeSlaDueAt("critical", created); // +2h -> 12:00

    const onTrack = evaluateSla(
      {
        priority: "critical",
        status: "open",
        createdAt: created.toISOString(),
        slaDueAt: due,
        resolvedAt: null,
      },
      new Date("2026-11-27T10:30:00.000Z")
    );
    assert.equal(onTrack.slaState, "on_track");

    const atRisk = evaluateSla(
      {
        priority: "critical",
        status: "in_progress",
        createdAt: created.toISOString(),
        slaDueAt: due,
        resolvedAt: null,
      },
      new Date("2026-11-27T11:40:00.000Z") // 20m remaining out of 120m (<25%)
    );
    assert.equal(atRisk.slaState, "at_risk");

    const breached = evaluateSla(
      {
        priority: "critical",
        status: "open",
        createdAt: created.toISOString(),
        slaDueAt: due,
        resolvedAt: null,
      },
      new Date("2026-11-27T12:15:00.000Z")
    );
    assert.equal(breached.slaState, "breached");
  });
});

describe("InfraDesk Fastify API, RBAC, Telemetry & AD Sync", () => {
  it("enforces JWT authentication and RBAC write restrictions for viewer role", async () => {
    const { app } = await buildApp({
      dbPath: ":memory:",
      jwtSecret: "test-jwt",
      agentApiKey: "test-agent-key",
      seed: true,
    });

    // Unauthenticated request -> 401
    const unauth = await app.inject({ method: "GET", url: "/api/assets" });
    assert.equal(unauth.statusCode, 401);

    // Login as viewer (auditor)
    const viewerLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "auditor@infradesk.dev", password: "Audit@2026" },
    });
    assert.equal(viewerLogin.statusCode, 200);
    const { token: viewerToken } = viewerLogin.json<{ token: string }>();

    // Viewer can read summary & assets
    const readSummary = await app.inject({
      method: "GET",
      url: "/api/dashboard/summary",
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    assert.equal(readSummary.statusCode, 200);

    // Viewer CANNOT create tickets -> 403 FORBIDDEN
    const forbiddenCreate = await app.inject({
      method: "POST",
      url: "/api/tickets",
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        title: "Teste sem permissao",
        description: "Tentativa bloqueada pelo RBAC",
        category: "security",
        priority: "medium",
        requesterName: "Auditor",
        requesterDepartment: "Compliance",
      },
    });
    assert.equal(forbiddenCreate.statusCode, 403);

    await app.close();
  });

  it("ingests agent telemetry with X-Agent-Key and triggers automatic SLA ticket on critical load", async () => {
    const { app } = await buildApp({
      dbPath: ":memory:",
      jwtSecret: "test-jwt",
      agentApiKey: "test-agent-key",
      seed: false,
    });

    const ingestRes = await app.inject({
      method: "POST",
      url: "/api/telemetry/ingest",
      headers: { "x-agent-key": "test-agent-key" },
      payload: {
        hostname: "wks-test-99",
        adOu: "OU=TI,DC=corp,DC=local",
        department: "TI",
        ipAddress: "10.0.0.99",
        cpuPercent: 96.4,
        ramPercent: 88.0,
        diskPercent: 95.2,
        idleMinutes: 0,
        uptimeHours: 12.5,
        loggedUser: "rafael.merlo",
        topProcesses: ["node", "docker"],
      },
    });

    assert.equal(ingestRes.statusCode, 201);
    const body = ingestRes.json<{
      asset: { hostname: string; status: string };
      autoTicket: { code: string; priority: string } | null;
    }>();

    assert.equal(body.asset.hostname, "WKS-TEST-99");
    assert.equal(body.asset.status, "warning");
    assert.ok(body.autoTicket, "Expected automatic critical SLA ticket to be created");
    assert.equal(body.autoTicket.priority, "critical");

    const metricsRes = await app.inject({ method: "GET", url: "/metrics" });
    assert.equal(metricsRes.statusCode, 200);
    assert.match(metricsRes.body, /infradesk_endpoints_total\{status="warning"\} 1/);

    await app.close();
  });

  it("performs idempotent Active Directory OU batch synchronization", async () => {
    const { app } = await buildApp({
      dbPath: ":memory:",
      jwtSecret: "test-jwt",
      agentApiKey: "test-agent-key",
      seed: false,
    });

    const batchPayload = {
      domain: "corp.infradesk.local",
      computers: [
        {
          hostname: "WKS-AD-01",
          adOu: "OU=Financeiro,DC=corp,DC=local",
          department: "Financeiro",
          ipAddress: "10.20.0.10",
          osName: "Windows 11 Pro",
          osVersion: "24H2",
          cpuModel: "Intel Core i5",
          ramTotalGb: 16,
          diskTotalGb: 512,
          loggedUser: "ana.silva",
        },
      ],
    };

    const firstSync = await app.inject({
      method: "POST",
      url: "/api/assets/sync-ad",
      headers: { "x-agent-key": "test-agent-key" },
      payload: batchPayload,
    });
    assert.equal(firstSync.statusCode, 200);
    assert.equal(firstSync.json<{ created: number; updated: number }>().created, 1);

    const secondSync = await app.inject({
      method: "POST",
      url: "/api/assets/sync-ad",
      headers: { "x-agent-key": "test-agent-key" },
      payload: batchPayload,
    });
    assert.equal(secondSync.statusCode, 200);
    assert.equal(secondSync.json<{ created: number; updated: number }>().updated, 1);

    await app.close();
  });
});
