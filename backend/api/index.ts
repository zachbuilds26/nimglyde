import { createApp } from "../src/app.js";

const app = createApp();

// Vercel serverless entry — `vercel.json` rewrites all requests here.
// Works with both Web Fetch and Node (req/res) signatures.
export default async (req: Request) => app.fetch(req);

// For Node-style handler if Vercel invokes with (req,res) — fallback wrapper
// is not needed when `rewrites` destination is /api, but keep for safety.
// Note: file-backed store (data/store.json) is ephemeral on serverless.
// For production, swap store.ts for Upstash Redis / Vercel KV.
