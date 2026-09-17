import { Hono } from "hono";
import { getNimPrice } from "../lib/price.js";

export const priceRoute = new Hono();

// GET /api/price - live NIM price in USD with 24h change
priceRoute.get("/", async (c) => {
  const price = await getNimPrice();
  if (!price) return c.json({ error: "price unavailable right now" }, 502);
  return c.json(price);
});
