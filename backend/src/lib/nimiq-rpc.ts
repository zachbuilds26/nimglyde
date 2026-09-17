// Nimiq JSON-RPC helpers. The Mini App provider itself has NO balance or
// history methods, so the backend asks a public RPC node instead.
// Frontend sends the address (after listAccounts consent), backend reads
// the chain. Never invent numbers - if RPC fails, routes say so.
import { config } from "./config.js";

async function rpcCall(method: string, params: unknown[] = [], signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: signal ?? AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

// One overall budget for the whole method fan-out: per-attempt 8s timeouts
// alone could stack to 24s of worker starvation per request.
function attemptSignal(overall: AbortSignal): AbortSignal {
  const perCall = AbortSignal.timeout(8_000);
  return typeof AbortSignal.any === "function" ? AbortSignal.any([overall, perCall]) : overall;
}

// Try the known account-read methods in order. Different RPC versions
// name them differently, so we attempt each before giving up.
export async function getAccount(address: string): Promise<unknown> {
  const clean = address.replace(/\s+/g, "");
  const overall = AbortSignal.timeout(10_000);
  const attempts: Array<[string, unknown[]]> = [
    ["getAccountByAddress", [clean]],
    ["getAccount", [clean]],
    ["accounts_getAccount", [clean]],
  ];
  let lastError: unknown = null;
  for (const [method, params] of attempts) {
    try {
      return await rpcCall(method, params, attemptSignal(overall));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Account lookup failed");
}

export async function getTransactionByHash(hash: string): Promise<unknown> {
  const overall = AbortSignal.timeout(10_000);
  const attempts: Array<[string, unknown[]]> = [
    ["getTransactionByHash", [hash]],
    ["transactions_getTransactionByHash", [hash]],
    ["blockchain_getTransactionByHash", [hash]],
  ];
  let lastError: unknown = null;
  for (const [method, params] of attempts) {
    try {
      return await rpcCall(method, params, attemptSignal(overall));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Transaction lookup failed");
}

// Nimiq RPC wraps results as { data, metadata }. Unwrap first so field
// lookups work on the real payload. Returns the raw value when unwrapped
// data is missing (e.g. unknown account) instead of guessing.
function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}
// Luna amounts must survive without float damage. Numbers pass through;
// digit strings go through BigInt so values above 2^53 are rejected rather
// than silently rounded (21B NIM = 2.1e15 Luna still fits safely).
function toLunaInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    try {
      const bi = BigInt(v);
      return bi <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(bi) : null;
    } catch {
      return null;
    }
  }
  return null;
}
export function summarizeAccount(raw: unknown): {
  balanceLuna: number | null;
  balanceNim: number | null;
  raw: unknown;
} {
  const target = unwrap(raw);
  if (!target || typeof target !== "object") return { balanceLuna: null, balanceNim: null, raw };
  const obj = target as Record<string, unknown>;
  const candidates = [obj.balance, obj.value, (obj.account as Record<string, unknown> | undefined)?.balance];
  let luna: number | null = null;
  for (const c of candidates) {
    const n = toLunaInt(c);
    if (n !== null) {
      luna = n;
      break;
    }
  }
  return { balanceLuna: luna, balanceNim: luna === null ? null : luna / 100_000, raw };
}

export function summarizeTransaction(raw: unknown): {
  found: boolean;
  from: string | null;
  to: string | null;
  valueLuna: number | null;
  feeLuna: number | null;
  memo: string | null;
  blockHeight: number | null;
  raw: unknown;
} {
  const target = unwrap(raw);
  if (!target || typeof target !== "object") return { found: false, from: null, to: null, valueLuna: null, feeLuna: null, memo: null, blockHeight: null, raw };
  const o = target as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (o[k] !== undefined) return o[k];
    return undefined;
  };
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const from = str(pick("sender", "from", "senderAddress")) ?? null;
  const to = str(pick("recipient", "to", "recipientAddress")) ?? null;
  const valueLuna = toLunaInt(pick("value", "amount"));
  const feeLuna = toLunaInt(pick("fee"));
  const memo = str(pick("data", "memo", "message")) ?? null;
  const blockHeight = toLunaInt(pick("blockHeight", "blockNumber", "height"));
  // A fieldless {} is NOT a found transaction - require at least one real
  // field, otherwise callers report "verified" for a not-found.
  const found =
    from !== null || to !== null || valueLuna !== null || feeLuna !== null || memo !== null || blockHeight !== null;
  return { found, from, to, valueLuna, feeLuna, memo, blockHeight, raw };
}
