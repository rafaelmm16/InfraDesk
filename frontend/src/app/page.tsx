"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, Moon, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { AssetDetailModal } from "@/components/AssetDetailModal";
import { CreateTicketModal, TicketDetailModal } from "@/components/TicketModal";
import { apiClient } from "@/lib/api";
import type {
  Asset,
  AssetStatus,
  AuditLog,
  DashboardSummary,
  Role,
  SlaState,
  TelemetrySample,
  Ticket,
  TicketComment,
  TicketPriority,
  TicketStatus,
  User,
} from "@/lib/types";

type NavSection = "overview" | "endpoints" | "tickets" | "governance";

const STATUS_META: Record<AssetStatus, { label: string; dot: string }> = {
  online: { label: "Ativo", dot: "bg-emerald-600" },
  idle: { label: "Ocioso", dot: "bg-amber-500" },
  warning: { label: "Crítico", dot: "bg-red-600" },
  offline: { label: "Sem resposta", dot: "bg-zinc-400" },
  maintenance: { label: "Manutenção", dot: "bg-zinc-500" },
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  critical: "P1 · Crítica",
  high: "P2 · Alta",
  medium: "P3 · Média",
  low: "P4 · Baixa",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em atendimento",
  waiting_user: "Aguardando",
  resolved: "Resolvido",
  closed: "Encerrado",
};

const SLA_STYLE: Record<SlaState, { text: string; label: string }> = {
  on_track: { text: "text-[var(--ink-secondary)]", label: "No prazo" },
  at_risk: { text: "text-amber-600 dark:text-amber-400 font-medium", label: "Em risco" },
  breached: { text: "text-red-600 dark:text-red-400 font-semibold", label: "Violado" },
  met: { text: "text-emerald-700 dark:text-emerald-400", label: "Cumprido" },
};

const KANBAN_COLUMNS: Array<{ status: TicketStatus; title: string }> = [
  { status: "open", title: "Abertos" },
  { status: "in_progress", title: "Em atendimento" },
  { status: "waiting_user", title: "Aguardando retorno" },
  { status: "resolved", title: "Resolvidos" },
];

function formatMinutes(mins: number): string {
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const txt = h > 0 ? `${h}h${m > 0 ? ` ${m}m` : ""}` : `${m}m`;
  return mins < 0 ? `atraso ${txt}` : txt;
}

function shortOu(adOu: string): string {
  const first = adOu.split(",")[0] || adOu;
  return first.replace(/^OU=/i, "");
}

export default function InfraDeskConsolePage() {
  const [section, setSection] = useState<NavSection>("overview");
  const [ticketView, setTicketView] = useState<"table" | "kanban">("table");
  const [darkTheme, setDarkTheme] = useState(false);

  const [loading, setLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  const [assetSearch, setAssetSearch] = useState("");
  const [assetOuFilter, setAssetOuFilter] = useState("all");
  const [assetStatusFilter, setAssetStatusFilter] = useState("all");

  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketPriorityFilter, setTicketPriorityFilter] = useState("all");
  const [ticketStatusFilter, setTicketStatusFilter] = useState("all");

  const [selectedAssetBundle, setSelectedAssetBundle] = useState<{
    asset: Asset;
    telemetry: TelemetrySample[];
    tickets: Ticket[];
  } | null>(null);

  const [selectedTicketBundle, setSelectedTicketBundle] = useState<{
    ticket: Ticket;
    comments: TicketComment[];
  } | null>(null);

  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [createTicketAssetId, setCreateTicketAssetId] = useState<string | null>(null);

  const [notice, setNotice] = useState<{ tone: "normal" | "error"; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkTheme);
  }, [darkTheme]);

  const refreshAll = useCallback(async () => {
    const [sum, ast, tkt, logs, usr] = await Promise.all([
      apiClient.getSummary(),
      apiClient.listAssets(),
      apiClient.listTickets(),
      apiClient.listAuditLogs(),
      apiClient.listUsers(),
    ]);
    setSummary(sum);
    setAssets(ast);
    setTickets(tkt);
    setAuditLogs(logs);
    setUsers(usr);
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let active = true;

    async function boot() {
      setLoading(true);
      const session = await apiClient.initializeSession();
      if (!active) return;
      setDemoMode(session.demoMode);
      setCurrentUser(session.user);
      await refreshAll();
      if (!active) return;
      setLoading(false);

      const wsUrl = apiClient.getWebSocketUrl();
      if (wsUrl) {
        try {
          ws = new WebSocket(wsUrl);
          ws.onmessage = () => {
            void refreshAll();
          };
        } catch {
          // silent fallback
        }
      }
    }

    void boot();
    return () => {
      active = false;
      ws?.close();
    };
  }, [refreshAll]);

  const distinctOus = useMemo(() => Array.from(new Set(assets.map((a) => a.adOu))), [assets]);

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      if (assetStatusFilter !== "all" && a.status !== assetStatusFilter) return false;
      if (assetOuFilter !== "all" && a.adOu !== assetOuFilter) return false;
      if (assetSearch.trim()) {
        const q = assetSearch.toLowerCase();
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
  }, [assets, assetStatusFilter, assetOuFilter, assetSearch]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (ticketPriorityFilter !== "all" && t.priority !== ticketPriorityFilter) return false;
      if (ticketStatusFilter !== "all" && t.status !== ticketStatusFilter) return false;
      if (ticketSearch.trim()) {
        const q = ticketSearch.toLowerCase();
        const hit =
          t.code.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.requesterName.toLowerCase().includes(q) ||
          (t.assetHostname || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [tickets, ticketPriorityFilter, ticketStatusFilter, ticketSearch]);

  const attentionAssets = useMemo(
    () => assets.filter((a) => a.status === "warning" || a.idleMinutes >= 40),
    [assets]
  );

  const urgentTickets = useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.status !== "resolved" &&
          t.status !== "closed" &&
          (t.priority === "critical" || t.slaState === "at_risk" || t.slaState === "breached")
      ),
    [tickets]
  );

  const canOperate = currentUser?.role === "admin" || currentUser?.role === "technician";

  const handleRoleSwitch = async (role: Role) => {
    try {
      const user = await apiClient.switchRoleQuick(role);
      setCurrentUser(user);
      await refreshAll();
      setNotice({ tone: "normal", text: `Sessão alterada para ${user.name} (${user.role}).` });
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Erro ao alternar usuário.",
      });
    }
  };

  const handleInspectAsset = async (id: string) => {
    try {
      const detail = await apiClient.getAssetDetail(id);
      setSelectedAssetBundle(detail);
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Falha ao ler ativo." });
    }
  };

  const handleSimulatePulse = async (mode: "healthy" | "critical") => {
    if (!selectedAssetBundle) return;
    setBusyAction(true);
    try {
      const res = await apiClient.simulateTelemetryPulse(selectedAssetBundle.asset, mode);
      await refreshAll();
      const updated = await apiClient.getAssetDetail(selectedAssetBundle.asset.id);
      setSelectedAssetBundle(updated);

      if (res.autoTicket) {
        setNotice({
          tone: "error",
          text: `Alerta em ${res.asset.hostname}: chamado ${res.autoTicket.code} gerado automaticamente.`,
        });
      } else {
        setNotice({
          tone: "normal",
          text: `Leitura recebida de ${res.asset.hostname} (CPU ${res.sample.cpuPercent}% · RAM ${res.sample.ramPercent}%).`,
        });
      }
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Falha ao enviar leitura.",
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleAdSync = async () => {
    setBusyAction(true);
    try {
      const res = await apiClient.triggerAdSync();
      await refreshAll();
      setNotice({
        tone: "normal",
        text: `Active Directory sincronizado: ${res.created} adicionados, ${res.updated} verificados.`,
      });
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Erro ao sincronizar AD.",
      });
    } finally {
      setBusyAction(false);
    }
  };

  const handleInspectTicket = async (id: string) => {
    try {
      const detail = await apiClient.getTicketDetail(id);
      setSelectedTicketBundle(detail);
    } catch (err) {
      setNotice({
        tone: "error",
        text: err instanceof Error ? err.message : "Erro ao carregar chamado.",
      });
    }
  };

  const handleExportCsv = () => {
    const header = [
      "Patrimonio",
      "Hostname",
      "OU",
      "Setor",
      "IP",
      "Usuario",
      "Status",
      "CPU_Pct",
      "RAM_Pct",
      "Disco_Pct",
      "Inativo_Min",
    ];
    const rows = assets.map((a) => [
      a.assetTag,
      a.hostname,
      `"${a.adOu}"`,
      `"${a.department}"`,
      a.ipAddress,
      a.loggedUser,
      a.status,
      a.cpuPercent,
      a.ramPercent,
      a.diskPercent,
      a.idleMinutes,
    ]);
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `inventario-ad-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyCommand = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 1800);
  };

  if (loading || !summary || !currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
        Carregando inventário...
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Top Operational Bar */}
      <header className="border-b border-[var(--border-hairline)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          {/* Brand + Context Breadcrumb */}
          <div className="flex items-center gap-2.5">
            <div className="flex h-5 w-5 items-center justify-center bg-[var(--ink-primary)] text-[10px] font-bold text-[var(--bg-surface)]">
              ID
            </div>
            <span className="text-sm font-semibold tracking-tight">InfraDesk</span>
            <span className="text-[var(--border-strong)]">/</span>
            <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--ink-secondary)]">
              corp.infradesk.local
            </span>
            <span className="ml-1 inline-flex items-center gap-1.5 border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  demoMode ? "bg-amber-500" : "bg-emerald-600"
                }`}
              />
              {demoMode ? "demo local" : "api conectada"}
            </span>
          </div>

          {/* Right Controls */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 text-[var(--ink-secondary)]">
              <span className="hidden sm:inline text-[var(--ink-muted)]">Perfil:</span>
              <select
                value={currentUser.role}
                onChange={(e) => void handleRoleSwitch(e.target.value as Role)}
                className="rounded border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-1 text-xs font-medium text-[var(--ink-primary)] outline-none"
              >
                <option value="admin">Rafael Merlo · Admin</option>
                <option value="technician">Lucas Ferreira · Técnico N2</option>
                <option value="viewer">Camila Martins · Auditoria (Leitura)</option>
              </select>
            </label>

            <button
              onClick={() => setDarkTheme((d) => !d)}
              title="Alternar tema claro/escuro"
              className="rounded border border-[var(--border-hairline)] p-1.5 text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)]"
            >
              {darkTheme ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>

            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--border-hairline)] px-2.5 py-1 text-xs font-medium text-[var(--ink-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink-primary)]"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>

            <button
              disabled={!canOperate}
              onClick={() => {
                setCreateTicketAssetId(null);
                setCreateTicketOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded bg-[var(--ink-primary)] px-3 py-1 text-xs font-medium text-[var(--bg-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Abrir chamado
            </button>
          </div>
        </div>

        {/* Underline Navigation Bar */}
        <div className="mx-auto flex max-w-[1320px] gap-6 overflow-x-auto px-5">
          {(
            [
              { id: "overview", label: "Visão geral" },
              { id: "endpoints", label: "Inventário & AD", count: summary.fleet.total },
              { id: "tickets", label: "Chamados", count: summary.tickets.totalActive },
              { id: "governance", label: "Auditoria & Agente" },
            ] as Array<{ id: NavSection; label: string; count?: number }>
          ).map((tab) => {
            const active = section === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSection(tab.id)}
                className={`flex items-center gap-1.5 border-b-2 py-2.5 text-xs whitespace-nowrap transition ${
                  active
                    ? "border-[var(--ink-primary)] font-semibold text-[var(--ink-primary)]"
                    : "border-transparent text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                }`}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="tabular font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-[1320px] space-y-6 px-5 py-6">
        {notice && (
          <div
            className={`flex items-center justify-between border px-3.5 py-2 text-xs ${
              notice.tone === "error"
                ? "border-red-600/40 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--ink-primary)]"
            }`}
          >
            <span>{notice.text}</span>
            <button
              onClick={() => setNotice(null)}
              className="ml-4 text-[11px] text-[var(--ink-muted)] underline"
            >
              dispensar
            </button>
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {section === "overview" && (
          <div className="space-y-6">
            {/* Horizontal Ledger Strip (Zero floating cards or corner icons) */}
            <div className="grid grid-cols-2 divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-surface)] sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              <div className="p-4">
                <div className="text-xs text-[var(--ink-secondary)]">Máquinas no domínio</div>
                <div className="tabular mt-1 font-[family-name:var(--font-mono)] text-2xl font-semibold">
                  {summary.fleet.total}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  {summary.fleet.online} em operação normal
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-[var(--ink-secondary)]">Saturação / Alerta</div>
                <div
                  className={`tabular mt-1 font-[family-name:var(--font-mono)] text-2xl font-semibold ${
                    summary.fleet.warning > 0 ? "text-red-600 dark:text-red-400" : ""
                  }`}
                >
                  {summary.fleet.warning}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  CPU média {summary.fleet.avgCpuPercent}% · RAM {summary.fleet.avgRamPercent}%
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-[var(--ink-secondary)]">Estações ociosas</div>
                <div className="tabular mt-1 font-[family-name:var(--font-mono)] text-2xl font-semibold">
                  {summary.fleet.idle}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  Sem input &ge; 30 min
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-[var(--ink-secondary)]">Chamados ativos</div>
                <div className="tabular mt-1 font-[family-name:var(--font-mono)] text-2xl font-semibold">
                  {summary.tickets.totalActive}
                </div>
                <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  {summary.tickets.criticalActive} prioridade P1
                </div>
              </div>

              <div className="col-span-2 p-4 sm:col-span-1">
                <div className="text-xs text-[var(--ink-secondary)]">Cumprimento de SLA</div>
                <div className="tabular mt-1 font-[family-name:var(--font-mono)] text-2xl font-semibold">
                  {summary.tickets.slaCompliancePercent}%
                </div>
                <div className="mt-1 text-[11px] text-[var(--ink-muted)]">
                  {summary.tickets.slaAtRiskActive} em risco · {summary.tickets.slaBreachedActive} vencidos
                </div>
              </div>
            </div>

            {/* Asymmetric 2-Column Operational Workbench */}
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-8">
                {/* Priority Queue */}
                <section>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
                      Atenção imediata (SLA &amp; Endpoints)
                    </h2>
                    <button
                      onClick={() => setSection("tickets")}
                      className="text-xs text-[var(--ink-secondary)] underline underline-offset-2 hover:text-[var(--ink-primary)]"
                    >
                      Fila completa
                    </button>
                  </div>

                  <div className="divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                    {urgentTickets.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => void handleInspectTicket(t.id)}
                        className="flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 text-xs hover:bg-[var(--bg-subtle)]"
                      >
                        <div className="min-w-0">
                          <span className="mr-2.5 font-[family-name:var(--font-mono)] text-[var(--ink-muted)]">
                            {t.code}
                          </span>
                          <span className="font-medium text-[var(--ink-primary)]">{t.title}</span>
                        </div>
                        <div className="tabular flex shrink-0 items-center gap-3 font-[family-name:var(--font-mono)] text-[11px]">
                          {t.assetHostname && (
                            <span className="text-[var(--ink-secondary)]">{t.assetHostname}</span>
                          )}
                          <span className={SLA_STYLE[t.slaState].text}>
                            {formatMinutes(t.slaRemainingMinutes)}
                          </span>
                        </div>
                      </div>
                    ))}

                    {attentionAssets.map((a) => (
                      <div
                        key={a.id}
                        onClick={() => void handleInspectAsset(a.id)}
                        className="flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 text-xs hover:bg-[var(--bg-subtle)]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              STATUS_META[a.status].dot
                            }`}
                          />
                          <span className="font-[family-name:var(--font-mono)] font-medium">
                            {a.hostname}
                          </span>
                          <span className="truncate text-[var(--ink-secondary)]">
                            — {a.department} ({a.loggedUser})
                          </span>
                        </div>
                        <span className="tabular shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                          {a.status === "warning"
                            ? `CPU ${a.cpuPercent}% · Disco ${a.diskPercent}%`
                            : `Inativo há ${a.idleMinutes}m`}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Active Directory OUs Table */}
                <section>
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
                      Unidades Organizacionais (Active Directory)
                    </h2>
                    <button
                      onClick={() => setSection("endpoints")}
                      className="text-xs text-[var(--ink-secondary)] underline underline-offset-2 hover:text-[var(--ink-primary)]"
                    >
                      Filtrar máquinas
                    </button>
                  </div>

                  <div className="overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--ink-secondary)]">
                          <th className="px-3.5 py-2">Setor</th>
                          <th className="px-3.5 py-2">Distinguished Name (OU)</th>
                          <th className="px-3.5 py-2 text-right">Hosts</th>
                          <th className="px-3.5 py-2 text-right">Ociosos</th>
                          <th className="px-3.5 py-2 text-right">Críticos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-hairline)]">
                        {summary.byOu.map((ou) => (
                          <tr
                            key={ou.adOu}
                            onClick={() => {
                              setAssetOuFilter(ou.adOu);
                              setSection("endpoints");
                            }}
                            className="cursor-pointer hover:bg-[var(--bg-subtle)]"
                          >
                            <td className="px-3.5 py-2 font-medium">{ou.department}</td>
                            <td className="max-w-[280px] truncate px-3.5 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                              {ou.adOu}
                            </td>
                            <td className="tabular px-3.5 py-2 text-right font-[family-name:var(--font-mono)]">
                              {ou.count}
                            </td>
                            <td className="tabular px-3.5 py-2 text-right font-[family-name:var(--font-mono)] text-[var(--ink-secondary)]">
                              {ou.idleCount || "—"}
                            </td>
                            <td
                              className={`tabular px-3.5 py-2 text-right font-[family-name:var(--font-mono)] ${
                                ou.warningCount > 0
                                  ? "font-semibold text-red-600 dark:text-red-400"
                                  : "text-[var(--ink-muted)]"
                              }`}
                            >
                              {ou.warningCount || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              {/* Right Column: Chronological Log Stream */}
              <aside className="lg:col-span-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
                    Registro de operações
                  </h2>
                  <button
                    onClick={() => setSection("governance")}
                    className="text-xs text-[var(--ink-secondary)] underline underline-offset-2 hover:text-[var(--ink-primary)]"
                  >
                    Ver tudo
                  </button>
                </div>

                <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
                  <ol className="space-y-4 border-l border-[var(--border-strong)] pl-3.5">
                    {auditLogs.slice(0, 6).map((log) => (
                      <li key={log.id} className="text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-[family-name:var(--font-mono)] text-[11px] font-medium text-[var(--ink-primary)]">
                            {log.action}
                          </span>
                          <time className="tabular font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--ink-muted)]">
                            {new Date(log.createdAt).toLocaleTimeString("pt-BR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                        <p className="mt-0.5 leading-snug text-[var(--ink-secondary)]">
                          {log.summary}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
                          {log.actorName}
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              </aside>
            </div>
          </div>
        )}

        {/* TAB 2: INVENTORY & ENDPOINTS */}
        {section === "endpoints" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-[var(--ink-muted)]" />
                  <input
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    placeholder="Filtrar por host, patrimônio, IP ou usuário..."
                    className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] py-1.5 pr-3 pl-8 text-xs outline-none focus:border-[var(--ink-primary)]"
                  />
                </div>

                <select
                  value={assetOuFilter}
                  onChange={(e) => setAssetOuFilter(e.target.value)}
                  className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="all">Unidade AD: Todas</option>
                  {distinctOus.map((ou) => (
                    <option key={ou} value={ou}>
                      OU: {shortOu(ou)}
                    </option>
                  ))}
                </select>

                <select
                  value={assetStatusFilter}
                  onChange={(e) => setAssetStatusFilter(e.target.value)}
                  className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="all">Status: Todos</option>
                  <option value="warning">Crítico / Saturação</option>
                  <option value="online">Ativo</option>
                  <option value="idle">Ocioso (&ge;30m)</option>
                  <option value="offline">Sem resposta</option>
                </select>
              </div>

              <button
                disabled={!canOperate || busyAction}
                onClick={() => void handleAdSync()}
                className="inline-flex items-center gap-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--bg-subtle)] disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busyAction ? "animate-spin" : ""}`} />
                Sincronizar Active Directory
              </button>
            </div>

            <div className="overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--ink-secondary)]">
                    <th className="px-3.5 py-2.5">Máquina</th>
                    <th className="px-3.5 py-2.5">Unidade / Setor</th>
                    <th className="px-3.5 py-2.5">Sessão</th>
                    <th className="px-3.5 py-2.5">Estado</th>
                    <th className="px-3.5 py-2.5 text-right">CPU</th>
                    <th className="px-3.5 py-2.5 text-right">RAM</th>
                    <th className="px-3.5 py-2.5 text-right">Disco</th>
                    <th className="px-3.5 py-2.5 text-right">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-hairline)]">
                  {filteredAssets.map((a) => {
                    const st = STATUS_META[a.status];
                    return (
                      <tr
                        key={a.id}
                        onClick={() => void handleInspectAsset(a.id)}
                        className="cursor-pointer hover:bg-[var(--bg-subtle)]"
                      >
                        <td className="px-3.5 py-2.5">
                          <span className="font-[family-name:var(--font-mono)] font-medium text-[var(--ink-primary)]">
                            {a.hostname}
                          </span>
                          <span className="ml-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                            {a.assetTag}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-[var(--ink-secondary)]">
                          {a.department}
                          <span className="ml-1.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                            ({shortOu(a.adOu)})
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[11.5px]">
                          {a.loggedUser}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            <span>{st.label}</span>
                            {a.idleMinutes > 0 && (
                              <span className="tabular font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                                · {a.idleMinutes}m
                              </span>
                            )}
                          </span>
                        </td>
                        <td
                          className={`tabular px-3.5 py-2.5 text-right font-[family-name:var(--font-mono)] ${
                            a.cpuPercent >= 90
                              ? "font-semibold text-red-600 dark:text-red-400"
                              : ""
                          }`}
                        >
                          {a.cpuPercent.toFixed(1)}%
                        </td>
                        <td className="tabular px-3.5 py-2.5 text-right font-[family-name:var(--font-mono)]">
                          {a.ramPercent.toFixed(1)}%
                        </td>
                        <td
                          className={`tabular px-3.5 py-2.5 text-right font-[family-name:var(--font-mono)] ${
                            a.diskPercent >= 90
                              ? "font-semibold text-red-600 dark:text-red-400"
                              : ""
                          }`}
                        >
                          {a.diskPercent.toFixed(1)}%
                        </td>
                        <td className="tabular px-3.5 py-2.5 text-right font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                          {a.ipAddress}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: SERVICE DESK & SLA */}
        {section === "tickets" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-[var(--ink-muted)]" />
                  <input
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    placeholder="Buscar protocolo, assunto, solicitante ou host..."
                    className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] py-1.5 pr-3 pl-8 text-xs outline-none focus:border-[var(--ink-primary)]"
                  />
                </div>

                <select
                  value={ticketPriorityFilter}
                  onChange={(e) => setTicketPriorityFilter(e.target.value)}
                  className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="all">Prioridade: Todas</option>
                  <option value="critical">P1 · Crítica (2h)</option>
                  <option value="high">P2 · Alta (8h)</option>
                  <option value="medium">P3 · Média (24h)</option>
                  <option value="low">P4 · Baixa (48h)</option>
                </select>

                {ticketView === "table" && (
                  <select
                    value={ticketStatusFilter}
                    onChange={(e) => setTicketStatusFilter(e.target.value)}
                    className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs outline-none"
                  >
                    <option value="all">Estágio: Todos</option>
                    <option value="open">Aberto</option>
                    <option value="in_progress">Em atendimento</option>
                    <option value="waiting_user">Aguardando retorno</option>
                    <option value="resolved">Resolvido</option>
                  </select>
                )}
              </div>

              {/* Clean Segmented Switch */}
              <div className="inline-flex rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] text-xs">
                <button
                  onClick={() => setTicketView("table")}
                  className={`px-3 py-1.5 ${
                    ticketView === "table"
                      ? "bg-[var(--bg-subtle)] font-semibold text-[var(--ink-primary)]"
                      : "text-[var(--ink-secondary)]"
                  }`}
                >
                  Lista
                </button>
                <button
                  onClick={() => setTicketView("kanban")}
                  className={`border-l border-[var(--border-strong)] px-3 py-1.5 ${
                    ticketView === "kanban"
                      ? "bg-[var(--bg-subtle)] font-semibold text-[var(--ink-primary)]"
                      : "text-[var(--ink-secondary)]"
                  }`}
                >
                  Colunas
                </button>
              </div>
            </div>

            {ticketView === "table" ? (
              <div className="overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--ink-secondary)]">
                      <th className="px-3.5 py-2.5">Código</th>
                      <th className="px-3.5 py-2.5">Assunto</th>
                      <th className="px-3.5 py-2.5">Ativo</th>
                      <th className="px-3.5 py-2.5">Prioridade</th>
                      <th className="px-3.5 py-2.5">Estágio</th>
                      <th className="px-3.5 py-2.5">Responsável</th>
                      <th className="px-3.5 py-2.5 text-right">SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {filteredTickets.map((t) => {
                      const sla = SLA_STYLE[t.slaState];
                      return (
                        <tr
                          key={t.id}
                          onClick={() => void handleInspectTicket(t.id)}
                          className="cursor-pointer hover:bg-[var(--bg-subtle)]"
                        >
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[var(--ink-secondary)]">
                            {t.code}
                          </td>
                          <td className="px-3.5 py-2.5">
                            <div className="font-medium text-[var(--ink-primary)]">{t.title}</div>
                            <div className="text-[11px] text-[var(--ink-muted)]">
                              {t.requesterName} · {t.requesterDepartment}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--ink-secondary)]">
                            {t.assetHostname || "—"}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[11px]">
                            {PRIORITY_LABEL[t.priority]}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-[var(--ink-secondary)]">
                            {STATUS_LABEL[t.status]}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 text-[var(--ink-secondary)]">
                            {t.assigneeName || "Fila N1"}
                          </td>
                          <td
                            className={`tabular whitespace-nowrap px-3.5 py-2.5 text-right font-[family-name:var(--font-mono)] text-[11.5px] ${sla.text}`}
                          >
                            {sla.label} ({formatMinutes(t.slaRemainingMinutes)})
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-4">
                {KANBAN_COLUMNS.map((col) => {
                  const colTickets = filteredTickets.filter((t) => t.status === col.status);
                  return (
                    <div key={col.status} className="space-y-2">
                      <div className="flex items-center justify-between border-b border-[var(--border-strong)] pb-1.5 text-xs">
                        <span className="font-semibold text-[var(--ink-primary)]">{col.title}</span>
                        <span className="tabular font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                          {colTickets.length}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {colTickets.map((t) => {
                          const sla = SLA_STYLE[t.slaState];
                          return (
                            <div
                              key={t.id}
                              onClick={() => void handleInspectTicket(t.id)}
                              className="cursor-pointer border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-3 hover:border-[var(--border-strong)]"
                            >
                              <div className="flex items-center justify-between font-[family-name:var(--font-mono)] text-[11px]">
                                <span className="text-[var(--ink-muted)]">{t.code}</span>
                                <span className={sla.text}>
                                  {formatMinutes(t.slaRemainingMinutes)}
                                </span>
                              </div>
                              <p className="mt-1.5 line-clamp-2 text-xs font-medium text-[var(--ink-primary)]">
                                {t.title}
                              </p>
                              <div className="mt-2.5 flex items-center justify-between font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--ink-muted)]">
                                <span>{PRIORITY_LABEL[t.priority]}</span>
                                <span>{t.assetHostname || t.assigneeName || "N1"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: GOVERNANCE, AUDIT & CLI AGENT */}
        {section === "governance" && (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-[var(--ink-primary)]">
                    Agente local (Node.js / Windows &amp; Linux)
                  </h2>
                  <button
                    onClick={() =>
                      void copyCommand(
                        "node-agent",
                        'npm --prefix agent run collect:once -- --url "http://localhost:3333" --ou "OU=Engenharia,DC=corp,DC=local"'
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  >
                    {copiedCmd === "node-agent" ? (
                      <>
                        <Check className="h-3 w-3" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copiar
                      </>
                    )}
                  </button>
                </div>
                <pre className="mt-2.5 overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-2.5 font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--ink-primary)]">
                  {`npm --prefix agent run collect:once -- \\
  --url "http://localhost:3333" \\
  --key "idk_live_agent_9f8e7d6c5b4a"`}
                </pre>
              </div>

              <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-[var(--ink-primary)]">
                    Coletor de domínio via WinRM (PowerShell)
                  </h2>
                  <button
                    onClick={() =>
                      void copyCommand(
                        "ps-agent",
                        '.\\agent\\scripts\\Collect-ADEndpoints.ps1 -ApiUrl "http://localhost:3333" -SearchBaseOU "OU=Workstations,DC=corp,DC=local"'
                      )
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
                  >
                    {copiedCmd === "ps-agent" ? (
                      <>
                        <Check className="h-3 w-3" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copiar
                      </>
                    )}
                  </button>
                </div>
                <pre className="mt-2.5 overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-2.5 font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--ink-primary)]">
                  {`.\\agent\\scripts\\Collect-ADEndpoints.ps1 \`
  -ApiUrl "http://localhost:3333" \`
  -SearchBaseOU "OU=Workstations,DC=corp,DC=local"`}
                </pre>
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ink-secondary)]">
                Trilha de auditoria ({auditLogs.length} registros)
              </h2>
              <div className="overflow-x-auto border border-[var(--border-hairline)] bg-[var(--bg-surface)]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--ink-secondary)]">
                      <th className="px-3.5 py-2">Horário</th>
                      <th className="px-3.5 py-2">Usuário</th>
                      <th className="px-3.5 py-2">Papel</th>
                      <th className="px-3.5 py-2">Operação</th>
                      <th className="px-3.5 py-2">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-hairline)]">
                    {auditLogs.map((l) => (
                      <tr key={l.id} className="hover:bg-[var(--bg-subtle)]">
                        <td className="tabular whitespace-nowrap px-3.5 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
                          {new Date(l.createdAt).toLocaleString("pt-BR")}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2 font-medium">{l.actorName}</td>
                        <td className="whitespace-nowrap px-3.5 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                          {l.actorRole}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2 font-[family-name:var(--font-mono)] text-[11px]">
                          {l.action}
                        </td>
                        <td className="px-3.5 py-2 text-[var(--ink-secondary)]">{l.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Slide-Over Drawers & Modals */}
      {selectedAssetBundle && (
        <AssetDetailModal
          asset={selectedAssetBundle.asset}
          telemetry={selectedAssetBundle.telemetry}
          tickets={selectedAssetBundle.tickets}
          userRole={currentUser.role}
          busy={busyAction}
          onClose={() => setSelectedAssetBundle(null)}
          onSimulatePulse={(mode) => void handleSimulatePulse(mode)}
          onOpenCreateTicketForAsset={(asset) => {
            setSelectedAssetBundle(null);
            setCreateTicketAssetId(asset.id);
            setCreateTicketOpen(true);
          }}
        />
      )}

      {createTicketOpen && (
        <CreateTicketModal
          assets={assets}
          users={users}
          preselectedAssetId={createTicketAssetId}
          onClose={() => setCreateTicketOpen(false)}
          onSubmit={async (payload) => {
            const created = await apiClient.createTicket(payload);
            await refreshAll();
            setNotice({ tone: "normal", text: `Chamado ${created.code} registrado.` });
          }}
        />
      )}

      {selectedTicketBundle && (
        <TicketDetailModal
          ticket={selectedTicketBundle.ticket}
          comments={selectedTicketBundle.comments}
          users={users}
          userRole={currentUser.role}
          onClose={() => setSelectedTicketBundle(null)}
          onUpdateStatus={async (status) => {
            await apiClient.updateTicket(selectedTicketBundle.ticket.id, { status });
            const refreshed = await apiClient.getTicketDetail(selectedTicketBundle.ticket.id);
            setSelectedTicketBundle(refreshed);
            await refreshAll();
          }}
          onUpdateAssignee={async (assigneeId) => {
            await apiClient.updateTicket(selectedTicketBundle.ticket.id, { assigneeId });
            const refreshed = await apiClient.getTicketDetail(selectedTicketBundle.ticket.id);
            setSelectedTicketBundle(refreshed);
            await refreshAll();
          }}
          onAddComment={async (body, internal) => {
            await apiClient.addTicketComment(selectedTicketBundle.ticket.id, body, internal);
            const refreshed = await apiClient.getTicketDetail(selectedTicketBundle.ticket.id);
            setSelectedTicketBundle(refreshed);
          }}
        />
      )}
    </div>
  );
}
