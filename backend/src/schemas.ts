import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4),
});

export const AssetCreateSchema = z.object({
  assetTag: z.string().min(2).max(40),
  hostname: z.string().min(2).max(80),
  domain: z.string().min(2).max(120).default("corp.infradesk.local"),
  adOu: z.string().min(3).max(180),
  ipAddress: z.string().min(7).max(45),
  macAddress: z.string().min(11).max(24).default("00:1A:2B:3C:4D:5E"),
  osName: z.string().min(2).max(80),
  osVersion: z.string().min(1).max(60),
  cpuModel: z.string().min(2).max(120),
  ramTotalGb: z.number().min(1).max(2048),
  diskTotalGb: z.number().min(10).max(65536),
  loggedUser: z.string().max(80).default("N/A"),
  department: z.string().min(2).max(80),
  status: z.enum(["online", "idle", "warning", "offline", "maintenance"]).optional(),
});

export const AssetUpdateSchema = AssetCreateSchema.partial();

export const TelemetryIngestSchema = z.object({
  hostname: z.string().min(2).max(80),
  assetTag: z.string().min(2).max(40).optional(),
  domain: z.string().max(120).optional(),
  adOu: z.string().max(180).optional(),
  department: z.string().max(80).optional(),
  ipAddress: z.string().max(45).optional(),
  macAddress: z.string().max(24).optional(),
  osName: z.string().max(80).optional(),
  osVersion: z.string().max(60).optional(),
  cpuModel: z.string().max(120).optional(),
  ramTotalGb: z.number().min(1).max(2048).optional(),
  diskTotalGb: z.number().min(10).max(65536).optional(),
  cpuPercent: z.number().min(0).max(100),
  ramPercent: z.number().min(0).max(100),
  diskPercent: z.number().min(0).max(100),
  idleMinutes: z.number().min(0).max(10080).default(0),
  uptimeHours: z.number().min(0).max(100000).default(1),
  loggedUser: z.string().max(80).default("system"),
  topProcesses: z.array(z.string().max(80)).max(10).default([]),
  agentVersion: z.string().max(32).default("2.0.0"),
});

export const AdSyncBatchSchema = z.object({
  domain: z.string().min(2).max(120).default("corp.infradesk.local"),
  computers: z
    .array(
      z.object({
        hostname: z.string().min(2).max(80),
        assetTag: z.string().min(2).max(40).optional(),
        adOu: z.string().min(3).max(180),
        department: z.string().min(2).max(80),
        ipAddress: z.string().min(7).max(45),
        macAddress: z.string().max(24).optional(),
        osName: z.string().min(2).max(80),
        osVersion: z.string().min(1).max(60),
        cpuModel: z.string().min(2).max(120),
        ramTotalGb: z.number().min(1).max(2048),
        diskTotalGb: z.number().min(10).max(65536),
        loggedUser: z.string().max(80).default("N/A"),
      })
    )
    .min(1)
    .max(500),
});

export const TicketCreateSchema = z.object({
  title: z.string().min(4).max(160),
  description: z.string().min(8).max(3000),
  category: z.enum([
    "hardware",
    "software",
    "network",
    "access_ad",
    "security",
    "telemetry_alert",
  ]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  assetId: z.string().nullable().optional(),
  requesterName: z.string().min(2).max(80),
  requesterDepartment: z.string().min(2).max(80),
  assigneeId: z.string().nullable().optional(),
});

export const TicketUpdateSchema = z.object({
  title: z.string().min(4).max(160).optional(),
  description: z.string().min(8).max(3000).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  status: z.enum(["open", "in_progress", "waiting_user", "resolved", "closed"]).optional(),
  assigneeId: z.string().nullable().optional(),
});

export const TicketCommentCreateSchema = z.object({
  body: z.string().min(2).max(2000),
  internal: z.boolean().default(false),
});
