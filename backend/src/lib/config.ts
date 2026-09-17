// Central config. Everything comes from env so testnet/MVP pricing
// can change without touching code.
import "dotenv/config";

// All Groq keys: GROQ_API_KEYS (comma-separated, preferred) falls back
// to the single GROQ_API_KEY. Backend round-robins + fails over.
const groqKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  const src = raw ?? String(fallback);
  const n = Number(src);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${name}=${JSON.stringify(src)}: must be a finite integer > 0`);
  }
  return n;
}

function parsePort(raw: string | undefined): number {
  const n = Number(raw || 8787);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT=${JSON.stringify(raw)}`);
  }
  return n;
}

const proPriceNim = parsePositiveInt("PRO_PRICE_NIM", process.env.PRO_PRICE_NIM, 100);
const superPriceNim = parsePositiveInt("SUPER_PRICE_NIM", process.env.SUPER_PRICE_NIM, 500);
const trialDays = parsePositiveInt("TRIAL_DAYS", process.env.TRIAL_DAYS, 3);

const devBypassVerify = process.env.DEV_BYPASS_VERIFY === "true";
// Unset NODE_ENV counts as development (local dev). Anything else must be
// explicitly development/test to allow dangerous settings - default-deny so
// a staging/preview deploy without NODE_ENV=production can't silently run
// open CORS or free paid plans.
const nodeEnv = process.env.NODE_ENV || "development";
const isDevEnv = nodeEnv === "development" || nodeEnv === "test";
if (devBypassVerify && !isDevEnv) {
  throw new Error("DEV_BYPASS_VERIFY=true is forbidden outside development/test — refuse to boot");
}

const rawOrigins = (process.env.ALLOW_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
if (rawOrigins.includes("*") && !isDevEnv) {
  throw new Error('ALLOW_ORIGINS="*" is forbidden outside development/test — set explicit origins');
}
const allowOrigins = rawOrigins.length ? rawOrigins : ["*"];

export const config = {
  port: parsePort(process.env.PORT),
  groqKeys,
  groqKey: groqKeys[0] || "",
  groqModel: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  merchant: (process.env.MERCHANT_NIM_ADDRESS || "").replace(/\s+/g, " ").trim(),
  rpcUrl: process.env.NIMIQ_RPC_URL || "https://rpc.nimiqwatch.com",
  proPriceNim,
  superPriceNim,
  trialDays,
  devBypassVerify,
  allowOrigins,
};

// 1 NIM = 100,000 Luna (smallest unit used by sendBasicTransaction)
export const NIM_TO_LUNA = 100_000;
export const nimToLuna = (nim: number) => Math.round(nim * NIM_TO_LUNA);

if (/^http:\/\//i.test(config.rpcUrl) && !/localhost|127\.0\.0\.1/i.test(config.rpcUrl)) {
  console.warn("WARNING: NIMIQ_RPC_URL is plain http - chain answers can be tampered with in transit. Use https in production.");
}
