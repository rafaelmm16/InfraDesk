import type {
  Asset,
  AssetStatus,
  AuditLog,
  DashboardSummary,
  Role,
  SlaState,
  TelemetrySample,
  Ticket,
  TicketCategory,
  TicketComment,
  TicketPriority,
  TicketStatus,
  User,
} from "./types";

const SLA_HOURS: Record<TicketPriority, number> = {
  critical: 2,
  high: 8,
  medium: 24,
  low: 48,
};

function evalSla(
  ticket: Pick<Ticket, "priority" | "status" | "createdAt" | "slaDueAt" | "resolvedAt">
): { slaState: SlaState; slaRemainingMinutes: number } {
  const now = Date.now();
  const due = new Date(ticket.slaDueAt).getTime();
  const created = new Date(ticket.createdAt).getTime();
  const windowMs = Math.max(1, due - created);

  if (ticket.status === "resolved" || ticket.status === "closed") {
    const end = ticket.resolvedAt ? new Date(ticket.resolvedAt).getTime() : now;
    return {
      slaState: end <= due ? "met" : "breached",
      slaRemainingMinutes: Math.round((due - end) / 60000),
    };
  }

  const remMs = due - now;
  const remMin = Math.round(remMs / 60000);
  if (remMs < 0) return { slaState: "breached", slaRemainingMinutes: remMin };
  if (remMs / windowMs <= 0.25) return { slaState: "at_risk", slaRemainingMinutes: remMin };
  return { slaState: "on_track", slaRemainingMinutes: remMin };
}

export const DEMO_USERS: User[] = [
  {
    id: "u-admin",
    name: "Rafael Merlo",
    email: "admin@infradesk.dev",
    role: "admin",
    department: "Infraestrutura & SysAdmin",
    createdAt: "2026-01-10T10:00:00.000Z",
  },
  {
    id: "u-tech",
    name: "Lucas Ferreira",
    email: "tech@infradesk.dev",
    role: "technician",
    department: "Service Desk N2",
    createdAt: "2026-01-10T10:00:00.000Z",
  },
  {
    id: "u-viewer",
    name: "Camila Martins",
    email: "auditor@infradesk.dev",
    role: "viewer",
    department: "Governança & Compliance",
    createdAt: "2026-01-10T10:00:00.000Z",
  },
];

interface DemoState {
  currentUser: User;
  assets: Asset[];
  telemetryByAsset: Record<string, TelemetrySample[]>;
  tickets: Ticket[];
  commentsByTicket: Record<string, TicketComment[]>;
  logs: AuditLog[];
}

function createInitialState(): DemoState {
  const now = Date.now();
  const iso = (offsetMin = 0) => new Date(now + offsetMin * 60000).toISOString();

  const rawAssets: Array<Omit<Asset, "createdAt" | "updatedAt" | "lastSeenAt">> = [
    {
      id: "ast-dc01",
      assetTag: "PAT-1042",
      hostname: "SRV-AD-DC01",
      domain: "corp.infradesk.local",
      adOu: "OU=Domain Controllers,DC=corp,DC=infradesk,DC=local",
      ipAddress: "10.10.0.10",
      macAddress: "00:15:5D:01:00:10",
      osName: "Windows Server 2022",
      osVersion: "21H2",
      cpuModel: "Intel Xeon Silver 4314 (16C)",
      ramTotalGb: 64,
      diskTotalGb: 2000,
      loggedUser: "svc_ad_sync",
      department: "Infraestrutura TI",
      status: "online",
      cpuPercent: 34.2,
      ramPercent: 58.6,
      diskPercent: 46.0,
      idleMinutes: 0,
      uptimeHours: 742.5,
      topProcesses: ["lsass.exe", "dns.exe", "dfsr.exe", "infradesk-agent"],
      agentVersion: "2.1.0",
    },
    {
      id: "ast-fin04",
      assetTag: "PAT-2019",
      hostname: "WKS-FIN-04",
      domain: "corp.infradesk.local",
      adOu: "OU=Financeiro,OU=Workstations,DC=corp,DC=infradesk,DC=local",
      ipAddress: "10.10.20.44",
      macAddress: "00:15:5D:20:00:44",
      osName: "Windows 11 Pro",
      osVersion: "24H2",
      cpuModel: "Intel Core i7-13700",
      ramTotalGb: 16,
      diskTotalGb: 512,
      loggedUser: "mariana.costa",
      department: "Financeiro & Contábil",
      status: "warning",
      cpuPercent: 94.6,
      ramPercent: 89.2,
      diskPercent: 93.4,
      idleMinutes: 1,
      uptimeHours: 118.4,
      topProcesses: ["EXCEL.EXE", "PowerBI.exe", "MsMpEng.exe", "chrome.exe"],
      agentVersion: "2.1.0",
    },
    {
      id: "ast-atd12",
      assetTag: "PAT-2088",
      hostname: "WKS-ATD-12",
      domain: "corp.infradesk.local",
      adOu: "OU=Atendimento,OU=Workstations,DC=corp,DC=infradesk,DC=local",
      ipAddress: "10.10.30.112",
      macAddress: "00:15:5D:30:01:12",
      osName: "Windows 11 Pro",
      osVersion: "23H2",
      cpuModel: "Intel Core i5-12400",
      ramTotalGb: 16,
      diskTotalGb: 256,
      loggedUser: "carlos.souza",
      department: "Atendimento & Benefícios",
      status: "idle",
      cpuPercent: 8.4,
      ramPercent: 44.0,
      diskPercent: 51.2,
      idleMinutes: 67,
      uptimeHours: 19.2,
      topProcesses: ["Teams.exe", "chrome.exe", "explorer.exe"],
      agentVersion: "2.1.0",
    },
    {
      id: "ast-dev07",
      assetTag: "PAT-3011",
      hostname: "NB-DEV-07",
      domain: "corp.infradesk.local",
      adOu: "OU=Engenharia,OU=Workstations,DC=corp,DC=infradesk,DC=local",
      ipAddress: "10.10.40.71",
      macAddress: "00:15:5D:40:00:71",
      osName: "Ubuntu Linux",
      osVersion: "24.04 LTS",
      cpuModel: "AMD Ryzen 7 7840HS",
      ramTotalGb: 32,
      diskTotalGb: 1024,
      loggedUser: "rafael.merlo",
      department: "Engenharia de Software",
      status: "online",
      cpuPercent: 48.5,
      ramPercent: 62.1,
      diskPercent: 39.8,
      idleMinutes: 0,
      uptimeHours: 54.0,
      topProcesses: ["node", "dockerd", "code", "postgres"],
      agentVersion: "2.1.0",
    },
    {
      id: "ast-rh02",
      assetTag: "PAT-2105",
      hostname: "WKS-RH-02",
      domain: "corp.infradesk.local",
      adOu: "OU=RH,OU=Workstations,DC=corp,DC=infradesk,DC=local",
      ipAddress: "10.10.25.22",
      macAddress: "00:15:5D:25:00:22",
      osName: "Windows 10 Pro",
      osVersion: "22H2",
      cpuModel: "Intel Core i5-11400",
      ramTotalGb: 8,
      diskTotalGb: 256,
      loggedUser: "fernanda.lima",
      department: "Recursos Humanos",
      status: "idle",
      cpuPercent: 21.0,
      ramPercent: 74.5,
      diskPercent: 68.0,
      idleMinutes: 42,
      uptimeHours: 31.0,
      topProcesses: ["chrome.exe", "OUTLOOK.EXE", "Teams.exe"],
      agentVersion: "2.1.0",
    },
    {
      id: "ast-nas01",
      assetTag: "PAT-1099",
      hostname: "SRV-BKP-NAS01",
      domain: "corp.infradesk.local",
      adOu: "OU=Servers,DC=corp,DC=infradesk,DC=local",
      ipAddress: "10.10.0.25",
      macAddress: "00:15:5D:01:00:25",
      osName: "Debian GNU/Linux",
      osVersion: "12 (Bookworm)",
      cpuModel: "Intel Xeon E-2336",
      ramTotalGb: 32,
      diskTotalGb: 8000,
      loggedUser: "root",
      department: "Infraestrutura TI",
      status: "online",
      cpuPercent: 16.8,
      ramPercent: 41.2,
      diskPercent: 78.9,
      idleMinutes: 0,
      uptimeHours: 1420.0,
      topProcesses: ["restic", "smbd", "node_exporter"],
      agentVersion: "2.1.0",
    },
  ];

  const assets: Asset[] = rawAssets.map((a) => ({
    ...a,
    lastSeenAt: iso(-1),
    createdAt: iso(-4000),
    updatedAt: iso(-1),
  }));

  const telemetryByAsset: Record<string, TelemetrySample[]> = {};
  let sampleId = 1;
  for (const asset of assets) {
    const series: TelemetrySample[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const wave = Math.sin(i * 0.9) * 5.5;
      const cpu = Number(Math.min(99, Math.max(4, asset.cpuPercent + (i === 0 ? 0 : wave))).toFixed(1));
      const ram = Number(
        Math.min(98, Math.max(18, asset.ramPercent + (i === 0 ? 0 : wave * 0.4))).toFixed(1)
      );
      series.push({
        id: sampleId++,
        assetId: asset.id,
        cpuPercent: cpu,
        ramPercent: ram,
        diskPercent: asset.diskPercent,
        idleMinutes: Math.max(0, asset.idleMinutes - i * 3),
        uptimeHours: Number(Math.max(1, asset.uptimeHours - i * 0.16).toFixed(1)),
        loggedUser: asset.loggedUser,
        topProcesses: asset.topProcesses,
        recordedAt: iso(-i * 10),
      });
    }
    telemetryByAsset[asset.id] = series;
  }

  const buildTicket = (
    partial: Omit<Ticket, "slaState" | "slaRemainingMinutes">
  ): Ticket => ({
    ...partial,
    ...evalSla(partial),
  });

  const tickets: Ticket[] = [
    buildTicket({
      id: "tkt-1001",
      code: "INC-1001",
      title: "[Alerta Automático] Saturação em WKS-FIN-04 (CPU em 95%, Disco em 93%)",
      description:
        "Incidente preventivo aberto automaticamente pelo motor de telemetria InfraDesk.\nHost: WKS-FIN-04 (10.10.20.44)\nProcessos: EXCEL.EXE, PowerBI.exe, MsMpEng.exe.",
      category: "telemetry_alert",
      priority: "critical",
      status: "open",
      assetId: "ast-fin04",
      assetHostname: "WKS-FIN-04",
      requesterName: "InfraDesk Telemetry Engine",
      requesterDepartment: "Financeiro & Contábil",
      assigneeId: "u-tech",
      assigneeName: "Lucas Ferreira",
      autoGenerated: true,
      createdAt: iso(-95),
      slaDueAt: iso(25), // 25 min left -> At Risk!
      resolvedAt: null,
      updatedAt: iso(-10),
    }),
    buildTicket({
      id: "tkt-1002",
      code: "INC-1002",
      title: "Bloqueio recorrente de conta no Active Directory após troca de senha",
      description:
        "Colaborador relata bloqueio automático da conta AD devido a credencial antiga em cache no Windows Credential Manager.",
      category: "access_ad",
      priority: "high",
      status: "in_progress",
      assetId: "ast-atd12",
      assetHostname: "WKS-ATD-12",
      requesterName: "Carlos Souza",
      requesterDepartment: "Atendimento & Benefícios",
      assigneeId: "u-tech",
      assigneeName: "Lucas Ferreira",
      autoGenerated: false,
      createdAt: iso(-390),
      slaDueAt: iso(90),
      resolvedAt: null,
      updatedAt: iso(-35),
    }),
    buildTicket({
      id: "tkt-1003",
      code: "INC-1003",
      title: "Solicitação de liberação de grupo VPN SSL para auditoria externa",
      description:
        "Adicionar perfil temporário no grupo SG_VPN_AUDITORIA com expiração automática em 7 dias no controlador de domínio.",
      category: "security",
      priority: "medium",
      status: "waiting_user",
      assetId: "ast-dc01",
      assetHostname: "SRV-AD-DC01",
      requesterName: "Camila Martins",
      requesterDepartment: "Governança & Compliance",
      assigneeId: "u-admin",
      assigneeName: "Rafael Merlo",
      autoGenerated: false,
      createdAt: iso(-240),
      slaDueAt: iso(1200),
      resolvedAt: null,
      updatedAt: iso(-60),
    }),
    buildTicket({
      id: "tkt-1004",
      code: "INC-1004",
      title: "Upgrade de memória DDR4 e limpeza preventiva concluídos",
      description: "Expansão realizada conforme janela de manutenção aprovada pela coordenação.",
      category: "hardware",
      priority: "low",
      status: "resolved",
      assetId: "ast-rh02",
      assetHostname: "WKS-RH-02",
      requesterName: "Fernanda Lima",
      requesterDepartment: "Recursos Humanos",
      assigneeId: "u-tech",
      assigneeName: "Lucas Ferreira",
      autoGenerated: false,
      createdAt: iso(-320),
      slaDueAt: iso(2560),
      resolvedAt: iso(-45),
      updatedAt: iso(-45),
    }),
  ];

  const commentsByTicket: Record<string, TicketComment[]> = {
    "tkt-1002": [
      {
        id: "cmt-1",
        ticketId: "tkt-1002",
        authorName: "Lucas Ferreira",
        authorRole: "technician",
        body: "Identificado Event ID 4740 no SRV-AD-DC01 vindo da estação WKS-ATD-12. Executando limpeza de tickets Kerberos (klist purge).",
        internal: true,
        createdAt: iso(-30),
      },
    ],
  };

  const logs: AuditLog[] = [
    {
      id: 3,
      actorName: "InfraDesk Telemetry Engine",
      actorEmail: "telemetry@infradesk.local",
      actorRole: "system",
      action: "AUTO_TICKET_TRIGGERED",
      entityType: "ticket",
      entityId: "tkt-1001",
      summary: "Chamado automático INC-1001 aberto por saturação em WKS-FIN-04.",
      ipAddress: "10.10.20.44",
      createdAt: iso(-95),
    },
    {
      id: 2,
      actorName: "Rafael Merlo",
      actorEmail: "admin@infradesk.dev",
      actorRole: "admin",
      action: "AD_OU_SYNC",
      entityType: "ad_sync",
      entityId: "corp.infradesk.local",
      summary: "Sincronização Active Directory concluída: 6 computadores inventariados em 5 OUs.",
      ipAddress: "10.10.40.71",
      createdAt: iso(-180),
    },
    {
      id: 1,
      actorName: "Sistema InfraDesk",
      actorEmail: "system@infradesk.dev",
      actorRole: "system",
      action: "SEED_INITIALIZED",
      entityType: "system",
      entityId: "bootstrap",
      summary: "Ambiente de demonstração interativo inicializado.",
      ipAddress: "127.0.0.1",
      createdAt: iso(-300),
    },
  ];

  return {
    currentUser: DEMO_USERS[0],
    assets,
    telemetryByAsset,
    tickets,
    commentsByTicket,
    logs,
  };
}

class DemoEngine {
  private state: DemoState = createInitialState();

  private assertPermission(allowed: Role[]): void {
    if (!allowed.includes(this.state.currentUser.role)) {
      throw new Error(
        `Acesso negado (RBAC): seu perfil atual (${this.state.currentUser.role}) possui acesso somente-leitura.`
      );
    }
  }

  private pushAudit(
    action: string,
    entityType: AuditLog["entityType"],
    entityId: string,
    summary: string
  ): void {
    const actor = this.state.currentUser;
    const nextId = (this.state.logs[0]?.id ?? 0) + 1;
    this.state.logs.unshift({
      id: nextId,
      actorName: actor.name,
      actorEmail: actor.email,
      actorRole: actor.role,
      action,
      entityType,
      entityId,
      summary,
      ipAddress: "10.10.40.71",
      createdAt: new Date().toISOString(),
    });
  }

  public getCurrentUser(): User {
    return this.state.currentUser;
  }

  public switchRole(role: Role): User {
    const found = DEMO_USERS.find((u) => u.role === role) ?? DEMO_USERS[0];
    this.state.currentUser = found;
    this.pushAudit(
      "USER_ROLE_SWITCH",
      "auth",
      found.id,
      `Sessão alternada para ${found.name} (${found.role}).`
    );
    return found;
  }

  public listUsers(): User[] {
    return [...DEMO_USERS];
  }

  public listAssets(filters?: { status?: string; adOu?: string; search?: string }): Asset[] {
    return this.state.assets.filter((a) => {
      if (filters?.status && filters.status !== "all" && a.status !== filters.status) return false;
      if (filters?.adOu && filters.adOu !== "all" && a.adOu !== filters.adOu) return false;
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        const hit =
          a.hostname.toLowerCase().includes(q) ||
          a.assetTag.toLowerCase().includes(q) ||
          a.loggedUser.toLowerCase().includes(q) ||
          a.ipAddress.toLowerCase().includes(q) ||
          a.department.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }

  public getAssetDetail(id: string): {
    asset: Asset;
    telemetry: TelemetrySample[];
    tickets: Ticket[];
  } {
    const asset = this.state.assets.find((a) => a.id === id);
    if (!asset) throw new Error("Ativo não encontrado.");
    return {
      asset,
      telemetry: [...(this.state.telemetryByAsset[id] ?? [])],
      tickets: this.listTickets({ assetId: id }),
    };
  }

  public createAsset(input: {
    assetTag: string;
    hostname: string;
    adOu: string;
    ipAddress: string;
    osName: string;
    osVersion: string;
    cpuModel: string;
    ramTotalGb: number;
    diskTotalGb: number;
    loggedUser: string;
    department: string;
  }): Asset {
    this.assertPermission(["admin", "technician"]);
    const now = new Date().toISOString();
    const asset: Asset = {
      id: `ast-${Math.random().toString(36).slice(2, 8)}`,
      assetTag: input.assetTag.toUpperCase(),
      hostname: input.hostname.toUpperCase(),
      domain: "corp.infradesk.local",
      adOu: input.adOu,
      ipAddress: input.ipAddress,
      macAddress: "00:15:5D:99:12:AF",
      osName: input.osName,
      osVersion: input.osVersion,
      cpuModel: input.cpuModel,
      ramTotalGb: input.ramTotalGb,
      diskTotalGb: input.diskTotalGb,
      loggedUser: input.loggedUser || "N/A",
      department: input.department,
      status: "online",
      cpuPercent: 18.5,
      ramPercent: 42.0,
      diskPercent: 36.0,
      idleMinutes: 0,
      uptimeHours: 2.4,
      topProcesses: ["explorer.exe", "infradesk-agent"],
      agentVersion: "2.1.0",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.state.assets.unshift(asset);
    this.state.telemetryByAsset[asset.id] = [
      {
        id: Date.now(),
        assetId: asset.id,
        cpuPercent: asset.cpuPercent,
        ramPercent: asset.ramPercent,
        diskPercent: asset.diskPercent,
        idleMinutes: 0,
        uptimeHours: 2.4,
        loggedUser: asset.loggedUser,
        topProcesses: asset.topProcesses,
        recordedAt: now,
      },
    ];
    this.pushAudit(
      "ASSET_CREATED",
      "asset",
      asset.id,
      `Ativo ${asset.hostname} (${asset.assetTag}) cadastrado em ${asset.adOu}.`
    );
    return asset;
  }

  public simulateTelemetryPulse(
    assetId: string,
    mode: "healthy" | "critical"
  ): { asset: Asset; sample: TelemetrySample; autoTicket: Ticket | null } {
    this.assertPermission(["admin", "technician"]);
    const asset = this.state.assets.find((a) => a.id === assetId);
    if (!asset) throw new Error("Ativo não encontrado.");

    const now = new Date().toISOString();
    const cpuPercent =
      mode === "critical" ? Number((93 + Math.random() * 6).toFixed(1)) : Number((22 + Math.random() * 20).toFixed(1));
    const ramPercent =
      mode === "critical" ? Number((91 + Math.random() * 7).toFixed(1)) : Number((45 + Math.random() * 18).toFixed(1));
    const diskPercent =
      mode === "critical" ? Math.max(asset.diskPercent, 94.2) : Math.min(asset.diskPercent, 72.0);

    const status: AssetStatus = mode === "critical" ? "warning" : "online";
    asset.cpuPercent = cpuPercent;
    asset.ramPercent = ramPercent;
    asset.diskPercent = diskPercent;
    asset.idleMinutes = 0;
    asset.status = status;
    asset.lastSeenAt = now;
    asset.updatedAt = now;

    const sample: TelemetrySample = {
      id: Date.now(),
      assetId: asset.id,
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
      recordedAt: now,
    };

    const list = this.state.telemetryByAsset[asset.id] ?? [];
    list.push(sample);
    this.state.telemetryByAsset[asset.id] = list.slice(-24);

    let autoTicket: Ticket | null = null;
    if (mode === "critical") {
      const hasOpen = this.state.tickets.some(
        (t) =>
          t.assetId === asset.id &&
          t.category === "telemetry_alert" &&
          t.status !== "resolved" &&
          t.status !== "closed"
      );
      if (!hasOpen) {
        autoTicket = this.createTicket({
          title: `[Alerta Automático] Saturação crítica em ${asset.hostname} (CPU ${cpuPercent}%, Disco ${diskPercent}%)`,
          description: `Incidente preventivo aberto pelo motor de telemetria InfraDesk após leitura crítica em ${asset.hostname} (${asset.ipAddress}).`,
          category: "telemetry_alert",
          priority: "critical",
          assetId: asset.id,
          requesterName: "InfraDesk Telemetry Engine",
          requesterDepartment: asset.department,
          autoGenerated: true,
        });
      }
    }

    this.pushAudit(
      "TELEMETRY_PULSE",
      "telemetry",
      asset.id,
      `Pulso de telemetria recebido de ${asset.hostname}: CPU ${cpuPercent}%, RAM ${ramPercent}%.`
    );

    return { asset: { ...asset }, sample, autoTicket };
  }

  public simulateAdDiscoverySync(): { created: number; updated: number } {
    this.assertPermission(["admin", "technician"]);
    const candidates = [
      {
        assetTag: "PAT-4012",
        hostname: "WKS-JUR-01",
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
        assetTag: "PAT-4018",
        hostname: "NB-DIR-02",
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
    ];

    let created = 0;
    let updated = 0;
    for (const c of candidates) {
      const exists = this.state.assets.find((a) => a.hostname === c.hostname);
      if (exists) {
        exists.lastSeenAt = new Date().toISOString();
        updated += 1;
      } else {
        this.createAsset(c);
        created += 1;
      }
    }
    updated += Math.max(0, this.state.assets.length - created);
    this.pushAudit(
      "AD_OU_SYNC",
      "ad_sync",
      "corp.infradesk.local",
      `Sincronização Active Directory concluída: ${created} novos computadores descobertos, ${updated} atualizados.`
    );
    return { created, updated };
  }

  public listTickets(filters?: {
    status?: string;
    priority?: string;
    assetId?: string;
    search?: string;
  }): Ticket[] {
    return this.state.tickets
      .map((t) => ({ ...t, ...evalSla(t) }))
      .filter((t) => {
        if (filters?.status && filters.status !== "all" && t.status !== filters.status) return false;
        if (filters?.priority && filters.priority !== "all" && t.priority !== filters.priority)
          return false;
        if (filters?.assetId && t.assetId !== filters.assetId) return false;
        if (filters?.search) {
          const q = filters.search.toLowerCase();
          const hit =
            t.code.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.requesterName.toLowerCase().includes(q) ||
            (t.assetHostname || "").toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      });
  }

  public getTicketDetail(id: string): { ticket: Ticket; comments: TicketComment[] } {
    const found = this.state.tickets.find((t) => t.id === id);
    if (!found) throw new Error("Chamado não encontrado.");
    return {
      ticket: { ...found, ...evalSla(found) },
      comments: [...(this.state.commentsByTicket[id] ?? [])],
    };
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
  }): Ticket {
    if (!input.autoGenerated) {
      this.assertPermission(["admin", "technician"]);
    }
    const now = new Date();
    const due = new Date(now.getTime() + SLA_HOURS[input.priority] * 3600 * 1000);
    const code = `INC-${1001 + this.state.tickets.length}`;
    const asset = input.assetId
      ? this.state.assets.find((a) => a.id === input.assetId) ?? null
      : null;
    const assignee = input.assigneeId
      ? DEMO_USERS.find((u) => u.id === input.assigneeId) ?? null
      : null;

    const base = {
      id: `tkt-${Date.now()}`,
      code,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      status: "open" as TicketStatus,
      assetId: asset?.id ?? null,
      assetHostname: asset?.hostname ?? null,
      requesterName: input.requesterName,
      requesterDepartment: input.requesterDepartment,
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.name ?? null,
      autoGenerated: Boolean(input.autoGenerated),
      slaDueAt: due.toISOString(),
      resolvedAt: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const full: Ticket = { ...base, ...evalSla(base) };
    this.state.tickets.unshift(full);

    this.pushAudit(
      input.autoGenerated ? "AUTO_TICKET_TRIGGERED" : "TICKET_CREATED",
      "ticket",
      full.id,
      `Chamado ${full.code} (${full.priority}) aberto: "${full.title}".`
    );
    return full;
  }

  public updateTicket(
    id: string,
    patch: Partial<{ status: TicketStatus; priority: TicketPriority; assigneeId: string | null }>
  ): Ticket {
    this.assertPermission(["admin", "technician"]);
    const ticket = this.state.tickets.find((t) => t.id === id);
    if (!ticket) throw new Error("Chamado não encontrado.");

    if (patch.priority) {
      ticket.priority = patch.priority;
      ticket.slaDueAt = new Date(
        new Date(ticket.createdAt).getTime() + SLA_HOURS[patch.priority] * 3600 * 1000
      ).toISOString();
    }
    if (patch.status) {
      ticket.status = patch.status;
      if (patch.status === "resolved" || patch.status === "closed") {
        ticket.resolvedAt = ticket.resolvedAt ?? new Date().toISOString();
      } else {
        ticket.resolvedAt = null;
      }
    }
    if (patch.assigneeId !== undefined) {
      ticket.assigneeId = patch.assigneeId;
      ticket.assigneeName = DEMO_USERS.find((u) => u.id === patch.assigneeId)?.name ?? null;
    }
    ticket.updatedAt = new Date().toISOString();

    this.pushAudit(
      "TICKET_UPDATED",
      "ticket",
      ticket.id,
      `Chamado ${ticket.code} atualizado para status "${ticket.status}".`
    );
    return { ...ticket, ...evalSla(ticket) };
  }

  public addComment(ticketId: string, body: string, internal = false): TicketComment {
    this.assertPermission(["admin", "technician"]);
    const actor = this.state.currentUser;
    const comment: TicketComment = {
      id: `cmt-${Date.now()}`,
      ticketId,
      authorName: actor.name,
      authorRole: actor.role,
      body,
      internal,
      createdAt: new Date().toISOString(),
    };
    const arr = this.state.commentsByTicket[ticketId] ?? [];
    arr.push(comment);
    this.state.commentsByTicket[ticketId] = arr;
    return comment;
  }

  public listAuditLogs(): AuditLog[] {
    return [...this.state.logs];
  }

  public getSummary(): DashboardSummary {
    const assets = this.state.assets;
    const tickets = this.listTickets();
    const active = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
    const nonBreached = tickets.filter((t) => t.slaState !== "breached").length;

    const ouMap = new Map<
      string,
      { adOu: string; department: string; count: number; warningCount: number; idleCount: number }
    >();
    for (const a of assets) {
      const entry = ouMap.get(a.adOu) ?? {
        adOu: a.adOu,
        department: a.department,
        count: 0,
        warningCount: 0,
        idleCount: 0,
      };
      entry.count += 1;
      if (a.status === "warning") entry.warningCount += 1;
      if (a.status === "idle") entry.idleCount += 1;
      ouMap.set(a.adOu, entry);
    }

    return {
      fleet: {
        total: assets.length,
        online: assets.filter((a) => a.status === "online").length,
        idle: assets.filter((a) => a.status === "idle").length,
        warning: assets.filter((a) => a.status === "warning").length,
        offline: assets.filter((a) => a.status === "offline").length,
        maintenance: assets.filter((a) => a.status === "maintenance").length,
        avgCpuPercent: Number(
          (assets.reduce((s, a) => s + a.cpuPercent, 0) / Math.max(1, assets.length)).toFixed(1)
        ),
        avgRamPercent: Number(
          (assets.reduce((s, a) => s + a.ramPercent, 0) / Math.max(1, assets.length)).toFixed(1)
        ),
        avgDiskPercent: Number(
          (assets.reduce((s, a) => s + a.diskPercent, 0) / Math.max(1, assets.length)).toFixed(1)
        ),
      },
      tickets: {
        totalActive: active.length,
        open: tickets.filter((t) => t.status === "open").length,
        inProgress: tickets.filter((t) => t.status === "in_progress").length,
        waitingUser: tickets.filter((t) => t.status === "waiting_user").length,
        resolvedToday: tickets.filter((t) => t.status === "resolved").length,
        criticalActive: active.filter((t) => t.priority === "critical").length,
        slaCompliancePercent: Number(
          ((nonBreached / Math.max(1, tickets.length)) * 100).toFixed(1)
        ),
        slaBreachedActive: active.filter((t) => t.slaState === "breached").length,
        slaAtRiskActive: active.filter((t) => t.slaState === "at_risk").length,
      },
      byOu: Array.from(ouMap.values()).sort((a, b) => b.count - a.count),
    };
  }
}

export const demoEngine = new DemoEngine();
