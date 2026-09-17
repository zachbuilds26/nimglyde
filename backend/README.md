# Nimglyde backend

The AI interface to the Nimiq ecosystem. Ask. Understand. Discover. Act.

This backend owns: AI answers (Groq/OpenAI with grounded fallback),
intent-based app discovery, wallet intelligence via Nimiq RPC,
developer copilot, and Pro/Super NIM payments verified on-chain.

Keys live ONLY here. The Mini App frontend is public and must never
hold secrets.

## Run

1. `cd backend` + `npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `GROQ_API_KEY` (free at console.groq.com) for real AI answers.
     Without any key the backend still works in grounded fallback mode.
   - `MERCHANT_NIM_ADDRESS` - your Nimiq wallet for Pro/Super payments.
   - For testing: set `PRO_PRICE_NIM=1` and use testnet RPC.
3. `npm run dev` - serves on `http://localhost:8787`

## Endpoints

- `POST /api/chat` { message, deviceId?, address? } - main brain
- `GET /api/apps?intent=learn` - discovery without browsing categories
- `GET /api/wallet/balance?address=NQ...` - verified balance or honest "cannot verify"
- `GET /api/wallet/transaction?hash=...` - human explanation of verified tx
- `GET /api/plans` + `GET /api/plans/status?deviceId=` - Free / Pro / Super + trial
- `POST /api/plans/checkout` { plan, deviceId } - returns recipient + Luna amount + memo
- `POST /api/plans/verify` { sessionId, txHash } - on-chain check then grants plan
- `POST /api/dev/ask` { question, code? } - dev copilot with sources

## Upgrade flow (Nimiq Pay confirms, backend verifies)

1. App calls checkout - backend returns sessionId + amount + memo.
2. App calls `sendBasicTransactionWithData({ recipient, value: amountLuna, data: memo })`.
3. User confirms in Nimiq Pay native dialog.
4. App calls verify with the tx hash.
5. Backend checks recipient + amount + memo + replay on-chain, then grants 30 days.

Testnet: long-press Nimiq Pay settings 10s > Testnet > Get free NIM (110,000 per tap).
