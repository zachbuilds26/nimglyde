import { Hono } from "hono";
import { answerWithContext, MODEL_ALLOWLIST } from "../lib/ai.js";
import { getAccount, summarizeAccount } from "../lib/nimiq-rpc.js";
import { consumeQuota, peekQuota, resolvePlan } from "../lib/plans.js";
import { ECOSYSTEM_APPS } from "../lib/registry.js";
import { getChat, isValidDeviceId, isValidNimiqAddress, isValidRecordId, newId, saveChat } from "../lib/store.js";

export const chatRoute = new Hono();

// Matches "open it / open that / launch it / take me there" follow-ups.
// Anchored to avoid hijacking legit questions containing substring: require standalone phrase boundaries.
const OPEN_IT = /(?:^|[\s.,!?])open (?:it|that|the app)|launch it|take me there/i;

// POST /api/chat { message, deviceId?, address?, chatId? }
// Remembers the conversation per chatId so follow-ups resolve.
// Returns chatId (new or continuing) for the drawer + next turns.
// Quota is peeked up front but only consumed on a successful answer, so a
// provider timeout or disk failure never burns the user's daily message.
chatRoute.post("/", async (c) => {
  const requestId = newId("req");
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      message?: string;
      deviceId?: string;
      address?: string;
      chatId?: string;
      model?: string;
    };
    const message = (body.message || "").trim();
    if (!message) return c.json({ error: "message is required" }, 400);
    if (message.length > 2000) return c.json({ error: "message too long (max 2000 chars)" }, 400);

    const rawDevice = (body.deviceId || "").trim();
    if (!isValidDeviceId(rawDevice)) return c.json({ error: "valid deviceId required (web_ +24 hex or 64 hex)" }, 400);
    const deviceId = rawDevice.slice(0, 128);
    if (body.chatId && !isValidRecordId("chat", body.chatId)) {
      return c.json({ error: "invalid chatId" }, 400);
    }
    const { effective } = await resolvePlan(deviceId);
    const peeked = peekQuota(deviceId, effective);
    if (peeked.remaining <= 0) {
      return c.json({ error: `daily limit reached (${peeked.limit}/day) — try again tomorrow`, plan: effective, limit: peeked.limit }, 429);
    }

    // Load or start the chat. A chatId from another device is treated as new -
    // chats never leak across devices.
    let chat = body.chatId ? await getChat(body.chatId) : null;
    if (chat && chat.deviceId !== deviceId) chat = null;
    if (!chat) {
      const t = Date.now();
      chat = {
        chatId: newId("chat"),
        deviceId,
        title: message.slice(0, 42),
        messages: [],
        lastAppIds: [],
        createdAt: t,
        updatedAt: t,
      };
    }

    // Wallet context: only verified chain data, never invented.
    // Validate address shape before it ever reaches the prompt - prevents prompt-injection via trusted context block.
    let walletNote: string | undefined;
    const rawAddress = typeof body.address === "string" ? body.address.trim().slice(0, 128) : "";
    if (rawAddress) {
      if (!isValidNimiqAddress(rawAddress)) {
        walletNote = "User shared an address but it failed NQ-format validation — do not guess balances; tell them the address looks invalid and show the correct NQ format.";
      } else {
        // Canonical spaceless form everywhere: the queried and prompted
        // address must be identical.
        const safeAddress = rawAddress.replace(/\s+/g, "");
        try {
          const raw = await getAccount(safeAddress);
          const summary = summarizeAccount(raw);
          walletNote =
            summary.balanceNim !== null
              ? `Address ${safeAddress} holds ${summary.balanceNim} NIM (${summary.balanceLuna} Luna) per chain RPC.`
              : `Address ${safeAddress} shared, but balance could not be verified via RPC right now - do not guess.`;
        } catch {
          walletNote = `Address ${safeAddress} shared, but chain lookup failed - do not guess balances. Explain how to check in Nimiq Pay instead.`;
        }
      }
    }

    // "Open it" resolves against the last recommended apps - no AI call needed.
    if (OPEN_IT.test(message) && chat.lastAppIds.length > 0) {
      const app = ECOSYSTEM_APPS.find((a) => a.id === chat.lastAppIds[0]);
      if (app) {
        const text = `Opening ${app.name} - ${app.description}`;
        chat.messages.push({ role: "user", content: message }, { role: "assistant", content: text });
        chat.updatedAt = Date.now();
        await saveChat(chat);
        const quota = consumeQuota(deviceId, effective);
        return c.json({
          text,
          intent: "open",
          sources: [{ title: app.name, url: app.sourceUrl }],
          cards: [
            {
              kind: "action",
              title: `Open ${app.name}`,
              body: app.description,
              actionLabel: "Open App",
              actionUrl: app.openUrl,
              actionPayload: { appId: app.id },
            },
          ],
          model: "direct-action",
          plan: effective,
          chatId: chat.chatId,
          remaining: quota.remaining,
          limit: quota.limit,
        });
      }
    }

    const history = chat.messages.map((m) => ({ role: m.role, content: m.content }));
    // Model choice is validated at the boundary; anything else is ignored.
    const model = typeof body.model === "string" && MODEL_ALLOWLIST.includes(body.model) ? body.model : undefined;
    const answer = await answerWithContext(message, {
      plan: effective,
      walletNote,
      history,
      model,
    });

    chat.messages.push({ role: "user", content: message }, { role: "assistant", content: answer.text });
    // Keep the transcript bounded: last 40 messages (20 turns). The AI sees
    // the last historyTurns*2 messages (see plan limits).
    if (chat.messages.length > 40) chat.messages = chat.messages.slice(-40);
    chat.lastAppIds = answer.cards
      .filter((card) => card.kind === "app" && typeof card.actionPayload?.appId === "string")
      .map((card) => card.actionPayload!.appId as string);
    chat.updatedAt = Date.now();
    await saveChat(chat);
    const quota = consumeQuota(deviceId, effective);

    return c.json({ ...answer, plan: effective, chatId: chat.chatId, remaining: quota.remaining, limit: quota.limit });
  } catch (err) {
    console.error(`[chat:${requestId}]`, err instanceof Error ? err.message : err);
    return c.json({ error: "internal error", requestId }, 502);
  }
});
