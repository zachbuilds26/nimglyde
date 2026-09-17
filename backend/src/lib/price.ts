// Live NIM price from CoinGecko (nimiq-2) with 60s cache.
// Falls back to CoinPaprika if CoinGecko fails.
export interface NimPrice {
  usd: number;
  change24h: number; // percent, e.g. 4.25 or -2.5
  lastUpdated: string; // ISO
  source: string;
}

let cached: { at: number; data: NimPrice } | null = null;
const TTL_MS = 60_000;

async function fetchGecko(): Promise<NimPrice | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    const row = j["nimiq-2"];
    if (!row || typeof row.usd !== "number") return null;
    return {
      usd: row.usd,
      change24h: typeof row.usd_24h_change === "number" ? row.usd_24h_change : 0,
      lastUpdated: new Date().toISOString(),
      source: "CoinGecko",
    };
  } catch {
    return null;
  }
}

async function fetchPaprika(): Promise<NimPrice | null> {
  try {
    const res = await fetch("https://api.coinpaprika.com/v1/tickers/nim-nimiq", {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { quotes?: { USD?: { price?: number; percent_change_24h?: number } } };
    const q = j.quotes?.USD;
    if (!q || typeof q.price !== "number") return null;
    return {
      usd: q.price,
      change24h: typeof q.percent_change_24h === "number" ? q.percent_change_24h : 0,
      lastUpdated: new Date().toISOString(),
      source: "CoinPaprika",
    };
  } catch {
    return null;
  }
}

export async function getNimPrice(): Promise<NimPrice | null> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.data;
  let data = await fetchGecko();
  if (!data) data = await fetchPaprika();
  if (data) cached = { at: now, data };
  return data;
}

// For testing: allow clearing cache
export function _clearPriceCache() {
  cached = null;
}
