import { createApp } from "../src/app.js";
import { handle } from "hono/vercel";

const app = createApp();

// Vercel serverless entry — handles both Fetch and Node (req,res) signatures.
// Using `hono/vercel` adapts Node's IncomingMessage (plain headers object)
// to Fetch's Headers.get, fixing `this.raw.headers.get is not a function`.
export default handle(app);
