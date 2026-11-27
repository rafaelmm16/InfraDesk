import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface EndpointTelemetryPayload {
  hostname: string;
  domain: string;
  adOu: string;
  department: string;
  ipAddress: string;
  macAddress: string;
  osName: string;
  osVersion: string;
  cpuModel: string;
  ramTotalGb: number;
  diskTotalGb: number;
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  idleMinutes: number;
  uptimeHours: number;
  loggedUser: string;
  topProcesses: string[];
  agentVersion: string;
}

export interface CpuTickSnapshot {
  idle: number;
  total: number;
}

export function readCpuTicks(cpus = os.cpus()): CpuTickSnapshot {
  let idle = 0;
  let total = 0;
  for (const core of cpus) {
    idle += core.times.idle;
    total +=
      core.times.user +
      core.times.nice +
      core.times.sys +
      core.times.irq +
      core.times.idle;
  }
  return { idle, total };
}

export function computeCpuPercentFromTicks(
  start: CpuTickSnapshot,
  end: CpuTickSnapshot
): number {
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (totalDelta <= 0) return 0;
  const busyRatio = 1 - idleDelta / totalDelta;
  return Number(Math.max(0, Math.min(100, busyRatio * 100)).toFixed(1));
}

export function detectPrimaryNetwork(
  interfaces = os.networkInterfaces()
): { ipAddress: string; macAddress: string } {
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === "IPv4" && !net.internal && net.address) {
        return {
          ipAddress: net.address,
          macAddress: (net.mac || "00:00:00:00:00:00").toUpperCase(),
        };
      }
    }
  }
  return { ipAddress: "127.0.0.1", macAddress: "00:00:00:00:00:00" };
}

export function parseDfPosixLine(stdout: string): {
  diskTotalGb: number;
  diskPercent: number;
} | null {
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const cols = lines[lines.length - 1].split(/\s+/);
  if (cols.length < 5) return null;
  const totalKb = Number(cols[1]);
  const usedKb = Number(cols[2]);
  if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
  const diskTotalGb = Math.max(10, Math.round(totalKb / (1024 * 1024)));
  const diskPercent = Number(Math.min(100, Math.max(0, (usedKb / totalKb) * 100)).toFixed(1));
  return { diskTotalGb, diskPercent };
}

async function sampleCpuUsage(windowMs = 250): Promise<number> {
  const start = readCpuTicks();
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const end = readCpuTicks();
  return computeCpuPercentFromTicks(start, end);
}

async function collectWindowsExtras(): Promise<{
  diskTotalGb: number;
  diskPercent: number;
  idleMinutes: number;
  topProcesses: string[];
}> {
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$drive = Get-PSDrive -Name C
$used = [double]$drive.Used
$free = [double]$drive.Free
$total = $used + $free
$diskGb = if ($total -gt 0) { [math]::Round($total / 1GB, 0) } else { 256 }
$diskPct = if ($total -gt 0) { [math]::Round(($used / $total) * 100, 1) } else { 50 }

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class IdleTimer {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")]
  static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static double GetIdleMinutes() {
    LASTINPUTINFO lii = new LASTINPUTINFO();
    lii.cbSize = (uint)Marshal.SizeOf(lii);
    if (!GetLastInputInfo(ref lii)) return 0;
    uint idleMs = ((uint)Environment.TickCount - lii.dwTime);
    return Math.Round(idleMs / 60000.0, 1);
  }
}
"@
$idleMin = [IdleTimer]::GetIdleMinutes()
$procs = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 4 -ExpandProperty ProcessName
@{ diskTotalGb = $diskGb; diskPercent = $diskPct; idleMinutes = $idleMin; topProcesses = @($procs) } | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execFileAsync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-Command", psScript],
      { timeout: 4500 }
    );
    const parsed = JSON.parse(stdout.trim()) as {
      diskTotalGb?: number;
      diskPercent?: number;
      idleMinutes?: number;
      topProcesses?: string[];
    };
    return {
      diskTotalGb: Math.max(10, Number(parsed.diskTotalGb || 256)),
      diskPercent: Math.min(100, Math.max(0, Number(parsed.diskPercent || 45))),
      idleMinutes: Math.max(0, Math.round(Number(parsed.idleMinutes || 0))),
      topProcesses: Array.isArray(parsed.topProcesses)
        ? parsed.topProcesses.slice(0, 5).map(String)
        : ["System", "node"],
    };
  } catch {
    return {
      diskTotalGb: 256,
      diskPercent: 48,
      idleMinutes: 0,
      topProcesses: ["explorer", "node"],
    };
  }
}

async function collectPosixExtras(): Promise<{
  diskTotalGb: number;
  diskPercent: number;
  idleMinutes: number;
  topProcesses: string[];
}> {
  let diskTotalGb = 256;
  let diskPercent = 42;
  let topProcesses = ["systemd", "node"];

  try {
    const { stdout } = await execFileAsync("df", ["-Pk", "/"], { timeout: 2500 });
    const parsed = parseDfPosixLine(stdout);
    if (parsed) {
      diskTotalGb = parsed.diskTotalGb;
      diskPercent = parsed.diskPercent;
    }
  } catch {
    // Fallback defaults kept
  }

  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-eo", "comm=", "--sort=-%mem"],
      { timeout: 2500 }
    );
    const procs = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (procs.length > 0) topProcesses = procs;
  } catch {
    // Fallback defaults kept
  }

  return { diskTotalGb, diskPercent, idleMinutes: 0, topProcesses };
}

export async function collectEndpointSnapshot(options?: {
  adOu?: string;
  department?: string;
  domain?: string;
}): Promise<EndpointTelemetryPayload> {
  const cpuPercent = await sampleCpuUsage(200);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const ramTotalGb = Math.max(1, Math.round(totalMem / 1024 ** 3));
  const ramPercent = Number(((usedMem / totalMem) * 100).toFixed(1));
  const { ipAddress, macAddress } = detectPrimaryNetwork();
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model?.trim() || "Generic x64 Processor";
  const uptimeHours = Number((os.uptime() / 3600).toFixed(1));

  let loggedUser = "system";
  try {
    loggedUser = os.userInfo().username || "system";
  } catch {
    loggedUser = process.env.USERNAME || process.env.USER || "system";
  }

  const extras =
    process.platform === "win32"
      ? await collectWindowsExtras()
      : await collectPosixExtras();

  const platformNames: Record<string, string> = {
    win32: "Windows",
    linux: "Linux",
    darwin: "macOS",
  };

  return {
    hostname: os.hostname().toUpperCase(),
    domain: options?.domain || process.env.USERDNSDOMAIN?.toLowerCase() || "corp.infradesk.local",
    adOu:
      options?.adOu ||
      process.env.INFRADESK_AD_OU ||
      "OU=Workstations,DC=corp,DC=infradesk,DC=local",
    department: options?.department || process.env.INFRADESK_DEPARTMENT || "TI & Operações",
    ipAddress,
    macAddress,
    osName: platformNames[process.platform] || os.type(),
    osVersion: os.release(),
    cpuModel,
    ramTotalGb,
    diskTotalGb: extras.diskTotalGb,
    cpuPercent,
    ramPercent,
    diskPercent: extras.diskPercent,
    idleMinutes: extras.idleMinutes,
    uptimeHours,
    loggedUser,
    topProcesses: extras.topProcesses,
    agentVersion: "2.1.0",
  };
}
