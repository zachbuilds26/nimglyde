import { Hono } from "hono";
import { config } from "../lib/config.js";
import { getTransactionByHash, summarizeTransaction } from "../lib/nimiq-rpc.js";
import { PLANS, grantPlan, peekQuota, priceLuna, resolvePlan } from "../lib/plans.js";
import { getSession, isValidDeviceId, isValidRecordId, isValidTxHash, markSessionUsed, newId, saveSession, SESSION_TTL_MS } from "../lib/store.js";

// Exact placeholder shipped in .env.example (after config normalization).
// Any real merchant address - including one that happens to contain "0000" -
// must pass; only the literal unconfigured placeholder is rejected.
const MERCHANT_PLACEHOLDER = "NQ07 0000 0000 0000 0000 0000 0000 0000 0000";

export const plansRoute = new Hono();

// GET /api/plans - what Free / Pro / Super include.
plansRoute.get("/", (c) => c.json({ plans: PLANS, trialDays: config.trialDays }));

// GET /api/plans/status?deviceId=... - effective plan incl. trial.
// Read-only: never creates a record or starts the trial clock.
plansRoute.get("/status", async (c) => {
  const raw = c.req.query("deviceId") || "";
  if (!isValidDeviceId(raw)) return c.json({ error: "valid deviceId required (web_ + 24 hex or 64 hex)" }, 400);
  const deviceId = raw.slice(0, 128);
  const { record, effective, trialActive } = await resolvePlan(deviceId, { displayOnly: true });
  const quota = peekQuota(deviceId, effective);
  return c.json({
    deviceId,
    effective,
    trialActive,
    expiresAt: record?.planExpiresAt ?? null,
    remaining: quota.remaining,
    limit: quota.limit,
    merchantConfigured: !!config.merchant,
    plans: PLANS,
  });
});

// POST /api/plans/checkout { plan: pro|super, deviceId } - prepares the
// NIM payment. Frontend calls sendBasicTransactionWithData with this memo,
// Nimiq Pay shows the native confirmation.
plansRoute.post("/checkout", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { plan?: string; deviceId?: string };
  if (body.plan !== "pro" && body.plan !== "super") return c.json({ error: "plan must be pro or super" }, 400);
  const rawDevice = body.deviceId || "";
  if (!isValidDeviceId(rawDevice)) return c.json({ error: "valid deviceId required (web_ +24 hex or 64 hex)" }, 400);
  const deviceId = rawDevice.slice(0, 128);
  if (!config.merchant || config.merchant === MERCHANT_PLACEHOLDER) {
    return c.json({ error: "MERCHANT_NIM_ADDRESS is not configured on the backend" }, 500);
  }
  const amountLuna = priceLuna(body.plan);
  const sessionId = newId("nimglyde");
  const memo = sessionId; // user pays with this memo so backend can match it
  await saveSession({
    sessionId,
    plan: body.plan,
    amountLuna,
    merchant: config.merchant,
    memo,
    deviceId,
    createdAt: Date.now(),
    usedTxHash: null,
  });
  return c.json({
    sessionId,
    plan: body.plan,
    recipient: config.merchant,
    amountLuna,
    amountNim: amountLuna / 100_000,
    data: memo,
    expiresAt: Date.now() + SESSION_TTL_MS,
    message: `Approve ${amountLuna / 100_000} NIM to ${config.merchant} in Nimiq Pay, then call /api/plans/verify with the transaction hash. Session expires in 60 minutes.`,
  });
});

// POST /api/plans/verify { sessionId, txHash } - server checks the payment
// on-chain (amount, recipient, memo, replay) before granting the plan.
// The client's word is never trusted.
plansRoute.post("/verify", async (c) => {
  const requestId = newId("req");
  const body = (await c.req.json().catch(() => ({}))) as { sessionId?: string; txHash?: string };
  if (!body.sessionId || !isValidRecordId("nimglyde", body.sessionId)) {
    return c.json({ error: "valid sessionId is required" }, 400);
  }
  if (!body.txHash || !isValidTxHash(body.txHash)) {
    return c.json({ error: "txHash must be 64 hex chars (0x prefix allowed)" }, 400);
  }
  const txHash = body.txHash.replace(/^0x/i, "").toLowerCase();
  const session = await getSession(body.sessionId);
  if (!session) return c.json({ error: "unknown session" }, 404);
  if (session.usedTxHash) return c.json({ error: "session already used (replay protection)" }, 409);
  // 60-min expiry
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    return c.json({ error: "checkout session expired — create a new one" }, 410);
  }

  if (config.devBypassVerify) {
    const ok = await markSessionUsed(session.sessionId, txHash);
    if (!ok) return c.json({ error: "session already used (replay protection)" }, 409);
    const record = await grantPlan(session.deviceId, session.plan);
    return c.json({ ok: true, devBypass: true, plan: record.plan, expiresAt: record.planExpiresAt });
  }

  let tx;
  try {
    const { raw: _raw, ...summary } = summarizeTransaction(await getTransactionByHash(txHash));
    tx = summary;
  } catch (err) {
    console.error(`[plans:${requestId}] chain lookup`, err instanceof Error ? err.message : err);
    return c.json({ error: "chain lookup failed", requestId }, 502);
  }
  if (!tx.found) return c.json({ error: "transaction not found on chain" }, 404);

  // NQ addresses may vary in case - compare canonical uppercase.
  const sameRecipient =
    !!tx.to && !!session.merchant &&
    tx.to.replace(/\s+/g, "").toUpperCase() === session.merchant.replace(/\s+/g, "").toUpperCase();
  // Re-validate price at verify time — snapshot alone is not trusted.
  // Require tx value >= current price (protects against test-price sessions replayed later).
  const currentPriceLuna = priceLuna(session.plan);
  const enoughValue = tx.valueLuna !== null && tx.valueLuna >= currentPriceLuna && tx.valueLuna >= session.amountLuna;
  const sameMemo = !!tx.memo && (tx.memo === session.memo || tx.memo.toLowerCase() === session.sessionId.toLowerCase());

  // Never echo the raw chain blob: minimal mismatch codes only.
  if (!sameRecipient) return c.json({ error: "transaction recipient does not match checkout", requiredLuna: session.amountLuna }, 402);
  if (!enoughValue) return c.json({ error: `transaction amount is below current plan price (${currentPriceLuna / 100_000} NIM required)`, requiredLuna: currentPriceLuna }, 402);
  if (!sameMemo) return c.json({ error: "transaction memo does not match session (cannot prove this payment was for Nimglyde)" }, 402);

  // Atomic replay protection: if another verify won the race, this returns false.
  const claimed = await markSessionUsed(session.sessionId, txHash);
  if (!claimed) return c.json({ error: "session already used (replay protection)" }, 409);
  // Overpay grants the better plan: if they paid enough for Super, grant Super even if they checked out Pro.
  let planToGrant: Exclude<typeof session.plan, "free"> = session.plan;
  if (tx.valueLuna !== null && tx.valueLuna >= priceLuna("super") && session.plan === "pro") {
    planToGrant = "super";
  }
  const record = await grantPlan(session.deviceId, planToGrant);
  return c.json({
    ok: true,
    checkedOut: session.plan,
    plan: record.plan,
    paidLuna: tx.valueLuna,
    expiresAt: record.planExpiresAt,
    message: `You're now ${record.plan}.`,
  });
});
