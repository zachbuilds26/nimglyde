import { Hono } from "hono";
import { ECOSYSTEM_APPS, detectIntent, findAppsForIntent } from "../lib/registry.js";

export const appsRoute = new Hono();

// GET /api/apps?intent=learn - intent-based discovery, no categories to browse.
appsRoute.get("/", (c) => {
  const q = (c.req.query("intent") || c.req.query("q") || "").trim().slice(0, 200);
  if (!q) return c.json({ apps: ECOSYSTEM_APPS.slice(0, 6), total: ECOSYSTEM_APPS.length });
  const intent = detectIntent(q);
  return c.json({ intent, apps: findAppsForIntent(intent, 5) });
});
