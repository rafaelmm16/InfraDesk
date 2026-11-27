import { collectEndpointSnapshot } from "./collector.ts";

interface CliFlags {
  once: boolean;
  dryRun: boolean;
  intervalSec: number;
  apiUrl: string;
  agentKey: string;
  adOu?: string;
  department?: string;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    once: argv.includes("--once"),
    dryRun: argv.includes("--dry-run"),
    intervalSec: Number(process.env.INFRADESK_INTERVAL_SEC || 30),
    apiUrl: (process.env.INFRADESK_API_URL || "http://localhost:3333").replace(/\/$/, ""),
    agentKey: process.env.AGENT_API_KEY || "idk_live_agent_9f8e7d6c5b4a",
    adOu: process.env.INFRADESK_AD_OU,
    department: process.env.INFRADESK_DEPARTMENT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--interval" && next) flags.intervalSec = Math.max(5, Number(next));
    if (arg === "--url" && next) flags.apiUrl = next.replace(/\/$/, "");
    if (arg === "--key" && next) flags.agentKey = next;
    if (arg === "--ou" && next) flags.adOu = next;
    if (arg === "--department" && next) flags.department = next;
  }

  return flags;
}

async function pushOnce(flags: CliFlags): Promise<void> {
  const snapshot = await collectEndpointSnapshot({
    adOu: flags.adOu,
    department: flags.department,
  });

  if (flags.dryRun) {
    console.log("[InfraDesk Agent][DRY-RUN] Snapshot coletado:");
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const endpoint = `${flags.apiUrl}/api/telemetry/ingest`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-key": flags.agentKey,
    },
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const body = (await response.json()) as {
    asset?: { hostname: string; status: string };
    autoTicket?: { code: string } | null;
  };
  const autoInfo = body.autoTicket ? ` | Auto-Ticket aberto: ${body.autoTicket.code}` : "";
  console.log(
    `[${new Date().toISOString()}] Telemetria enviada -> ${snapshot.hostname} ` +
      `(CPU ${snapshot.cpuPercent}% | RAM ${snapshot.ramPercent}% | Disco ${snapshot.diskPercent}% | Ocioso ${snapshot.idleMinutes}m)` +
      autoInfo
  );
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  console.log(`🛰️  InfraDesk Endpoint Agent v2.1.0 iniciado -> ${flags.apiUrl}`);

  if (flags.once) {
    await pushOnce(flags);
    return;
  }

  // Loop contínuo do daemon
  while (true) {
    try {
      await pushOnce(flags);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] Falha no envio de telemetria: ${msg}`);
    }
    await new Promise((resolve) => setTimeout(resolve, flags.intervalSec * 1000));
  }
}

main().catch((err) => {
  console.error("Erro fatal no InfraDesk Agent:", err);
  process.exit(1);
});
