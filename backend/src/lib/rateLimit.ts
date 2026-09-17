// Simple in-memory token bucket rate limiter for Hono.
// Per-instance only; swap to Redis for multi-instance.
import type { Context, Next } from "hono";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Hard cap so spoofed-IP rotation cannot grow the map without bound.
// Oldest entries (insertion order) are evicted first.
const MAX_BUCKETS = 10_000;

function keyFor(c: Context, prefix: string): string {
  // Per-IP only — deviceId is self-asserted and rotates freely, so including it would let an attacker bypass limits by rotating.
  // NOTE: x-forwarded-for is client-controlled unless a trusted proxy sets
  // it. This limiter is a cheap shared-host control, not a security
  // boundary; the daily quota + provider budget are the real backstops.
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || c.req.header("cf-connecting-ip") || "unknown";
  return `${prefix}:${ip.slice(0, 64)}`;
}

export function rateLimit(opts: { windowMs: number; max: number; prefix: string }) {
  return async (c: Context, next: Next) => {
    const key = keyFor(c, opts.prefix);
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now > entry.resetAt) {
      if (!entry && buckets.size >= MAX_BUCKETS) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    if (entry.count >= opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "rate limited — try again shortly", retryAfter }, 429);
    }
    entry.count++;
    return next();
  };
}

// Global cleanup every 5min to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
}, 5 * 60 * 1000).unref?.();

// Also expose for tests
export function _resetBuckets() { buckets.clear(); }
