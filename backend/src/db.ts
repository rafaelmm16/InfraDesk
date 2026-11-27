import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "./security.ts";
import { computeSlaDueAt, evaluateSla } from "./sla.ts";
import type {
  Asset,
  AssetStatus,
  AuditLog,
  DashboardSummary,
  Role,
  TelemetrySample,
  Ticket,
  TicketCategory,
  TicketComment,
  TicketPriority,
  TicketStatus,
  User,
} from "./types.ts";

interface UserRecord extends User {
  passwordHash: string;
}

export class InfraDeskStore {
  public readonly db: DatabaseSync;

  constructor(dbPath = ":memory:", options: { seed?: boolean } = { seed: true }) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();

    if (options.seed !== false) {
      this.seedIfEmpty();
    }
  }

  public close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'technician', 'viewer')),
        department TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        asset_tag TEXT NOT NULL UNIQUE,
        hostname TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL,
        ad_ou TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        mac_address TEXT NOT NULL,
        os_name TEXT NOT NULL,
        os_version TEXT NOT NULL,
        cpu_model TEXT NOT NULL,
        ram_total_gb REAL NOT NULL,
        disk_total_gb REAL NOT NULL,
        logged_user TEXT NOT NULL,
        department TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('online', 'idle', 'warning', 'offline', 'maintenance')),
        cpu_percent REAL NOT NULL DEFAULT 0,
        ram_percent REAL NOT NULL DEFAULT 0,
        disk_percent REAL NOT NULL DEFAULT 0,
        idle_minutes REAL NOT NULL DEFAULT 0,
        uptime_hours REAL NOT NULL DEFAULT 0,
        top_processes_json TEXT NOT NULL DEFAULT '[]',
        agent_version TEXT NOT NULL DEFAULT '2.0.0',
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS telemetry_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        cpu_percent REAL NOT NULL,
        ram_percent REAL NOT NULL,
        disk_percent REAL NOT NULL,
        idle_minutes REAL NOT NULL,
        uptime_hours REAL NOT NULL,
        logged_user TEXT NOT NULL,
        top_processes_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_telemetry_asset_recorded
        ON telemetry_samples(asset_id, recorded_at DESC);

      CREATE TABLE IF NOT EXISTS tickets (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
        status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting_user', 'resolved', 'closed')),
        asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        requester_name TEXT NOT NULL,
        requester_department TEXT NOT NULL,
        assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        auto_generated INTEGER NOT NULL DEFAULT 0,
        sla_due_at TEXT NOT NULL,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tickets_status_priority
        ON tickets(status, priority);

      CREATE TABLE IF NOT EXISTS ticket_comments (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        body TEXT NOT NULL,
        internal INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_name TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  private mapUser(row: Record<string, unknown>): UserRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      passwordHash: String(row.password_hash),
      role: String(row.role) as Role,
      department: String(row.department),
      createdAt: String(row.created_at),
    };
  }

  private mapAsset(row: Record<string, unknown>): Asset {
    let topProcesses: string[] = [];
    try {
      topProcesses = JSON.parse(String(row.top_processes_json || "[]")) as string[];
    } catch {
      topProcesses = [];
    }
    return {
      id: String(row.id),
      assetTag: String(row.asset_tag),
      hostname: String(row.hostname),
      domain: String(row.domain),
      adOu: String(row.ad_ou),
      ipAddress: String(row.ip_address),
      macAddress: String(row.mac_address),
      osName: String(row.os_name),
      osVersion: String(row.os_version),
      cpuModel: String(row.cpu_model),
      ramTotalGb: Number(row.ram_total_gb),
      diskTotalGb: Number(row.disk_total_gb),
      loggedUser: String(row.logged_user),
      department: String(row.department),
      status: String(row.status) as AssetStatus,
      cpuPercent: Number(row.cpu_percent),
      ramPercent: Number(row.ram_percent),
      diskPercent: Number(row.disk_percent),
      idleMinutes: Number(row.idle_minutes),
      uptimeHours: Number(row.uptime_hours),
      topProcesses,
      agentVersion: String(row.agent_version),
      lastSeenAt: String(row.last_seen_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapTicket(row: Record<string, unknown>): Ticket {
    const priority = String(row.priority) as TicketPriority;
    const status = String(row.status) as TicketStatus;
    const createdAt = String(row.created_at);
    const slaDueAt = String(row.sla_due_at);
    const resolvedAt = row.resolved_at ? String(row.resolved_at) : null;
    const { slaState, slaRemainingMinutes } = evaluateSla({
      priority,
      status,
      createdAt,
      slaDueAt,
      resolvedAt,
    });

    return {
      id: String(row.id),
      code: String(row.code),
      title: String(row.title),
      description: String(row.description),
      category: String(row.category) as TicketCategory,
      priority,
      status,
      assetId: row.asset_id ? String(row.asset_id) : null,
      assetHostname: row.asset_hostname ? String(row.asset_hostname) : null,
      requesterName: String(row.requester_name),
      requesterDepartment: String(row.requester_department),
      assigneeId: row.assignee_id ? String(row.assignee_id) : null,
      assigneeName: row.assignee_name ? String(row.assignee_name) : null,
      autoGenerated: Number(row.auto_generated) === 1,
      slaDueAt,
      resolvedAt,
      slaState,
      slaRemainingMinutes,
      createdAt,
      updatedAt: String(row.updated_at),
    };
  }

  public authenticateUser(email: string, password: string): User | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE lower(email) = lower(?)")
      .get(email) as Record<string, unknown> | undefined;
    if (!row) return null;
    const record = this.mapUser(row);
    if (!verifyPassword(password, record.passwordHash)) return null;
    const { passwordHash: _ignored, ...user } = record;
    return user;
  }

  public getUserById(id: string): User | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const { passwordHash: _ignored, ...user } = this.mapUser(row);
    return user;
  }

  public listUsers(): User[] {
    const rows = this.db
      .prepare("SELECT * FROM users ORDER BY role ASC, name ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => {
      const { passwordHash: _ignored, ...user } = this.mapUser(r);
      return user;
    });
  }

  public recordAudit(entry: {
    actorName: string;
    actorEmail: string;
    actorRole: string;
    action: string;
    entityType: AuditLog["entityType"];
    entityId: string;
    summary: string;
    ipAddress?: string;
  }): AuditLog {
    const createdAt = new Date().toISOString();
    const ipAddress = entry.ipAddress || "127.0.0.1";
    const result = this.db
      .prepare(
        `INSERT INTO audit_logs
         (actor_name, actor_email, actor_role, action, entity_type, entity_id, summary, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.actorName,
        entry.actorEmail,
        entry.actorRole,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.summary,
        ipAddress,
        createdAt
      );

    return {
      id: Number(result.lastInsertRowid),
      actorName: entry.actorName,
      actorEmail: entry.actorEmail,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      ipAddress,
      createdAt,
    };
  }

  public listAuditLogs(limit = 60): AuditLog[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      actorName: String(r.actor_name),
      actorEmail: String(r.actor_email),
      actorRole: String(r.actor_role),
      action: String(r.action),
      entityType: String(r.entity_type) as AuditLog["entityType"],
      entityId: String(r.entity_id),
      summary: String(r.summary),
      ipAddress: String(r.ip_address),
      createdAt: String(r.created_at),
    }));
  }

  public listAssets(filters?: { status?: string; adOu?: string; search?: string }): Asset[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.status && filters.status !== "all") {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.adOu && filters.adOu !== "all") {
      clauses.push("ad_ou = ?");
      params.push(filters.adOu);
    }
    if (filters?.search) {
      clauses.push(
        "(lower(hostname) LIKE ? OR lower(asset_tag) LIKE ? OR lower(logged_user) LIKE ? OR lower(ip_address) LIKE ? OR lower(department) LIKE ?)"
      );
      const q = `%${filters.search.toLowerCase()}%`;
      params.push(q, q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM assets ${whereSql}
         ORDER BY CASE status
           WHEN 'warning' THEN 1
           WHEN 'offline' THEN 2
           WHEN 'idle' THEN 3
           WHEN 'online' THEN 4
           ELSE 5
         END, hostname ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapAsset(r));
  }

  public getAssetById(id: string): Asset | null {
    const row = this.db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapAsset(row) : null;
  }

  public getAssetByHostname(hostname: string): Asset | null {
    const row = this.db
      .prepare("SELECT * FROM assets WHERE lower(hostname) = lower(?)")
      .get(hostname) as Record<string, unknown> | undefined;
    return row ? this.mapAsset(row) : null;
  }

  public createAsset(input: {
    assetTag: string;
    hostname: string;
    domain: string;
    adOu: string;
    ipAddress: string;
    macAddress: string;
    osName: string;
    osVersion: string;
    cpuModel: string;
    ramTotalGb: number;
    diskTotalGb: number;
    loggedUser: string;
    department: string;
    status?: AssetStatus;
  }): Asset {
    const id = randomUUID();
    const now = new Date().toISOString();
    const status = input.status ?? "online";
    this.db
      .prepare(
        `INSERT INTO assets (
          id, asset_tag, hostname, domain, ad_ou, ip_address, mac_address,
          os_name, os_version, cpu_model, ram_total_gb, disk_total_gb,
          logged_user, department, status, last_seen_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.assetTag.toUpperCase(),
        input.hostname.toUpperCase(),
        input.domain,
        input.adOu,
        input.ipAddress,
        input.macAddress.toUpperCase(),
        input.osName,
        input.osVersion,
        input.cpuModel,
        input.ramTotalGb,
        input.diskTotalGb,
        input.loggedUser,
        input.department,
        status,
        now,
        now,
        now
      );

    return this.getAssetById(id)!;
  }

  public updateAsset(
    id: string,
    patch: Partial<{
      assetTag: string;
      hostname: string;
      domain: string;
      adOu: string;
      ipAddress: string;
      macAddress: string;
      osName: string;
      osVersion: string;
      cpuModel: string;
      ramTotalGb: number;
      diskTotalGb: number;
      loggedUser: string;
      department: string;
      status: AssetStatus;
    }>
  ): Asset | null {
    const existing = this.getAssetById(id);
    if (!existing) return null;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE assets SET
          asset_tag = ?, hostname = ?, domain = ?, ad_ou = ?, ip_address = ?, mac_address = ?,
          os_name = ?, os_version = ?, cpu_model = ?, ram_total_gb = ?, disk_total_gb = ?,
          logged_user = ?, department = ?, status = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        (patch.assetTag ?? existing.assetTag).toUpperCase(),
        (patch.hostname ?? existing.hostname).toUpperCase(),
        patch.domain ?? existing.domain,
        patch.adOu ?? existing.adOu,
        patch.ipAddress ?? existing.ipAddress,
        (patch.macAddress ?? existing.macAddress).toUpperCase(),
        patch.osName ?? existing.osName,
        patch.osVersion ?? existing.osVersion,
        patch.cpuModel ?? existing.cpuModel,
        patch.ramTotalGb ?? existing.ramTotalGb,
        patch.diskTotalGb ?? existing.diskTotalGb,
        patch.loggedUser ?? existing.loggedUser,
        patch.department ?? existing.department,
        patch.status ?? existing.status,
        now,
        id
      );

    return this.getAssetById(id);
  }

  public deleteAsset(id: string): boolean {
    const res = this.db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  public listAssetTelemetry(assetId: string, limit = 24): TelemetrySample[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM telemetry_samples
         WHERE asset_id = ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(assetId, limit) as Array<Record<string, unknown>>;

    return rows
      .map((r) => ({
        id: Number(r.id),
        assetId: String(r.asset_id),
        cpuPercent: Number(r.cpu_percent),
        ramPercent: Number(r.ram_percent),
        diskPercent: Number(r.disk_percent),
        idleMinutes: Number(r.idle_minutes),
        uptimeHours: Number(r.uptime_hours),
        loggedUser: String(r.logged_user),
        topProcesses: JSON.parse(String(r.top_processes_json || "[]")) as string[],
        recordedAt: String(r.recorded_at),
      }))
      .reverse();
  }

  private deriveEndpointStatus(metrics: {
    cpuPercent: number;
    ramPercent: number;
    diskPercent: number;
    idleMinutes: number;
    currentStatus?: AssetStatus;
  }): AssetStatus {
    if (metrics.currentStatus === "maintenance") return "maintenance";
    if (metrics.cpuPercent >= 90 || metrics.ramPercent >= 92 || metrics.diskPercent >= 90) {
      return "warning";
    }
    if (metrics.idleMinutes >= 30) {
      return "idle";
    }
    return "online";
  }

  public ingestTelemetry(payload: {
    hostname: string;
    assetTag?: string;
    domain?: string;
    adOu?: string;
    department?: string;
    ipAddress?: string;
    macAddress?: string;
    osName?: string;
    osVersion?: string;
    cpuModel?: string;
    ramTotalGb?: number;
    diskTotalGb?: number;
    cpuPercent: number;
    ramPercent: number;
    diskPercent: number;
    idleMinutes: number;
    uptimeHours: number;
    loggedUser: string;
    topProcesses: string[];
    agentVersion: string;
  }): { asset: Asset; sample: TelemetrySample; autoTicket: Ticket | null } {
    const now = new Date().toISOString();
    const normalizedHost = payload.hostname.toUpperCase();
    let asset = this.getAssetByHostname(normalizedHost);

    if (!asset) {
      const shortSuffix = Math.floor(1000 + Math.random() * 9000);
      asset = this.createAsset({
        assetTag: payload.assetTag || `PAT-${shortSuffix}`,
        hostname: normalizedHost,
        domain: payload.domain || "corp.infradesk.local",
        adOu: payload.adOu || "OU=Workstations,DC=corp,DC=infradesk,DC=local",
        ipAddress: payload.ipAddress || "10.10.20.150",
        macAddress: payload.macAddress || "00:15:5D:8A:31:C0",
        osName: payload.osName || "Windows 11 Pro",
        osVersion: payload.osVersion || "24H2",
        cpuModel: payload.cpuModel || "Intel Core i5-13400",
        ramTotalGb: payload.ramTotalGb ?? 16,
        diskTotalGb: payload.diskTotalGb ?? 512,
        loggedUser: payload.loggedUser,
        department: payload.department || "Operações",
      });
    }

    const nextStatus = this.deriveEndpointStatus({
      cpuPercent: payload.cpuPercent,
      ramPercent: payload.ramPercent,
      diskPercent: payload.diskPercent,
      idleMinutes: payload.idleMinutes,
      currentStatus: asset.status,
    });

    const topProcJson = JSON.stringify(payload.topProcesses);

    this.db
      .prepare(
        `UPDATE assets SET
          ip_address = ?,
          ad_ou = ?,
          department = ?,
          logged_user = ?,
          status = ?,
          cpu_percent = ?,
          ram_percent = ?,
          disk_percent = ?,
          idle_minutes = ?,
          uptime_hours = ?,
          top_processes_json = ?,
          agent_version = ?,
          last_seen_at = ?,
          updated_at = ?
         WHERE id = ?`
      )
      .run(
        payload.ipAddress ?? asset.ipAddress,
        payload.adOu ?? asset.adOu,
        payload.department ?? asset.department,
        payload.loggedUser || asset.loggedUser,
        nextStatus,
        Number(payload.cpuPercent.toFixed(1)),
        Number(payload.ramPercent.toFixed(1)),
        Number(payload.diskPercent.toFixed(1)),
        Math.round(payload.idleMinutes),
        Number(payload.uptimeHours.toFixed(1)),
        topProcJson,
        payload.agentVersion,
        now,
        now,
        asset.id
      );

    const insertRes = this.db
      .prepare(
        `INSERT INTO telemetry_samples
         (asset_id, cpu_percent, ram_percent, disk_percent, idle_minutes, uptime_hours, logged_user, top_processes_json, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset.id,
        Number(payload.cpuPercent.toFixed(1)),
        Number(payload.ramPercent.toFixed(1)),
        Number(payload.diskPercent.toFixed(1)),
        Math.round(payload.idleMinutes),
        Number(payload.uptimeHours.toFixed(1)),
        payload.loggedUser,
        topProcJson,
        now
      );

    // Keep last 60 samples per endpoint so SQLite stays compact
    this.db
      .prepare(
        `DELETE FROM telemetry_samples
         WHERE asset_id = ? AND id NOT IN (
           SELECT id FROM telemetry_samples WHERE asset_id = ? ORDER BY id DESC LIMIT 60
         )`
      )
      .run(asset.id, asset.id);

    const updatedAsset = this.getAssetById(asset.id)!;
    const sample: TelemetrySample = {
      id: Number(insertRes.lastInsertRowid),
      assetId: asset.id,
      cpuPercent: updatedAsset.cpuPercent,
      ramPercent: updatedAsset.ramPercent,
      diskPercent: updatedAsset.diskPercent,
      idleMinutes: updatedAsset.idleMinutes,
      uptimeHours: updatedAsset.uptimeHours,
      loggedUser: updatedAsset.loggedUser,
      topProcesses: updatedAsset.topProcesses,
      recordedAt: now,
    };

    // Proactive Auto-Ticket Correlation Engine when critical saturation is detected
    let autoTicket: Ticket | null = null;
    const breaches: string[] = [];
    if (payload.cpuPercent >= 92) breaches.push(`CPU em ${payload.cpuPercent.toFixed(0)}%`);
    if (payload.ramPercent >= 94) breaches.push(`RAM em ${payload.ramPercent.toFixed(0)}%`);
    if (payload.diskPercent >= 92) breaches.push(`Disco em ${payload.diskPercent.toFixed(0)}%`);

    if (breaches.length > 0 && updatedAsset.status !== "maintenance") {
      const existingOpenAlert = this.db
        .prepare(
          `SELECT id FROM tickets
           WHERE asset_id = ? AND category = 'telemetry_alert'
             AND status IN ('open', 'in_progress', 'waiting_user')
           LIMIT 1`
        )
        .get(asset.id) as Record<string, unknown> | undefined;

      if (!existingOpenAlert) {
        autoTicket = this.createTicket({
          title: `[Alerta Automático] Saturação em ${updatedAsset.hostname} (${breaches.join(", ")})`,
          description:
            `Incidente preventivo aberto automaticamente pelo motor de telemetria InfraDesk.\n` +
            `Host: ${updatedAsset.hostname} (${updatedAsset.ipAddress})\n` +
            `Unidade AD: ${updatedAsset.adOu}\n` +
            `Usuário atual: ${updatedAsset.loggedUser}\n` +
            `Métricas coletadas: CPU ${updatedAsset.cpuPercent}%, RAM ${updatedAsset.ramPercent}%, Disco ${updatedAsset.diskPercent}%.\n` +
            `Processos principais: ${updatedAsset.topProcesses.join(", ") || "N/D"}.`,
          category: "telemetry_alert",
          priority: payload.diskPercent >= 95 || payload.cpuPercent >= 95 ? "critical" : "high",
          assetId: asset.id,
          requesterName: "InfraDesk Telemetry Engine",
          requesterDepartment: updatedAsset.department,
          autoGenerated: true,
        });
      }
    }

    return { asset: updatedAsset, sample, autoTicket };
  }

  public syncActiveDirectoryBatch(batch: {
    domain: string;
    computers: Array<{
      hostname: string;
      assetTag?: string;
      adOu: string;
      department: string;
      ipAddress: string;
      macAddress?: string;
      osName: string;
      osVersion: string;
      cpuModel: string;
      ramTotalGb: number;
      diskTotalGb: number;
      loggedUser: string;
    }>;
  }): { created: number; updated: number; assets: Asset[] } {
    let created = 0;
    let updated = 0;
    const synced: Asset[] = [];

    for (const comp of batch.computers) {
      const existing = this.getAssetByHostname(comp.hostname);
      if (existing) {
        const res = this.updateAsset(existing.id, {
          domain: batch.domain,
          adOu: comp.adOu,
          department: comp.department,
          ipAddress: comp.ipAddress,
          macAddress: comp.macAddress ?? existing.macAddress,
          osName: comp.osName,
          osVersion: comp.osVersion,
          cpuModel: comp.cpuModel,
          ramTotalGb: comp.ramTotalGb,
          diskTotalGb: comp.diskTotalGb,
          loggedUser: comp.loggedUser || existing.loggedUser,
        });
        if (res) synced.push(res);
        updated += 1;
      } else {
        const tag =
          comp.assetTag ||
          `AD-${comp.hostname.replace(/[^A-Z0-9]/gi, "").slice(-6).toUpperCase()}`;
        const res = this.createAsset({
          assetTag: tag,
          hostname: comp.hostname,
          domain: batch.domain,
          adOu: comp.adOu,
          ipAddress: comp.ipAddress,
          macAddress: comp.macAddress || "00:15:5D:AD:10:01",
          osName: comp.osName,
          osVersion: comp.osVersion,
          cpuModel: comp.cpuModel,
          ramTotalGb: comp.ramTotalGb,
          diskTotalGb: comp.diskTotalGb,
          loggedUser: comp.loggedUser,
          department: comp.department,
        });
        synced.push(res);
        created += 1;
      }
    }

    return { created, updated, assets: synced };
  }

  private nextTicketCode(): string {
    const row = this.db.prepare("SELECT COUNT(*) as total FROM tickets").get() as {
      total: number;
    };
    const nextNum = Number(row.total) + 1001;
    return `INC-${nextNum}`;
  }

  public listTickets(filters?: {
    status?: string;
    priority?: string;
    assetId?: string;
    search?: string;
  }): Ticket[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (filters?.status && filters.status !== "all") {
      clauses.push("t.status = ?");
      params.push(filters.status);
    }
    if (filters?.priority && filters.priority !== "all") {
      clauses.push("t.priority = ?");
      params.push(filters.priority);
    }
    if (filters?.assetId) {
      clauses.push("t.asset_id = ?");
      params.push(filters.assetId);
    }
    if (filters?.search) {
      clauses.push(
        "(lower(t.code) LIKE ? OR lower(t.title) LIKE ? OR lower(t.requester_name) LIKE ? OR lower(COALESCE(a.hostname, '')) LIKE ?)"
      );
      const q = `%${filters.search.toLowerCase()}%`;
      params.push(q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT t.*, a.hostname AS asset_hostname, u.name AS assignee_name
         FROM tickets t
         LEFT JOIN assets a ON a.id = t.asset_id
         LEFT JOIN users u ON u.id = t.assignee_id
         ${whereSql}
         ORDER BY
           CASE t.status
             WHEN 'open' THEN 1
             WHEN 'in_progress' THEN 2
             WHEN 'waiting_user' THEN 3
             WHEN 'resolved' THEN 4
             ELSE 5
           END,
           CASE t.priority
             WHEN 'critical' THEN 1
             WHEN 'high' THEN 2
             WHEN 'medium' THEN 3
             ELSE 4
           END,
           t.created_at DESC`
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapTicket(r));
  }

  public getTicketById(id: string): Ticket | null {
    const row = this.db
      .prepare(
        `SELECT t.*, a.hostname AS asset_hostname, u.name AS assignee_name
         FROM tickets t
         LEFT JOIN assets a ON a.id = t.asset_id
         LEFT JOIN users u ON u.id = t.assignee_id
         WHERE t.id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapTicket(row) : null;
  }

  public createTicket(input: {
    title: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    assetId?: string | null;
    requesterName: string;
    requesterDepartment: string;
    assigneeId?: string | null;
    autoGenerated?: boolean;
    createdAtOverride?: Date;
  }): Ticket {
    const id = randomUUID();
    const nowDate = input.createdAtOverride ?? new Date();
    const now = nowDate.toISOString();
    const code = this.nextTicketCode();
    const slaDueAt = computeSlaDueAt(input.priority, nowDate);

    this.db
      .prepare(
        `INSERT INTO tickets (
          id, code, title, description, category, priority, status, asset_id,
          requester_name, requester_department, assignee_id, auto_generated,
          sla_due_at, resolved_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        code,
        input.title,
        input.description,
        input.category,
        input.priority,
        input.assetId ?? null,
        input.requesterName,
        input.requesterDepartment,
        input.assigneeId ?? null,
        input.autoGenerated ? 1 : 0,
        slaDueAt,
        now,
        now
      );

    return this.getTicketById(id)!;
  }

  public updateTicket(
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      priority: TicketPriority;
      status: TicketStatus;
      assigneeId: string | null;
    }>
  ): Ticket | null {
    const existing = this.getTicketById(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const nextPriority = patch.priority ?? existing.priority;
    const nextStatus = patch.status ?? existing.status;

    const nextSlaDueAt =
      patch.priority && patch.priority !== existing.priority
        ? computeSlaDueAt(nextPriority, new Date(existing.createdAt))
        : existing.slaDueAt;

    let nextResolvedAt = existing.resolvedAt;
    if (
      (nextStatus === "resolved" || nextStatus === "closed") &&
      existing.status !== "resolved" &&
      existing.status !== "closed"
    ) {
      nextResolvedAt = now;
    } else if (nextStatus !== "resolved" && nextStatus !== "closed") {
      nextResolvedAt = null;
    }

    const nextAssigneeId =
      patch.assigneeId === undefined ? existing.assigneeId : patch.assigneeId;

    this.db
      .prepare(
        `UPDATE tickets SET
          title = ?, description = ?, priority = ?, status = ?,
          assignee_id = ?, sla_due_at = ?, resolved_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        patch.title ?? existing.title,
        patch.description ?? existing.description,
        nextPriority,
        nextStatus,
        nextAssigneeId,
        nextSlaDueAt,
        nextResolvedAt,
        now,
        id
      );

    return this.getTicketById(id);
  }

  public listTicketComments(ticketId: string): TicketComment[] {
    const rows = this.db
      .prepare("SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC")
      .all(ticketId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      ticketId: String(r.ticket_id),
      authorName: String(r.author_name),
      authorRole: String(r.author_role) as Role | "system",
      body: String(r.body),
      internal: Number(r.internal) === 1,
      createdAt: String(r.created_at),
    }));
  }

  public addTicketComment(input: {
    ticketId: string;
    authorName: string;
    authorRole: Role | "system";
    body: string;
    internal?: boolean;
  }): TicketComment {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ticket_comments (id, ticket_id, author_name, author_role, body, internal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.ticketId,
        input.authorName,
        input.authorRole,
        input.body,
        input.internal ? 1 : 0,
        createdAt
      );

    return {
      id,
      ticketId: input.ticketId,
      authorName: input.authorName,
      authorRole: input.authorRole,
      body: input.body,
      internal: Boolean(input.internal),
      createdAt,
    };
  }

  public getDashboardSummary(): DashboardSummary {
    const assets = this.listAssets();
    const tickets = this.listTickets();

    const fleet = {
      total: assets.length,
      online: assets.filter((a) => a.status === "online").length,
      idle: assets.filter((a) => a.status === "idle").length,
      warning: assets.filter((a) => a.status === "warning").length,
      offline: assets.filter((a) => a.status === "offline").length,
      maintenance: assets.filter((a) => a.status === "maintenance").length,
      avgCpuPercent:
        assets.length > 0
          ? Number((assets.reduce((acc, a) => acc + a.cpuPercent, 0) / assets.length).toFixed(1))
          : 0,
      avgRamPercent:
        assets.length > 0
          ? Number((assets.reduce((acc, a) => acc + a.ramPercent, 0) / assets.length).toFixed(1))
          : 0,
      avgDiskPercent:
        assets.length > 0
          ? Number((assets.reduce((acc, a) => acc + a.diskPercent, 0) / assets.length).toFixed(1))
          : 0,
    };

    const activeTickets = tickets.filter(
      (t) => t.status !== "resolved" && t.status !== "closed"
    );
    const nonBreachedCount = tickets.filter((t) => t.slaState !== "breached").length;
    const slaCompliancePercent =
      tickets.length > 0 ? Number(((nonBreachedCount / tickets.length) * 100).toFixed(1)) : 100;

    const todayPrefix = new Date().toISOString().slice(0, 10);

    const ticketStats = {
      totalActive: activeTickets.length,
      open: tickets.filter((t) => t.status === "open").length,
      inProgress: tickets.filter((t) => t.status === "in_progress").length,
      waitingUser: tickets.filter((t) => t.status === "waiting_user").length,
      resolvedToday: tickets.filter(
        (t) => t.resolvedAt && t.resolvedAt.startsWith(todayPrefix)
      ).length,
      criticalActive: activeTickets.filter((t) => t.priority === "critical").length,
      slaCompliancePercent,
      slaBreachedActive: activeTickets.filter((t) => t.slaState === "breached").length,
      slaAtRiskActive: activeTickets.filter((t) => t.slaState === "at_risk").length,
    };

    const ouMap = new Map<
      string,
      { adOu: string; department: string; count: number; warningCount: number; idleCount: number }
    >();
    for (const a of assets) {
      const curr = ouMap.get(a.adOu) ?? {
        adOu: a.adOu,
        department: a.department,
        count: 0,
        warningCount: 0,
        idleCount: 0,
      };
      curr.count += 1;
      if (a.status === "warning") curr.warningCount += 1;
      if (a.status === "idle") curr.idleCount += 1;
      ouMap.set(a.adOu, curr);
    }

    return {
      fleet,
      tickets: ticketStats,
      byOu: Array.from(ouMap.values()).sort((a, b) => b.count - a.count),
    };
  }

  private seedIfEmpty(): void {
    const userCount = this.db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    if (Number(userCount.c) > 0) return;

    const now = new Date();
    const nowIso = now.toISOString();

    const adminId = randomUUID();
    const techId = randomUUID();
    const viewerId = randomUUID();

    const insertUser = this.db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, department, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    insertUser.run(
      adminId,
      "Rafael Merlo",
      "admin@infradesk.dev",
      hashPassword("Admin@2026"),
      "admin",
      "Infraestrutura & SysAdmin",
      nowIso
    );
    insertUser.run(
      techId,
      "Lucas Ferreira",
      "tech@infradesk.dev",
      hashPassword("Tech@2026"),
      "technician",
      "Service Desk N2",
      nowIso
    );
    insertUser.run(
      viewerId,
      "Camila Martins",
      "auditor@infradesk.dev",
      hashPassword("Audit@2026"),
      "viewer",
      "Governança & Compliance",
      nowIso
    );

    const seedEndpoints = [
      {
        assetTag: "PAT-1042",
        hostname: "SRV-AD-DC01",
        adOu: "OU=Domain Controllers,DC=corp,DC=infradesk,DC=local",
        department: "Infraestrutura TI",
        ipAddress: "10.10.0.10",
        macAddress: "00:15:5D:01:00:10",
        osName: "Windows Server 2022",
        osVersion: "21H2",
        cpuModel: "Intel Xeon Silver 4314 (16C)",
        ramTotalGb: 64,
        diskTotalGb: 2000,
        loggedUser: "svc_ad_sync",
        cpuPercent: 34.2,
        ramPercent: 58.6,
        diskPercent: 46.0,
        idleMinutes: 0,
        uptimeHours: 742.5,
        topProcesses: ["lsass.exe", "dns.exe", "dfsr.exe", "infradesk-agent"],
      },
      {
        assetTag: "PAT-2019",
        hostname: "WKS-FIN-04",
        adOu: "OU=Financeiro,OU=Workstations,DC=corp,DC=infradesk,DC=local",
        department: "Financeiro & Contábil",
        ipAddress: "10.10.20.44",
        macAddress: "00:15:5D:20:00:44",
        osName: "Windows 11 Pro",
        osVersion: "24H2",
        cpuModel: "Intel Core i7-13700",
        ramTotalGb: 16,
        diskTotalGb: 512,
        loggedUser: "mariana.costa",
        cpuPercent: 94.6,
        ramPercent: 89.2,
        diskPercent: 93.4,
        idleMinutes: 1,
        uptimeHours: 118.4,
        topProcesses: ["EXCEL.EXE", "PowerBI.exe", "MsMpEng.exe", "chrome.exe"],
      },
      {
        assetTag: "PAT-2088",
        hostname: "WKS-ATD-12",
        adOu: "OU=Atendimento,OU=Workstations,DC=corp,DC=infradesk,DC=local",
        department: "Atendimento & Benefícios",
        ipAddress: "10.10.30.112",
        macAddress: "00:15:5D:30:01:12",
        osName: "Windows 11 Pro",
        osVersion: "23H2",
        cpuModel: "Intel Core i5-12400",
        ramTotalGb: 16,
        diskTotalGb: 256,
        loggedUser: "carlos.souza",
        cpuPercent: 8.4,
        ramPercent: 44.0,
        diskPercent: 51.2,
        idleMinutes: 67,
        uptimeHours: 19.2,
        topProcesses: ["Teams.exe", "chrome.exe", "explorer.exe"],
      },
      {
        assetTag: "PAT-3011",
        hostname: "NB-DEV-07",
        adOu: "OU=Engenharia,OU=Workstations,DC=corp,DC=infradesk,DC=local",
        department: "Engenharia de Software",
        ipAddress: "10.10.40.71",
        macAddress: "00:15:5D:40:00:71",
        osName: "Ubuntu Linux",
        osVersion: "24.04 LTS",
        cpuModel: "AMD Ryzen 7 7840HS",
        ramTotalGb: 32,
        diskTotalGb: 1024,
        loggedUser: "rafael.merlo",
        cpuPercent: 48.5,
        ramPercent: 62.1,
        diskPercent: 39.8,
        idleMinutes: 0,
        uptimeHours: 54.0,
        topProcesses: ["node", "dockerd", "code", "postgres"],
      },
      {
        assetTag: "PAT-2105",
        hostname: "WKS-RH-02",
        adOu: "OU=RH,OU=Workstations,DC=corp,DC=infradesk,DC=local",
        department: "Recursos Humanos",
        ipAddress: "10.10.25.22",
        macAddress: "00:15:5D:25:00:22",
        osName: "Windows 10 Pro",
        osVersion: "22H2",
        cpuModel: "Intel Core i5-11400",
        ramTotalGb: 8,
        diskTotalGb: 256,
        loggedUser: "fernanda.lima",
        cpuPercent: 21.0,
        ramPercent: 74.5,
        diskPercent: 68.0,
        idleMinutes: 42,
        uptimeHours: 31.0,
        topProcesses: ["chrome.exe", "OUTLOOK.EXE", "Teams.exe"],
      },
      {
        assetTag: "PAT-1099",
        hostname: "SRV-BKP-NAS01",
        adOu: "OU=Servers,DC=corp,DC=infradesk,DC=local",
        department: "Infraestrutura TI",
        ipAddress: "10.10.0.25",
        macAddress: "00:15:5D:01:00:25",
        osName: "Debian GNU/Linux",
        osVersion: "12 (Bookworm)",
        cpuModel: "Intel Xeon E-2336",
        ramTotalGb: 32,
        diskTotalGb: 8000,
        loggedUser: "root",
        cpuPercent: 16.8,
        ramPercent: 41.2,
        diskPercent: 78.9,
        idleMinutes: 0,
        uptimeHours: 1420.0,
        topProcesses: ["restic", "smbd", "node_exporter"],
      },
    ];

    const createdAssets: Asset[] = [];
    for (const ep of seedEndpoints) {
      const base = this.createAsset({
        assetTag: ep.assetTag,
        hostname: ep.hostname,
        domain: "corp.infradesk.local",
        adOu: ep.adOu,
        ipAddress: ep.ipAddress,
        macAddress: ep.macAddress,
        osName: ep.osName,
        osVersion: ep.osVersion,
        cpuModel: ep.cpuModel,
        ramTotalGb: ep.ramTotalGb,
        diskTotalGb: ep.diskTotalGb,
        loggedUser: ep.loggedUser,
        department: ep.department,
      });

      // Seed 12 historical telemetry points per machine
      for (let i = 11; i >= 1; i -= 1) {
        const ts = new Date(now.getTime() - i * 10 * 60 * 1000).toISOString();
        const jitter = ((i % 3) - 1) * 4.2;
        const cpu = Math.max(3, Math.min(99, Number((ep.cpuPercent + jitter).toFixed(1))));
        const ram = Math.max(15, Math.min(98, Number((ep.ramPercent + jitter * 0.5).toFixed(1))));
        this.db
          .prepare(
            `INSERT INTO telemetry_samples
             (asset_id, cpu_percent, ram_percent, disk_percent, idle_minutes, uptime_hours, logged_user, top_processes_json, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            base.id,
            cpu,
            ram,
            ep.diskPercent,
            Math.max(0, ep.idleMinutes - i * 2),
            Math.max(1, Number((ep.uptimeHours - i * 0.16).toFixed(1))),
            ep.loggedUser,
            JSON.stringify(ep.topProcesses),
            ts
          );
      }

      const finalRes = this.ingestTelemetry({
        hostname: ep.hostname,
        cpuPercent: ep.cpuPercent,
        ramPercent: ep.ramPercent,
        diskPercent: ep.diskPercent,
        idleMinutes: ep.idleMinutes,
        uptimeHours: ep.uptimeHours,
        loggedUser: ep.loggedUser,
        topProcesses: ep.topProcesses,
        agentVersion: "2.1.0",
      });
      createdAssets.push(finalRes.asset);
    }

    // Additional realistic ITSM tickets
    const t1 = this.createTicket({
      title: "Bloqueio recorrente de conta no Active Directory após troca de senha",
      description:
        "Colaborador relata bloqueio automático da conta AD a cada 20 minutos devido a credencial em cache no Gerenciador de Credenciais do Windows e sessão RDP antiga.",
      category: "access_ad",
      priority: "high",
      assetId: createdAssets[2]?.id ?? null,
      requesterName: "Carlos Souza",
      requesterDepartment: "Atendimento & Benefícios",
      assigneeId: techId,
      createdAtOverride: new Date(now.getTime() - 6.5 * 60 * 60 * 1000),
    });
    this.updateTicket(t1.id, { status: "in_progress" });
    this.addTicketComment({
      ticketId: t1.id,
      authorName: "Lucas Ferreira",
      authorRole: "technician",
      body: "Identificado evento 4740 no SRV-AD-DC01 originado da estação WKS-ATD-12. Limpando tickets Kerberos (klist purge) e credenciais salvas.",
      internal: true,
    });

    this.createTicket({
      title: "Solicitação de liberação de grupo VPN SSL para auditoria externa",
      description:
        "Necessário adicionar perfil temporário no grupo SG_VPN_AUDITORIA com expiração automática em 7 dias no Active Directory.",
      category: "security",
      priority: "medium",
      assetId: createdAssets[0]?.id ?? null,
      requesterName: "Camila Martins",
      requesterDepartment: "Governança & Compliance",
      assigneeId: adminId,
      createdAtOverride: new Date(now.getTime() - 3 * 60 * 60 * 1000),
    });

    const tResolved = this.createTicket({
      title: "Upgrade de memória DDR4 e limpeza preventiva concluídos",
      description:
        "Expansão de 8GB para 16GB realizada conforme janela de manutenção aprovada pela gestão.",
      category: "hardware",
      priority: "low",
      assetId: createdAssets[4]?.id ?? null,
      requesterName: "Fernanda Lima",
      requesterDepartment: "Recursos Humanos",
      assigneeId: techId,
      createdAtOverride: new Date(now.getTime() - 5 * 60 * 60 * 1000),
    });
    this.updateTicket(tResolved.id, { status: "resolved" });

    this.recordAudit({
      actorName: "Sistema InfraDesk",
      actorEmail: "system@infradesk.dev",
      actorRole: "system",
      action: "SEED_INITIALIZED",
      entityType: "system",
      entityId: "bootstrap",
      summary: "Inventário inicial do Active Directory, telemetria e políticas de SLA carregados.",
      ipAddress: "127.0.0.1",
    });
  }
}
