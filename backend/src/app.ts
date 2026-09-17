import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./lib/config.js";
import { appsRoute } from "./routes/apps.js";
import { chatRoute } from "./routes/chat.js";
import { chatsRoute } from "./routes/chats.js";
import { devRoute, knowledgeRoute } from "./routes/dev.js";
import { plansRoute } from "./routes/plans.js";
import { priceRoute } from "./routes/price.js";
import { walletRoute } from "./routes/wallet.js";
import { rateLimit } from "./lib/rateLimit.js";
import { newId } from "./lib/store.js";

const isProd = (process.env.NODE_ENV || "development") === "production";

// Reject oversized JSON bodies before any route parses them (no single
// request should carry megabytes into the AI prompt or the store scan).
const MAX_BODY_BYTES = 64 * 1024;

export function createApp(): Hono {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: config.allowOrigins.includes("*") ? "*" : config.allowOrigins,
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      credentials: false,
    })
  );

  // Never serve with a sniffable MIME type.
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.use("*", async (c, next) => {
    const len = Number(c.req.header("content-length") || 0);
    if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
      return c.json({ error: "body too large (max 64KB)" }, 413);
    }
    await next();
  });

  // Global abuse guard: generous for GET, tighter for expensive POSTs.
  // Register both the exact path and the wildcard: Hono matches "use" paths
  // exactly, so "/api/chat" alone would miss "/api/chat/".
  app.use("/api/chat", rateLimit({ windowMs: 60_000, max: 20, prefix: "chat" }));
  app.use("/api/chat/*", rateLimit({ windowMs: 60_000, max: 20, prefix: "chat" }));
  app.use("/api/dev/*", rateLimit({ windowMs: 60_000, max: 20, prefix: "dev" }));
  app.use("/api/plans", rateLimit({ windowMs: 60_000, max: 30, prefix: "plans" }));
  app.use("/api/plans/*", rateLimit({ windowMs: 60_000, max: 30, prefix: "plans" }));
  app.use("/api/wallet/*", rateLimit({ windowMs: 60_000, max: 30, prefix: "wallet" }));
  app.use("/api/chats", rateLimit({ windowMs: 60_000, max: 60, prefix: "chats" }));
  app.use("/api/chats/*", rateLimit({ windowMs: 60_000, max: 60, prefix: "chats" }));
  app.use("/api/apps", rateLimit({ windowMs: 60_000, max: 60, prefix: "apps" }));
  app.use("/api/apps/*", rateLimit({ windowMs: 60_000, max: 60, prefix: "apps" }));
  app.use("/api/knowledge", rateLimit({ windowMs: 60_000, max: 60, prefix: "knowledge" }));
  app.use("/api/knowledge/*", rateLimit({ windowMs: 60_000, max: 60, prefix: "knowledge" }));
  app.use("/api/price", rateLimit({ windowMs: 60_000, max: 60, prefix: "price" }));
  app.use("/api/price/*", rateLimit({ windowMs: 60_000, max: 60, prefix: "price" }));

  app.get("/", (c) =>
    c.json(
      isProd
        ? { name: "Nimglyde backend", ok: true }
        : {
            name: "Nimglyde backend",
            tagline: "The AI interface to the Nimiq ecosystem. Ask. Understand. Discover. Act.",
            endpoints: [
              "POST /api/chat",
              "GET /api/chats?deviceId=",
              "GET /api/chats/:id?deviceId=",
              "DELETE /api/chats/:id?deviceId=",
              "GET /api/apps?intent=",
              "GET /api/wallet/balance?address=",
              "GET /api/wallet/transaction?hash=",
              "GET /api/plans",
              "GET /api/plans/status?deviceId=",
              "POST /api/plans/checkout",
              "POST /api/plans/verify",
              "POST /api/dev/ask",
              "GET /api/knowledge/search?q=",
              "GET /api/price",
            ],
          }
    )
  );
  app.get("/health", (c) => c.json({ ok: true }));

  app.route("/api/chat", chatRoute);
  app.route("/api/chats", chatsRoute);
  app.route("/api/apps", appsRoute);
  app.route("/api/wallet", walletRoute);
  app.route("/api/plans", plansRoute);
  app.route("/api/dev", devRoute);
  app.route("/api/knowledge", knowledgeRoute);
  app.route("/api/price", priceRoute);

  app.notFound((c) => c.json({ error: "not found" }, 404));

  // Uniform 500 envelope: log the detail with a request id, never leak
  // stacks or chain errors to the client.
  app.onError((err, c) => {
    const requestId = newId("req");
    console.error(`[unhandled:${requestId}]`, err);
    return c.json({ error: "internal error", requestId }, 500);
  });
  return app;
}
