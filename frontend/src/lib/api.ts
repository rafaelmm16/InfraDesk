import { DEMO_USERS, demoEngine } from "./demoEngine";
import type {
  Asset,
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
} from "./types";

const STATIC_DEMO_ENV = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

const CREDENTIALS_BY_ROLE: Record<Role, { email: string; password: string }> = {
  admin: { email: "admin@infradesk.dev", password: "Admin@2026" },
  technician: { email: "tech@infradesk.dev", password: "Tech@2026" },
  viewer: { email: "auditor@infradesk.dev", password: "Audit@2026" },
};

class InfraDeskClient {
  private demoMode = STATIC_DEMO_ENV;
  private jwtToken: string | null = null;
  private currentUser: User = DEMO_USERS[0];

  public isDemoMode(): boolean {
    return this.demoMode;
  }

  public getCurrentUser(): User {
    return this.demoMode ? demoEngine.getCurrentUser() : this.currentUser;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(this.jwtToken ? { Authorization: `Bearer ${this.jwtToken}` } : {}),
    };

    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });

    if (!res.ok) {
      let msg = `Erro HTTP ${res.status}`;
      try {
        const errJson = (await res.json()) as { message?: string };
        if (errJson.message) msg = errJson.message;
      } catch {
        // ignore parse failure
      }
      throw new Error(msg);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  public async initializeSession(): Promise<{ demoMode: boolean; user: User }> {
    if (STATIC_DEMO_ENV) {
      this.demoMode = true;
      return { demoMode: true, user: demoEngine.getCurrentUser() };
    }

    try {
      await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
      const creds = CREDENTIALS_BY_ROLE.admin;
      const auth = await this.request<{ token: string; user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(creds),
      });
      this.jwtToken = auth.token;
      this.currentUser = auth.user;
      this.demoMode = false;
      return { demoMode: false, user: auth.user };
    } catch {
      this.demoMode = true;
      return { demoMode: true, user: demoEngine.getCurrentUser() };
    }
  }

  public async loginWithCredentials(email: string, password: string): Promise<User> {
    if (this.demoMode) {
      const matched = DEMO_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!matched) throw new Error("Conta de demonstração não encontrada.");
      return demoEngine.switchRole(matched.role);
    }

    const auth = await this.request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.jwtToken = auth.token;
    this.currentUser = auth.user;
    return auth.user;
  }

  public async switchRoleQuick(role: Role): Promise<User> {
    if (this.demoMode) {
      return demoEngine.switchRole(role);
    }
    const creds = CREDENTIALS_BY_ROLE[role];
    return this.loginWithCredentials(creds.email, creds.password);
  }

  public setForceDemoMode(force: boolean): User {
    this.demoMode = force || STATIC_DEMO_ENV;
    return this.getCurrentUser();
  }

  public getWebSocketUrl(): string | null {
    if (this.demoMode || typeof window === "undefined") return null;
    if (API_BASE.startsWith("http")) {
      return `${API_BASE.replace(/^http/, "ws")}/api/ws`;
    }
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.hostname}:3333/api/ws`;
  }

  public async getSummary(): Promise<DashboardSummary> {
    if (this.demoMode) return demoEngine.getSummary();
    return this.request<DashboardSummary>("/api/dashboard/summary");
  }

  public async listUsers(): Promise<User[]> {
    if (this.demoMode) return demoEngine.listUsers();
    const res = await this.request<{ users: User[] }>("/api/users");
    return res.users;
  }

  public async listAssets(filters?: {
    status?: string;
    adOu?: string;
    search?: string;
  }): Promise<Asset[]> {
    if (this.demoMode) return demoEngine.listAssets(filters);
    const params = new URLSearchParams();
    if (filters?.status && filters.status !== "all") params.set("status", filters.status);
    if (filters?.adOu && filters.adOu !== "all") params.set("adOu", filters.adOu);
    if (filters?.search) params.set("search", filters.search);
    const qs = params.toString();
    const res = await this.request<{ assets: Asset[] }>(`/api/assets${qs ? `?${qs}` : ""}`);
    return res.assets;
  }

  public async getAssetDetail(id: string): Promise<{
    asset: Asset;
    telemetry: TelemetrySample[];
    tickets: Ticket[];
  }> {
    if (this.demoMode) return demoEngine.getAssetDetail(id);
    return this.request(`/api/assets/${id}`);
  }

  public async simulateTelemetryPulse(
    asset: Asset,
    mode: "healthy" | "critical"
  ): Promise<{ asset: Asset; sample: TelemetrySample; autoTicket: Ticket | null }> {
    if (this.demoMode) {
      return demoEngine.simulateTelemetryPulse(asset.id, mode);
    }

    const cpuPercent =
      mode === "critical"
        ? Number((93 + Math.random() * 5).toFixed(1))
        : Number((20 + Math.random() * 25).toFixed(1));
    const ramPercent =
      mode === "critical"
        ? Number((91 + Math.random() * 6).toFixed(1))
        : Number((42 + Math.random() * 20).toFixed(1));
    const diskPercent = mode === "critical" ? Math.max(asset.diskPercent, 94.0) : 64.5;

    return this.request("/api/telemetry/ingest", {
      method: "POST",
      body: JSON.stringify({
        hostname: asset.hostname,
        adOu: asset.adOu,
        department: asset.department,
        ipAddress: asset.ipAddress,
        cpuPercent,
        ramPercent,
        diskPercent,
        idleMinutes: 0,
        uptimeHours: Number((asset.uptimeHours + 0.2).toFixed(1)),
        loggedUser: asset.loggedUser,
        topProcesses:
          mode === "critical"
            ? ["sqlservr.exe", "MsMpEng.exe", "chrome.exe", "infradesk-agent"]
            : asset.topProcesses,
        agentVersion: "2.1.0",
      }),
    });
  }

  public async triggerAdSync(): Promise<{ created: number; updated: number }> {
    if (this.demoMode) return demoEngine.simulateAdDiscoverySync();
    return this.request("/api/assets/sync-ad", {
      method: "POST",
      body: JSON.stringify({
        domain: "corp.infradesk.local",
        computers: [
          {
            hostname: "WKS-JUR-01",
            assetTag: "PAT-4012",
            adOu: "OU=Juridico,OU=Workstations,DC=corp,DC=infradesk,DC=local",
            department: "Jurídico & Contratos",
            ipAddress: "10.10.50.11",
            osName: "Windows 11 Pro",
            osVersion: "24H2",
            cpuModel: "Intel Core i5-13500",
            ramTotalGb: 16,
            diskTotalGb: 512,
            loggedUser: "patricia.alves",
          },
          {
            hostname: "NB-DIR-02",
            assetTag: "PAT-4018",
            adOu: "OU=Diretoria,OU=Workstations,DC=corp,DC=infradesk,DC=local",
            department: "Diretoria Executiva",
            ipAddress: "10.10.60.12",
            osName: "Windows 11 Enterprise",
            osVersion: "24H2",
            cpuModel: "Intel Core Ultra 7 155H",
            ramTotalGb: 32,
            diskTotalGb: 1024,
            loggedUser: "roberto.mendes",
          },
        ],
      }),
    });
  }

  public async listTickets(filters?: {
    status?: string;
    priority?: string;
    search?: string;
  }): Promise<Ticket[]> {
    if (this.demoMode) return demoEngine.listTickets(filters);
    const params = new URLSearchParams();
    if (filters?.status && filters.status !== "all") params.set("status", filters.status);
    if (filters?.priority && filters.priority !== "all") params.set("priority", filters.priority);
    if (filters?.search) params.set("search", filters.search);
    const qs = params.toString();
    const res = await this.request<{ tickets: Ticket[] }>(`/api/tickets${qs ? `?${qs}` : ""}`);
    return res.tickets;
  }

  public async getTicketDetail(
    id: string
  ): Promise<{ ticket: Ticket; comments: TicketComment[] }> {
    if (this.demoMode) return demoEngine.getTicketDetail(id);
    return this.request(`/api/tickets/${id}`);
  }

  public async createTicket(input: {
    title: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    assetId?: string | null;
    requesterName: string;
    requesterDepartment: string;
    assigneeId?: string | null;
  }): Promise<Ticket> {
    if (this.demoMode) return demoEngine.createTicket(input);
    const res = await this.request<{ ticket: Ticket }>("/api/tickets", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return res.ticket;
  }

  public async updateTicket(
    id: string,
    patch: Partial<{ status: TicketStatus; priority: TicketPriority; assigneeId: string | null }>
  ): Promise<Ticket> {
    if (this.demoMode) return demoEngine.updateTicket(id, patch);
    const res = await this.request<{ ticket: Ticket }>(`/api/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    return res.ticket;
  }

  public async addTicketComment(
    ticketId: string,
    body: string,
    internal = false
  ): Promise<TicketComment> {
    if (this.demoMode) return demoEngine.addComment(ticketId, body, internal);
    const res = await this.request<{ comment: TicketComment }>(
      `/api/tickets/${ticketId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({ body, internal }),
      }
    );
    return res.comment;
  }

  public async listAuditLogs(): Promise<AuditLog[]> {
    if (this.demoMode) return demoEngine.listAuditLogs();
    const res = await this.request<{ logs: AuditLog[] }>("/api/audit-logs?limit=80");
    return res.logs;
  }
}

export const apiClient = new InfraDeskClient();
