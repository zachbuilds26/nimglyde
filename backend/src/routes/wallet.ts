import { Hono } from "hono";
import { getAccount, getTransactionByHash, summarizeAccount, summarizeTransaction } from "../lib/nimiq-rpc.js";
import { isValidNimiqAddress, isValidTxHash, newId } from "../lib/store.js";

export const walletRoute = new Hono();

// Chain memos are reflected into prose: cap length and strip control chars
// so a hostile memo cannot smuggle formatting or markup into the answer.
function sanitizeMemo(memo: string): string {
  return memo.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 200);
}

// GET /api/wallet/balance?address=NQ... - verified chain lookup only.
walletRoute.get("/balance", async (c) => {
  const requestId = newId("req");
  const address = (c.req.query("address") || "").trim();
  if (!isValidNimiqAddress(address)) return c.json({ error: "address must be a valid NQ address (NQ + 36 chars)" }, 400);
  const canonical = address.replace(/\s+/g, "");
  try {
    const raw = await getAccount(canonical);
    const summary = summarizeAccount(raw);
    if (summary.balanceNim === null) {
      return c.json({
        address: canonical,
        verified: false,
        message: "Balance could not be verified via RPC right now. Check Nimiq Pay home screen - I will not guess.",
      });
    }
    return c.json({ address: canonical, verified: true, balanceNim: summary.balanceNim, balanceLuna: summary.balanceLuna });
  } catch (err) {
    console.error(`[wallet:${requestId}] balance`, err instanceof Error ? err.message : err);
    return c.json(
      { address: canonical, verified: false, message: "Chain lookup failed. I will not guess.", requestId },
      502
    );
  }
});

// GET /api/wallet/transaction?hash=... - translate verified tx into human language.
walletRoute.get("/transaction", async (c) => {
  const requestId = newId("req");
  const hash = (c.req.query("hash") || "").trim();
  if (!isValidTxHash(hash)) return c.json({ error: "hash must be 64 hex chars (0x prefix allowed)" }, 400);
  const canonical = hash.replace(/^0x/i, "").toLowerCase();
  try {
    const raw = await getTransactionByHash(canonical);
    // Never echo the raw RPC blob to the client.
    const { raw: _raw, ...tx } = summarizeTransaction(raw);
    if (!tx.found) return c.json({ hash: canonical, verified: false, message: "Transaction not found on chain. I will not guess." }, 404);
    const amountNim = tx.valueLuna !== null ? tx.valueLuna / 100_000 : null;
    const memo = tx.memo ? sanitizeMemo(tx.memo) : null;
    const explanation =
      amountNim !== null
        ? `This transaction moved ${amountNim} NIM${tx.from ? ` from ${tx.from}` : ""}${tx.to ? ` to ${tx.to}` : ""}.${tx.blockHeight ? ` Included around block ${tx.blockHeight}.` : ""}${memo ? ` Memo: ${memo}.` : ""}`
        : "Transaction found but the amount could not be parsed - showing summary fields instead of guessing.";
    return c.json({ hash: canonical, verified: true, explanation, ...tx, memo });
  } catch (err) {
    console.error(`[wallet:${requestId}] transaction`, err instanceof Error ? err.message : err);
    return c.json(
      { hash: canonical, verified: false, message: "Chain lookup failed. I will not guess.", requestId },
      502
    );
  }
});
