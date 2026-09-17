import { Hono } from "hono";
import { answerWithContext } from "../lib/ai.js";
import { searchKnowledge } from "../lib/knowledge.js";
import { consumeQuota, peekQuota, resolvePlan } from "../lib/plans.js";
import { isValidDeviceId, newId } from "../lib/store.js";

export const devRoute = new Hono();

// POST /api/dev/ask { question, code?, deviceId? } - developer Q&A.
// No separate dev section in the app; devs just ask. Answers explain in
// plain words, prioritize official docs, cover common mistakes + sources.
// Never outputs code — the code lives in the official docs.
// Quota is peeked up front but only consumed on a successful answer.
devRoute.post("/ask", async (c) => {
  const requestId = newId("req");
  try {
    const body = (await c.req.json().catch(() => ({}))) as { question?: string; code?: string; deviceId?: string };
    const question = (body.question || "").trim();
    if (!question) return c.json({ error: "question is required" }, 400);
    if (question.length > 2000) return c.json({ error: "question too long (max 2000 chars)" }, 400);
    const rawDevice = (body.deviceId || "").trim();
    if (!isValidDeviceId(rawDevice)) return c.json({ error: "valid deviceId required" }, 400);
    const deviceId = rawDevice.slice(0, 128);
    const { effective } = await resolvePlan(deviceId);
    const peeked = peekQuota(deviceId, effective);
    if (peeked.remaining <= 0) return c.json({ error: `daily limit reached (${peeked.limit}/day) — try again tomorrow`, plan: effective, limit: peeked.limit }, 429);
    const withCode = body.code ? `${question}\n\nMy code:\n${body.code.slice(0, 4000)}` : question;
    const answer = await answerWithContext(`Developer question: ${withCode}`, { plan: effective });
    const quota = consumeQuota(deviceId, effective);
    return c.json({ ...answer, plan: effective, remaining: quota.remaining, limit: quota.limit });
  } catch (err) {
    console.error(`[dev:${requestId}]`, err instanceof Error ? err.message : err);
    return c.json({ error: "internal error", requestId }, 502);
  }
});

// GET /api/knowledge/search?q= - raw grounded docs search for the UI.
// Separate router (mounted at /api/knowledge) so the /api/dev/* rate limit
// cannot be bypassed by a prefix swap - and vice versa.
export const knowledgeRoute = new Hono();

knowledgeRoute.get("/search", (c) => {
  const q = (c.req.query("q") || "").trim().slice(0, 200);
  if (!q) return c.json({ error: "q is required" }, 400);
  return c.json({ results: searchKnowledge(q) });
});
