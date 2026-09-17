import { Hono } from "hono";
import { deleteChat, getChat, isValidDeviceId, listChats } from "../lib/store.js";

export const chatsRoute = new Hono();

// :id params are dict lookups (no injection), but cap shape anyway so
// oversized ids can't be used for store-scan probing.
function validChatId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

// GET /api/chats?deviceId=... - Recent Chats for the side drawer.
chatsRoute.get("/", async (c) => {
  const raw = (c.req.query("deviceId") || "").trim();
  if (!isValidDeviceId(raw)) return c.json({ error: "valid deviceId required" }, 400);
  const deviceId = raw.slice(0, 128);
  const chats = await listChats(deviceId);
  return c.json({
    chats: chats.map((chat) => ({
      chatId: chat.chatId,
      title: chat.title,
      updatedAt: chat.updatedAt,
      preview: [...chat.messages].reverse().find((m) => m.role === "assistant")?.content.slice(0, 120) || "",
    })),
  });
});

// GET /api/chats/:id?deviceId=... - full transcript when reopening a chat.
chatsRoute.get("/:id", async (c) => {
  const raw = (c.req.query("deviceId") || "").trim();
  if (!isValidDeviceId(raw)) return c.json({ error: "valid deviceId required" }, 400);
  const id = c.req.param("id");
  if (!validChatId(id)) return c.json({ error: "invalid chat id" }, 400);
  const deviceId = raw.slice(0, 128);
  const chat = await getChat(id);
  if (!chat || chat.deviceId !== deviceId) return c.json({ error: "chat not found" }, 404);
  return c.json({ chatId: chat.chatId, title: chat.title, messages: chat.messages, updatedAt: chat.updatedAt });
});

// DELETE /api/chats/:id?deviceId=... - remove a chat.
chatsRoute.delete("/:id", async (c) => {
  const raw = (c.req.query("deviceId") || "").trim();
  if (!isValidDeviceId(raw)) return c.json({ error: "valid deviceId required" }, 400);
  const id = c.req.param("id");
  if (!validChatId(id)) return c.json({ error: "invalid chat id" }, 400);
  const deviceId = raw.slice(0, 128);
  const chat = await getChat(id);
  if (!chat || chat.deviceId !== deviceId) return c.json({ error: "chat not found" }, 404);
  await deleteChat(chat.chatId);
  return c.json({ ok: true });
});
