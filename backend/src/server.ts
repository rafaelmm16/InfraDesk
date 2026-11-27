import { resolve } from "node:path";
import { buildApp } from "./app.ts";

const PORT = Number(process.env.PORT || 3333);
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), "data", "infradesk.db");

async function main(): Promise<void> {
  const { app } = await buildApp({
    dbPath: DB_PATH,
    logger: true,
    seed: true,
  });

  const shutdown = async (signal: string) => {
    app.log.info(`Recebido ${signal}, encerrando InfraDesk API com segurança...`);
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: PORT, host: HOST });
  console.log(`\n🚀 InfraDesk API online em http://localhost:${PORT}`);
  console.log(`📊 Métricas OpenMetrics: http://localhost:${PORT}/metrics`);
  console.log(`🔌 WebSocket Stream:     ws://localhost:${PORT}/api/ws\n`);
}

main().catch((err) => {
  console.error("Falha fatal ao iniciar InfraDesk API:", err);
  process.exit(1);
});
