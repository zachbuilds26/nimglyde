// Tiny file-backed store for MVP. Good enough for Cycle II judging.
// Upgrade path after competition: swap these functions for Upstash Redis
// without changing routes (same function names/signatures).
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// --- In-process mutex to serialize read-modify-write ---
// Prevents double-grant under concurrency: every load→save that mutates
// state must run inside withLock(). Single-process only; for multi-instance
// deploy swap to Redis/atomics.
let storeLock: Promise<void> = Promise.resolve();
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  const prev = storeLock;
  storeLock = next;
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export type Plan = "free" | "pro" | "super";

export interface DeviceRecord {
  deviceId: string;
  plan: Plan;
  planExpiresAt: number | null; // epoch ms
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CheckoutSession {
  sessionId: string;
  plan: Exclude<Plan, "free">;
  amountLuna: number;
  merchant: string;
  memo: string;
  deviceId: string;
  createdAt: number;
  usedTxHash: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRecord {
  chatId: string;
  deviceId: string;
  title: string;
  messages: ChatMessage[];
  lastAppIds: string[]; // apps recommended most recently (for "open it" follow-ups)
  createdAt: number;
  updatedAt: number;
}

interface StoreShape {
  devices: Record<string, DeviceRecord>;
  sessions: Record<string, CheckoutSession>;
  chats: Record<string, ChatRecord>;
}

const here = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(here, "..", "..", "data", "store.json");
const DATA_BACKUP = `${DATA_FILE}.bak`;

// Per-device caps: the file is rewritten whole on every mutation, so an
// attacker minting deviceIds or chats must not grow it without bound.
const MAX_CHATS_PER_DEVICE = 50;
const MAX_SESSIONS_PER_DEVICE = 5;

async function load(): Promise<StoreShape> {
  let raw: string;
  try {
    raw = await fs.readFile(DATA_FILE, "utf8");
  } catch (err) {
    // Missing file on first boot is fine - anything else is fail-closed.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { devices: {}, sessions: {}, chats: {} };
    }
    throw new Error(`store unreadable: ${(err as Error)?.message || err}`);
  }
  try {
    const parsed = JSON.parse(raw) as StoreShape;
    parsed.devices ||= {};
    parsed.sessions ||= {};
    parsed.chats ||= {};
    return parsed;
  } catch (err) {
    // Never silently wipe paid plans/sessions/chats on corruption: keep a
    // backup of the bad file for forensics and refuse to boot the read.
    try {
      await fs.mkdir(dirname(DATA_FILE), { recursive: true });
      await fs.writeFile(DATA_BACKUP, raw, "utf8");
    } catch {
      // best effort - the throw below is what matters
    }
    throw new Error(`store corrupted (raw copied to store.json.bak): ${(err as Error)?.message || err}`);
  }
}

// Atomic write: tmp file + rename, so a crash mid-write can never leave a
// half-written store.json behind.
async function save(store: StoreShape): Promise<void> {
  await fs.mkdir(dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, DATA_FILE);
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  const store = await load();
  return store.devices[deviceId] || null;
}

export async function upsertDevice(record: DeviceRecord): Promise<void> {
  await withLock(async () => {
    const store = await load();
    store.devices[record.deviceId] = record;
    await save(store);
  });
}

// Atomic read-modify-write inside the lock. Callers must NOT read outside
// and write inside (lost update under concurrency: two concurrent grants
// would both extend from the same expiry and one paid month is lost).
export async function updateDevice(
  deviceId: string,
  fn: (prev: DeviceRecord | null) => DeviceRecord
): Promise<DeviceRecord> {
  return withLock(async () => {
    const store = await load();
    const updated = fn(store.devices[deviceId] || null);
    store.devices[deviceId] = updated;
    await save(store);
    return updated;
  });
}

export async function saveSession(session: CheckoutSession): Promise<void> {
  await withLock(async () => {
    const store = await load();
    // Cap active sessions per device (oldest first) to bound store growth.
    const mine = Object.values(store.sessions)
      .filter((s) => s.deviceId === session.deviceId)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_SESSIONS_PER_DEVICE - 1)))) {
      delete store.sessions[old.sessionId];
    }
    if (store.sessions[session.sessionId]) {
      throw new Error(`session id collision: ${session.sessionId}`);
    }
    store.sessions[session.sessionId] = session;
    await save(store);
  });
}

export async function getSession(sessionId: string): Promise<CheckoutSession | null> {
  const store = await load();
  return store.sessions[sessionId] || null;
}

// Atomic compare-and-set: returns false if already used (replay), true if newly marked.
export async function markSessionUsed(sessionId: string, txHash: string): Promise<boolean> {
  return withLock(async () => {
    const store = await load();
    const session = store.sessions[sessionId];
    if (!session) return false;
    if (session.usedTxHash) return false;
    session.usedTxHash = txHash;
    await save(store);
    return true;
  });
}

export async function getChat(chatId: string): Promise<ChatRecord | null> {
  const store = await load();
  return store.chats[chatId] || null;
}

export async function saveChat(chat: ChatRecord): Promise<void> {
  await withLock(async () => {
    const store = await load();
    // Titles persist user input: strip control chars so a stored title can
    // never break a renderer, and cap length in grapheme-safe slices.
    chat.title = chat.title.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 60);
    store.chats[chat.chatId] = chat;
    // Cap chats per device (LRU by updatedAt) to bound store growth.
    const mine = Object.values(store.chats)
      .filter((c) => c.deviceId === chat.deviceId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of mine.slice(MAX_CHATS_PER_DEVICE)) {
      delete store.chats[old.chatId];
    }
    await save(store);
  });
}

export async function listChats(deviceId: string, limit = 20): Promise<ChatRecord[]> {
  const store = await load();
  return Object.values(store.chats)
    .filter((c) => c.deviceId === deviceId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export async function deleteChat(chatId: string): Promise<void> {
  await withLock(async () => {
    const store = await load();
    delete store.chats[chatId];
    await save(store);
  });
}

export const SESSION_TTL_MS = 60 * 60 * 1000; // 60 min

export function isValidDeviceId(deviceId: string): boolean {
  // Accept web_ + 24 hex (frontend) or 64 hex (Nimiq device-identifier)
  // Reject "anonymous" and arbitrary strings.
  if (!deviceId || deviceId === "anonymous") return false;
  if (/^web_[0-9a-f]{24}$/i.test(deviceId)) return true;
  if (/^[0-9a-f]{64}$/i.test(deviceId)) return true;
  // Also accept web_ prefix with 64 hex for future SDK
  if (/^web_[0-9a-f]{64}$/i.test(deviceId)) return true;
  return false;
}

// Shared shape validators so every route rejects garbage before it ever
// reaches the store or the chain (fixed shapes also bound body sizes).
export function isValidNimiqAddress(addr: string): boolean {
  const clean = addr.replace(/\s+/g, "");
  if (clean.length !== 36) return false;
  return /^NQ[0-9]{2}[0-9A-Z]{32}$/i.test(clean);
}

export function isValidTxHash(hash: string): boolean {
  const clean = hash.trim().replace(/^0x/i, "");
  return /^[0-9a-f]{64}$/i.test(clean);
}

// Record ids are always `${prefix}_${32 hex}` (see newId). Callers pass a
// literal prefix only.
export function isValidRecordId(prefix: "chat" | "nimglyde", id: string): boolean {
  if (!id || id.length > 128) return false;
  return new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(id);
}

export function newId(prefix: string): string {
  let rand: string;
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    rand = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    rand = randomBytes(16).toString("hex");
  }
  return `${prefix}_${rand}`;
}
