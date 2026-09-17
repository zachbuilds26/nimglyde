// Plans: FREE (0 NIM), PRO (100 NIM / 30 days), SUPER (500 NIM / 30 days).
// Upgrades are currently disabled — every user gets Super-tier limits for free.
// NIM will pay for premium capabilities when monetization is re-enabled.
import { config, nimToLuna } from "./config.js";
import { getDevice, updateDevice, type DeviceRecord, type Plan } from "./store.js";

export const PLANS = {
  free: {
    name: "Free",
    priceNim: 0,
    blurb: "Everything free right now: full ecosystem intelligence, deep developer Q&A, max context and highest limits.",
    limits: { dailyMessages: 300, historyTurns: 14, knowledgeEntries: 6, maxTokens: 5000 },
  },
  pro: {
    name: "Pro",
    priceNim: config.proPriceNim,
    blurb: "Advanced ecosystem intelligence, deeper app discovery, deeper developer Q&A, transaction intelligence, higher limits.",
    limits: { dailyMessages: 300, historyTurns: 14, knowledgeEntries: 6, maxTokens: 5000 },
  },
  super: {
    name: "Super",
    priceNim: config.superPriceNim,
    blurb: "Highest usage, advanced ecosystem research, larger context, deeper transaction analysis.",
    limits: { dailyMessages: 300, historyTurns: 14, knowledgeEntries: 6, maxTokens: 5000 },
  },
} as const;

export function priceLuna(plan: Exclude<Plan, "free">): number {
  return nimToLuna(plan === "pro" ? config.proPriceNim : config.superPriceNim);
}

export function planLimits(plan: Plan) {
  return PLANS[plan].limits;
}

// Simple in-memory daily quota (resets at UTC midnight). Per-instance and
// lost on restart by design for this MVP stage - the IP rate limiter in
// lib/rateLimit.ts is the real abuse control; this is per-device fairness.
// For multi-instance deploy move both to atomic Redis INCR with expiry.
const quotaMap = new Map<string, { date: string; count: number }>();
function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
}
// Opportunistic TTL: drop stale (non-today) buckets on every check so the
// map cannot grow without bound from rotating deviceIds.
function sweepQuota(): void {
  const today = todayKey();
  for (const [k, v] of quotaMap) {
    if (v.date !== today) quotaMap.delete(k);
    if (quotaMap.size > 20_000) break; // bounded work per request
  }
  if (quotaMap.size > 20_000) {
    const first = quotaMap.keys().next();
    if (!first.done) quotaMap.delete(first.value);
  }
}
export function peekQuota(deviceId: string, effective: Plan): { remaining: number; limit: number } {
  sweepQuota();
  const limits = planLimits(effective);
  const entry = quotaMap.get(deviceId);
  const today = todayKey();
  const count = entry && entry.date === today ? entry.count : 0;
  return { remaining: Math.max(0, limits.dailyMessages - count), limit: limits.dailyMessages };
}
export function consumeQuota(deviceId: string, effective: Plan): { remaining: number; limit: number } {
  sweepQuota();
  const limits = planLimits(effective);
  const today = todayKey();
  const entry = quotaMap.get(deviceId);
  const count = entry && entry.date === today ? entry.count : 0;
  quotaMap.set(deviceId, { date: today, count: count + 1 });
  return { remaining: Math.max(0, limits.dailyMessages - (count + 1)), limit: limits.dailyMessages };
}
export function checkAndConsumeQuota(deviceId: string, effective: Plan): { allowed: boolean; remaining: number; limit: number } {
  const peeked = peekQuota(deviceId, effective);
  if (peeked.remaining <= 0) {
    return { allowed: false, remaining: 0, limit: peeked.limit };
  }
  const after = consumeQuota(deviceId, effective);
  return { allowed: true, remaining: after.remaining, limit: after.limit };
}

function now(): number {
  return Date.now();
}

// Resolve the effective plan: paid plan if unexpired, else trial Pro if
// active, else free. Starts trial on first sight (3-day Pro trial).
// displayOnly (used by GET /status) never creates a record or starts the
// trial clock - a safe GET must not burn the trial.
export async function resolvePlan(
  deviceId: string,
  opts: { displayOnly?: boolean } = {}
): Promise<{
  record: DeviceRecord | null;
  effective: Plan;
  trialActive: boolean;
}> {
  const t = now();
  let record = await getDevice(deviceId);
  if (!record) {
    if (opts.displayOnly) {
      return { record: null, effective: "free", trialActive: false };
    }
    const fresh: DeviceRecord = {
      deviceId,
      plan: "free",
      planExpiresAt: null,
      trialStartedAt: t,
      trialEndsAt: t + config.trialDays * 24 * 3600 * 1000,
      createdAt: t,
      updatedAt: t,
    };
    record = await updateDevice(deviceId, () => fresh);
  }
  // Expire paid plans
  if (record.plan !== "free" && record.planExpiresAt && record.planExpiresAt < t) {
    const expired = { ...record, plan: "free" as Plan, planExpiresAt: null, updatedAt: t };
    record = opts.displayOnly ? expired : await updateDevice(deviceId, () => expired);
  }
  const paidActive = record.plan !== "free" && record.planExpiresAt && record.planExpiresAt > t;
  const trialActive =
    !paidActive && !!record.trialEndsAt && record.trialEndsAt > t && !!record.trialStartedAt;
  const effective: Plan = paidActive ? record.plan : trialActive ? "pro" : "free";
  return { record, effective, trialActive };
}

export async function grantPlan(deviceId: string, plan: Exclude<Plan, "free">): Promise<DeviceRecord> {
  const t = now();
  // Read-modify-write inside the lock: two concurrent verifies extend from
  // the same base instead of one paid month silently overwriting the other.
  return updateDevice(deviceId, (existing) => {
    const base: DeviceRecord =
      existing ||
      ({
        deviceId,
        plan: "free",
        planExpiresAt: null,
        trialStartedAt: t,
        trialEndsAt: t + config.trialDays * 24 * 3600 * 1000,
        createdAt: t,
        updatedAt: t,
      } satisfies DeviceRecord);
    const from = base.planExpiresAt && base.planExpiresAt > t ? base.planExpiresAt : t;
    return {
      ...base,
      plan,
      planExpiresAt: from + 30 * 24 * 3600 * 1000,
      updatedAt: t,
    };
  });
}
