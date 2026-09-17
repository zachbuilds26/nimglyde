import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./lib/config.js";

const app = createApp();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Nimglyde backend on http://localhost:${info.port}`);
  console.log(`Groq keys loaded: ${config.groqKeys.length} (round-robin + failover)`);
  if (!config.groqKeys.length && !process.env.OPENAI_API_KEY) {
    console.log("No AI key set - running in grounded fallback mode (registry + knowledge base).");
  }
  if (!config.merchant) {
    console.log("MERCHANT_NIM_ADDRESS not set - /api/plans/checkout will return 500 until you set it.");
  }
});

process.on("SIGTERM", () => {
  console.log("SIGTERM - closing backend");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
});
