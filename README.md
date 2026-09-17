# Nimglyde — AI for the Nimiq Ecosystem

The AI interface to Nimiq. Ask what you want to do — Nimglyde understands Nimiq, finds what you need, and helps you get there. Wallet-gated chat, 129 verified Mini Apps, live NIM price, and grounded answers from official docs.

**Live Demo (Render):** **App:** https://nimglyde.onrender.com · **API:** https://nimglyde-api.onrender.com · **Health:** https://nimglyde-api.onrender.com/health · **Price:** https://nimglyde-api.onrender.com/api/price

**Stack:** Hono + Groq (OpenAI fallback) · React 18 + Vite · Nimiq Hub API + Mini App SDK · CoinGecko

> **Status:** All features are **free** right now — every connected wallet gets Super-tier limits (300/day, 14-turn history, best model). Paid Pro/Super via NIM is wired but disabled.

---

## Features

- **Wallet-gated chat** — Nimiq Hub popup (hub.nimiq.com) or injected Nimiq Pay provider, NQ validation, disconnect + local persist
- **129 Mini Apps** — every Cycle 1 (62) + Cycle 2 (67) submission, curated metadata, project-page links, intent routing (`learn`/`play`/`send`/…), hallucination guards (link allowlist, app-link repair, NQ stripping)
- **Live NIM price** — `GET /api/price` from CoinGecko (Paprika fallback, 60s cache), injected into chat when you ask “what is $NIM price?” — shows `$0.000374 -2.38%` with green `trending_up` / red `trending_down` (no emoji, no `24h` label)
- **Grounded AI** — Groq `openai/gpt-oss-120b` (and `20b`) with round-robin + failover, 70s deadline, truncation-continuation, system prompt with grounding protocol, and a fully working **local fallback** (registry + knowledge base) when no keys are set
- **Developer help** — plain-words answers, official docs links, no code output

---

## Project Structure

```
nimglyde/
├─ backend/          # Hono API — owns all secrets
│  ├─ src/
│  │  ├─ app.ts
│  │  ├─ lib/  ai.ts, registry.ts, knowledge.ts, price.ts, plans.ts, store.ts, rateLimit.ts, nimiq-rpc.ts, config.ts
│  │  ├─ routes/ chat.ts, chats.ts, apps.ts, wallet.ts, plans.ts, dev.ts, price.ts
│  │  └─ server.ts
│  ├─ data/store.json       # file store (swap to Redis for prod)
│  └─ .env.example
└─ apps/web/         # Vite + React Mini App frontend
   ├─ src/App.tsx, app.css, main.tsx
   └─ public/nimglyde-mark.png
```

---

## Quick Start

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# fill .env:
# GROQ_API_KEY=gsk_...        # free at console.groq.com — without it you get grounded fallback
# GROQ_MODEL=openai/gpt-oss-120b
# MERCHANT_NIM_ADDRESS=NQ...  # only needed if you re-enable paid upgrades
# ALLOW_ORIGINS=http://localhost:5173
# NIMIQ_RPC_URL=https://rpc.nimiqwatch.com
npm run dev          # http://localhost:8787
npm run verify-groq  # optional — checks keys + model
```

`backend/.env` is gitignored. Keys live **only** on the backend — the web bundle is public and must never hold secrets.

### 2. Frontend

```bash
cd apps/web
npm install
cp .env.example .env
# VITE_BACKEND_URL=http://localhost:8787
npm run dev          # http://localhost:5173  ( --host for Nimiq Pay LAN testing )
npm run build        # production build -> dist/
```

Connect your Nimiq wallet on `http://localhost:5173` to start chatting.

---

## Environment

**Backend `backend/.env`**

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORT` | no | `8787` | |
| `GROQ_API_KEY` / `GROQ_API_KEYS` | no | — | comma-separated for round-robin. Without any key you get local grounded answers. |
| `GROQ_MODEL` | no | `openai/gpt-oss-120b` | must be in allowlist |
| `OPENAI_API_KEY` | no | — | fallback |
| `MERCHANT_NIM_ADDRESS` | no | — | placeholder `NQ07 0000...` is treated as “not configured” |
| `NIMIQ_RPC_URL` | no | `https://rpc.nimiqwatch.com` | plain `http://` warns |
| `ALLOW_ORIGINS` | dev | `*` in dev, required explicit in prod | `DEV_BYPASS_VERIFY=true` and `ALLOW_ORIGINS=*` are refused unless `NODE_ENV` is `development`/`test` |
| `PRO_PRICE_NIM` / `SUPER_PRICE_NIM` / `TRIAL_DAYS` | no | `100` / `500` / `3` | |

**Frontend `apps/web/.env`**

| Variable | Default |
|---|---|
| `VITE_BACKEND_URL` | `http://localhost:8787` |

---

## API

Base `http://localhost:8787`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/chat` | `{message, deviceId, address?, chatId?, model?}` → `{text, intent, sources, cards, model, plan, chatId, remaining, limit, price?}` |
| `GET` | `/api/chats?deviceId=` | recent chats |
| `GET` | `/api/chats/:id?deviceId=` | full transcript |
| `DELETE` | `/api/chats/:id?deviceId=` | delete |
| `GET` | `/api/apps?intent=` | intent-based discovery |
| `GET` | `/api/wallet/balance?address=NQ...` | verified balance |
| `GET` | `/api/wallet/transaction?hash=` | verified tx |
| `GET` | `/api/price` | live NIM price `{usd, change24h, lastUpdated, source}` |
| `GET` | `/api/plans` | plan defs |
| `GET` | `/api/plans/status?deviceId=` | effective plan + quota (read-only, does not start trial) |
| `POST` | `/api/plans/checkout` | `{plan, deviceId}` → `{sessionId, recipient, amountLuna, data}` |
| `POST` | `/api/plans/verify` | `{sessionId, txHash}` → on-chain grant |
| `POST` | `/api/dev/ask` | `{question, code?, deviceId}` |
| `GET` | `/api/knowledge/search?q=` | grounded docs search |

All APIs have per-IP rate limits and a 64KB body cap. Daily quota is 300/day per device while everything is free.

---

## Deploy

**Live (Render) — current:**

- **API:** https://nimglyde-api.onrender.com — Web Service, Root `backend`, Build `npm install`, Start `npm run start`, env `GROQ_API_KEYS`, `ALLOW_ORIGINS=https://nimglyde.onrender.com`
- **Web:** https://nimglyde.onrender.com — Static Site, Root `apps/web`, Build `npm install && npm run build`, Publish `dist`, env `VITE_BACKEND_URL=https://nimglyde-api.onrender.com`

> Vercel deploy also works — Root `backend/vercel.json` rewrites everything to `/api` (`api/index.ts`). Set `NODE_ENV=production` + explicit `ALLOW_ORIGINS=https://your-frontend.vercel.app`. File store `data/store.json` is ephemeral on serverless — swap to Redis/KV for prod.

**Frontend — any static host**

- Build `apps/web` (`npm run build` → `dist/`). Set `VITE_BACKEND_URL` to your backend URL.

---

## Security Notes

- Private keys/seeds are never requested, stored, or logged — only NQ addresses.
- Link allowlist, app-link repair, HTML-tag denylist, and hallucinated-NQ stripping are all enforced in `backend/src/lib/ai.ts`.
- `X-Forwarded-For` is untrusted — the IP limiter is best-effort; daily quota is per-device with opportunistic TTL.

---

## License

MIT — see `backend/.env.example` and competition rules for submission requirements.

Built for the Nimiq Mini Apps Competition.
