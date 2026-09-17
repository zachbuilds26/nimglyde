import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import HubApi from "@nimiq/hub-api";

// Nimglyde minimal chat shell — rebuilt to match the reference layout.
// White + single yellow accent, Space Grotesk, Material Symbols for icons.
// Wired to the Nimglyde backend contracts in backend/src/routes/*.

const RAW_BACKEND = (
  (import.meta as unknown as { env: Record<string, string | undefined> }).env
    .VITE_BACKEND_URL || "http://localhost:8787"
).trim();
const BACKEND = RAW_BACKEND.replace(/\/+$/, "");

type Plan = "free" | "pro" | "super";
type WalletStatus = "idle" | "connecting" | "connected" | "error";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface Source {
  title: string;
  url: string;
}

interface Card {
  kind: string;
  title: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
}

interface NimPrice {
  usd: number;
  change24h: number;
  lastUpdated: string;
  source: string;
}

interface ChatResponse {
  text: string;
  intent: string;
  model: string;
  sources: Source[];
  cards: Card[];
  plan: Plan;
  chatId: string;
  remaining?: number;
  limit?: number;
  price?: NimPrice | null;
}

interface Provider {
  listAccounts(): Promise<unknown>;
  sendBasicTransactionWithData(tx: {
    recipient: string;
    value: number;
    data: string;
  }): Promise<unknown>;
}

interface Toast {
  id: number;
  kind: "error" | "ok" | "info";
  text: string;
}

interface MsgMeta {
  sources: Source[];
  cards: Card[];
  model: string;
  intent: string;
  elapsedMs: number | null;
  answeredAt: number | null;
  price?: NimPrice | null;
}

const EMPTY_META: MsgMeta = { sources: [], cards: [], model: "", intent: "", elapsedMs: null, answeredAt: null, price: null };

// Inline formatting for [title](url), bare URLs, **bold**, `code` and
// *italic*. Text is never injected as HTML — everything renders as React
// text nodes, so this is XSS-safe. Only https? schemes are linkified.
// javascript:, data:, //protocol-relative and other schemes render as plain text.
function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Split out balanced [title](url) links - URLs may contain parens (e.g.
// Wikipedia), which a naive [^)] split would cut early. A leading "!"
// (image) degrades to a plain link with no stray "!".
interface LinkPart {
  kind: "text" | "link";
  text: string;
  title?: string;
  url?: string;
}
function splitLinks(text: string): LinkPart[] {
  const out: LinkPart[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ kind: "text", text: buf });
      buf = "";
    }
  };
  while (i < text.length) {
    const start = text.indexOf("[", i);
    if (start === -1) {
      buf += text.slice(i);
      break;
    }
    const mid = text.indexOf("](", start);
    if (mid === -1) {
      buf += text.slice(i);
      break;
    }
    let depth = 0;
    let end = -1;
    for (let j = mid + 2; j < text.length; j++) {
      const ch = text[j];
      if (ch === "(") depth++;
      else if (ch === ")") {
        if (depth === 0) {
          end = j;
          break;
        }
        depth--;
      } else if (/\s/.test(ch) && depth === 0) {
        break; // URLs contain no raw spaces - not a link
      }
    }
    if (end === -1) {
      buf += text.slice(i, mid + 2);
      i = mid + 2;
      continue;
    }
    const image = start > 0 && text[start - 1] === "!";
    buf += text.slice(i, image ? start - 1 : start);
    flush();
    out.push({ kind: "link", text: "", title: text.slice(start + 1, mid), url: text.slice(mid + 2, end) });
    i = end + 1;
  }
  flush();
  return out;
}

function renderWithPrice(text: string, keyBase: string): ReactNode[] {
  // Split keeps the delimiter so we can style the change
  const parts = text.split(/([+-]\d+(?:\.\d+)?%)/g);
  if (parts.length === 1) return [<span key={`${keyBase}-t`}>{text}</span>];
  return parts.map((part, idx) => {
    if (/^[+-]\d+(?:\.\d+)?%$/.test(part)) {
      const isUp = part.startsWith("+");
      return (
        <span key={`${keyBase}-p-${idx}`} className={`price-change ${isUp ? "up" : "down"}`}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {isUp ? "trending_up" : "trending_down"}
          </span>
          {part}
        </span>
      );
    }
    return part ? <span key={`${keyBase}-t-${idx}`}>{part}</span> : null;
  }).filter(Boolean) as ReactNode[];
}
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const segments = splitLinks(text);
  return (segments.flatMap((seg, si): ReactNode[] => {
    if (seg.kind === "link") {
      const title = seg.title || "";
      const url = seg.url || "";
      if (!title || !isSafeHttpUrl(url)) {
        // Render as plain text if not https? — prevents javascript: XSS
        return [<span key={`${keyPrefix}-m-${si}`}>{title || url}</span>];
      }
      return [
        <a
          key={`${keyPrefix}-m-${si}`}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="rich-link"
        >
          {title}
        </a>,
      ];
    }
    return (seg.text.split(/(https?:\/\/[^\s)>]+)/g).flatMap((chunk, ci): ReactNode[] => {
      if (/^https?:\/\//i.test(chunk) && isSafeHttpUrl(chunk)) {
        const trimmed = chunk.match(/^(.*?)[.,;:!?\]'"]+$/);
        const clean = trimmed ? trimmed[1] : chunk;
        const trail = trimmed ? chunk.slice(clean.length) : "";
        if (!isSafeHttpUrl(clean)) {
          return [<span key={`${keyPrefix}-s-${si}-${ci}`}>{chunk}</span>];
        }
        return [
          <a
            key={`${keyPrefix}-u-${si}-${ci}`}
            href={clean}
            target="_blank"
            rel="noreferrer noopener"
            className="rich-link"
          >
            {clean}
          </a>,
          ...(trail ? [<span key={`${keyPrefix}-t-${si}-${ci}`}>{trail}</span>] : []),
        ];
      }
      return (chunk.split(/(\*\*.+?\*\*|`[^`]+`)/g).flatMap((part, pi): ReactNode[] => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return [<strong key={`${keyPrefix}-b-${si}-${ci}-${pi}`}>{renderWithPrice(part.slice(2, -2), `${keyPrefix}-b-${si}-${ci}-${pi}`)}</strong>];
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return [<code key={`${keyPrefix}-c-${si}-${ci}-${pi}`}>{part.slice(1, -1)}</code>];
        }
        return (part.split(/(\*[^*\n]+\*)/g).flatMap((sp, spi): ReactNode[] => {
          // Italic needs a letter inside: "5*3*7" and "a*b*c" stay literal.
          if (sp.startsWith("*") && sp.endsWith("*") && sp.length > 2 && /[A-Za-z]/.test(sp.slice(1, -1))) {
            return [<em key={`${keyPrefix}-i-${si}-${ci}-${pi}-${spi}`}>{renderWithPrice(sp.slice(1, -1), `${keyPrefix}-i-${si}-${ci}-${pi}-${spi}`)}</em>];
          }
          return renderWithPrice(sp, `${keyPrefix}-s-${si}-${ci}-${pi}-${spi}`);
        }) as ReactNode[]);
      }) as ReactNode[]);
    }) as ReactNode[]);
  }) as ReactNode[]);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  // A lone "-" is a bullet, not a separator: require 3+ dashes per cell.
  return cells.length > 0 && cells.every((c) => /^:?-+-+:?$/.test(c) && c.replace(/:/g, "").length >= 3);
}

// A table header is a pipe row (outer pipes optional) with 2+ cells,
// immediately followed by a valid separator row.
function isTableHeader(line: string, next: string | undefined): boolean {
  if (next === undefined || !isTableSeparator(next)) return false;
  if (/^\s*\|.*\|\s*$/.test(line)) return true;
  return line.includes("|") && splitTableRow(line).length >= 2;
}

// Minimal block renderer: headings, paragraphs, bullet lists (-, *, •),
// numbered steps (1. 2.), tables, blockquotes, rules, fenced code blocks.
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  // Normalise emoji keycaps (1️⃣) into plain "1." so lists render cleanly.
  const lines = text.replace(/^(\s*)(\d)️?\u20E3\s*/gm, "$1$2. ").split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(<pre key={key++}>{codeLines.join("\n")}</pre>);
      continue;
    }

    // Horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={key++} />);
      i++;
      continue;
    }

    // Table — header row, separator row, then body rows. Outer pipes are
    // optional (GFM allows "a | b" headers) as long as a valid separator
    // follows; body rows are any lines containing a pipe.
    if (isTableHeader(line, i + 1 < lines.length ? lines[i + 1] : undefined) && i + 1 < lines.length) {
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const tableKey = key++;
      blocks.push(
        <div className="table-wrap" key={tableKey}>
          <table>
            <thead>
              <tr>
                {header.map((cell, c) => (
                  <th key={c}>{renderInline(cell, `th-${tableKey}-${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell, `td-${tableKey}-${r}-${c}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote — consecutive > lines, blank > lines split paragraphs
    if (/^\s*>\s?/.test(line)) {
      const paras: string[][] = [[]];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        const content = lines[i].replace(/^\s*>\s?/, "");
        if (!content.trim()) {
          if (paras[paras.length - 1].length) paras.push([]);
        } else {
          paras[paras.length - 1].push(content.trim());
        }
        i++;
      }
      const quoteKey = key++;
      blocks.push(
        <blockquote key={quoteKey}>
          {paras
            .filter((p) => p.length)
            .map((p, pIdx) => (
              <p key={pIdx}>{renderInline(p.join(" "), `q-${quoteKey}-${pIdx}`)}</p>
            ))}
        </blockquote>
      );
      continue;
    }

    // Bullet list
    if (/^\s*([-*•])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•])\s+/, ""));
        i++;
      }
      const listKey = key++;
      blocks.push(
        <ul key={listKey}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, `ul-${listKey}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered steps
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      const listKey = key++;
      blocks.push(
        <ol key={listKey}>
          {items.map((item, j) => (
            <li key={j}>{renderInline(item, `ol-${listKey}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Heading — ## renders larger, ### and #### smaller (semantic headings for a11y).
    // ##### and ###### also map to h4 (valid markdown, same small style).
    const heading = line.match(/^\s*(#{1,6})\s+(.*)/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const k = key++;
      if (level <= 2) blocks.push(<h2 key={k} className="rich-h2">{renderInline(text, `h-${k}`)}</h2>);
      else if (level === 3) blocks.push(<h3 key={k} className="rich-h">{renderInline(text, `h-${k}`)}</h3>);
      else blocks.push(<h4 key={k} className="rich-h">{renderInline(text, `h-${k}`)}</h4>);
      i++;
      continue;
    }

    // Blank line — paragraph break
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph — join wrapped lines until a blank line or block start
    const para: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*([-*•])\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*#{1,6}\s+/.test(lines[i]) &&
      !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !isTableHeader(lines[i], i + 1 < lines.length ? lines[i + 1] : undefined)
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={key++}>{renderInline(para.join(" "), `p-${key}`)}</p>);
  }

  return <div className="rich">{blocks}</div>;
}

function PriceBlock({ price }: { price: NimPrice }) {
  const isUp = price.change24h >= 0;
  const change = `${isUp ? "+" : ""}${price.change24h.toFixed(2)}%`;
  return (
    <div className="price-block" role="status" aria-label={`NIM price $${price.usd.toFixed(6)}, ${change}`}>
      <span className="price-value">${price.usd.toFixed(6)}</span>
      <span className={`price-change ${isUp ? "up" : "down"}`}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {isUp ? "trending_up" : "trending_down"}
        </span>
        {change}
      </span>
      <span className="price-meta">{price.source}</span>
    </div>
  );
}

const DEFAULT_MODEL = "openai/gpt-oss-120b";

const SUGGESTIONS = [  {
    icon: "explore",
    label: "Nimiq ecosystem",
    prompt: "Give me an overview of the Nimiq ecosystem. What should I know first?",
  },
  {
    icon: "currency_exchange",
    label: "How to buy NIM",
    prompt: "How do I buy NIM safely? Walk me through the options.",
  },
  {
    icon: "menu_book",
    label: "Nimiq whitepaper",
    prompt: "Summarise the Nimiq whitepaper and link me to the source.",
  },
];

let fallbackDeviceId: string | null = null;
function getDeviceId(): string {
  try {
    let id = localStorage.getItem("nimglyde_device");
    if (!id) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = `web_${Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}`;
      localStorage.setItem("nimglyde_device", id);
    }
    // Validate shape — reject legacy "anonymous" or corrupted values
    if (!/^web_[0-9a-f]{24}$/i.test(id) && !/^[0-9a-f]{64}$/i.test(id)) {
      // Migrate bad id to fresh one
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = `web_${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      localStorage.setItem("nimglyde_device", id);
    }
    return id;
  } catch {
    // localStorage blocked or crypto unavailable — in-memory fallback (prevents white-screen, no error boundary needed)
    if (fallbackDeviceId) return fallbackDeviceId;
    try {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      fallbackDeviceId = `web_${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    } catch {
      fallbackDeviceId = `web_${Math.random().toString(16).slice(2).padStart(24, "0").slice(0, 24)}`;
    }
    return fallbackDeviceId;
  }
}

function deniedMessage(result: unknown): string | null {
  if (result && typeof result === "object" && "error" in result) {
    const err = (result as { error?: { message?: string } }).error;
    return err?.message || "Wallet request was denied.";
  }
  return null;
}

let toastId = 1;

// Daily-limit failures carry their own UI path (open Plans), so they get a
// distinct error type instead of a generic message.
class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

export default function App() {
  const deviceId = useMemo(() => getDeviceId(), []);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [meta, setMeta] = useState<MsgMeta[]>([]);
  const [showJump, setShowJump] = useState(false);
  const [chatId, setChatId] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [modelId] = useState<string>(DEFAULT_MODEL);

  const [walletStatus, setWalletStatus] = useState<WalletStatus>("idle");
  const [walletError, setWalletError] = useState("");
  const [address, setAddress] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottomRef = useRef(true);
  const copyTimer = useRef<number | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const hubRef = useRef<HubApi | null>(null);
  const requestIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const connectAbortRef = useRef<AbortController | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    // Legacy #/app hash from the old landing page: normalize it away so the
    // app always lives at the root URL.
    if (typeof window !== "undefined" && window.location.hash === "#/app") {
      try {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {
        window.location.hash = "";
      }
    }
  }, []);

  // Restore a previously connected wallet address (address only, never keys)
  // across reloads.
  useEffect(() => {
    try {
      const savedAddr = localStorage.getItem("nimglyde_wallet");
      if (savedAddr && /^NQ[0-9]{2}[0-9A-Z]{32}$/i.test(savedAddr.replace(/\s+/g, ""))) {
        setAddress(savedAddr.replace(/\s+/g, ""));
        setWalletStatus("connected");
      }
    } catch {
      // storage blocked - user simply reconnects
    }
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (nearBottomRef.current) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: reduced ? "auto" : "smooth",
      });
    }
  }, [messages, busy]);

  function handleScroll() {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottomRef.current = gap < 120;
      setShowJump(gap >= 120);
    });
  }

  function jumpToBottom() {
    nearBottomRef.current = true;
    setShowJump(false);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }

  // Cleanup timers and animation frames on unmount — prevents leaks noted in audit
  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      if (scrollRafRef.current !== null) window.cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);


  // Map low-level fetch failures to actionable messages. AbortError from the
  // request timeout is a connectivity problem, not a generic failure.
  function friendlyError(err: unknown, fallback: string): string {
    if (err instanceof DOMException && err.name === "AbortError") {
      return "Taking too long — check your connection and tap Retry.";
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return "Taking too long — check your connection and tap Retry.";
    }
    return err instanceof Error ? err.message : fallback;
  }

  function pushToast(kind: Toast["kind"], text: string) {
    const id = toastId++;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  }

  function startNewChat() {
    // Cancel any in-flight answer first: its request id is bumped so a late
    // resolve is discarded instead of landing in the fresh thread.
    requestIdRef.current++;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    setBusy(false);
    setChatId("");
    setMessages([]);
    setMeta([]);
    inputRef.current?.focus();
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedKey(null), 2000);
      pushToast("ok", "Copied to clipboard.");
    } catch {
      pushToast("error", "Could not copy. Select the text manually.");
    }
  }

  function autoresize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function editMessage(text: string) {
    setInput(text);
    requestAnimationFrame(() => {
      autoresize(inputRef.current);
      inputRef.current?.focus();
    });
  }

  async function ask(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || busy) return;
    if (walletStatus !== "connected") {
      pushToast("error", "Connect your wallet to start chatting.");
      return;
    }
    if (trimmed.length > 2000) {
      pushToast("error", "Message too long (max 2000 characters).");
      return;
    }
    const thisReq = ++requestIdRef.current;
    setInput("");
    autoresize(inputRef.current);
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setMeta((m) => [...m, { ...EMPTY_META }]);
    nearBottomRef.current = true;
    setShowJump(false);
    setBusy(true);
    try {
      const { data, elapsedMs } = await complete(trimmed);
      if (requestIdRef.current !== thisReq) return; // stale: new chat started, discard
      applyAnswer(data, elapsedMs);
    } catch (err) {
      if (requestIdRef.current !== thisReq) return;
      // Keep the user bubble: the message is preserved and can be resent via
      // Edit instead of forcing a retype.
      pushToast("error", friendlyError(err, "Nimglyde could not answer right now."));
    } finally {
      if (requestIdRef.current === thisReq) setBusy(false);
    }
  }

  async function complete(userText: string): Promise<{ data: ChatResponse; elapsedMs: number }> {
    requestAbortRef.current?.abort();
    const ctrl = new AbortController();
    requestAbortRef.current = ctrl;
    // Manual timeout (abortable by New Chat): AbortSignal.timeout() alone
    // cannot be cancelled by the user.
    const timer = window.setTimeout(() => ctrl.abort(), 90_000);
    const started = performance.now();
    try {
      const res = await fetch(`${BACKEND}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: userText,
          deviceId,
          chatId: chatId || undefined,
          address: address || undefined,
          model: modelId,
        }),
        signal: ctrl.signal,
      });
      let data: (ChatResponse & { error?: string }) | null = null;
      try {
        data = (await res.json()) as ChatResponse & { error?: string };
      } catch {
        throw new Error(`Server returned ${res.status} — try again.`);
      }
      if (!res.ok || !data) {
        if (res.status === 429) throw new QuotaError(data?.error || "Daily limit reached.");
        throw new Error(data?.error || "Nimglyde could not answer right now.");
      }
      return { data, elapsedMs: performance.now() - started };
    } finally {
      window.clearTimeout(timer);
      if (requestAbortRef.current === ctrl) requestAbortRef.current = null;
    }
  }

  function applyAnswer(data: ChatResponse, elapsedMs: number, insertAt?: number) {
    setChatId(data.chatId);
    const msg: ChatMsg = { role: "assistant", content: data.text };
    const mm: MsgMeta = {
      sources: data.sources || [],
      cards: data.cards || [],
      model: data.model || "",
      intent: data.intent || "",
      elapsedMs,
      answeredAt: Date.now(),
      price: data.price || null,
    };
    if (insertAt === undefined) {
      setMessages((m) => [...m, msg]);
      setMeta((m) => [...m, mm]);
    } else {
      setMessages((m) => [...m.slice(0, insertAt), msg, ...m.slice(insertAt)]);
      setMeta((m) => [...m.slice(0, insertAt), mm, ...m.slice(insertAt)]);
    }
  }

  async function retry(i: number) {
    if (busy) return;
    if (walletStatus !== "connected") {
      pushToast("error", "Connect your wallet to start chatting.");
      return;
    }
    let u = i - 1;
    while (u >= 0 && messages[u].role !== "user") u--;
    if (u < 0) return;
    const userText = messages[u].content;
    const backupMsg = messages[i];
    const backupMeta = meta[i];
    const thisReq = ++requestIdRef.current;
    setMessages((m) => m.filter((_, idx) => idx !== i));
    setMeta((mt) => mt.filter((_, idx) => idx !== i));
    nearBottomRef.current = true;
    setShowJump(false);
    setBusy(true);
    try {
      const { data, elapsedMs } = await complete(userText);
      if (requestIdRef.current !== thisReq) return; // stale: new chat started, discard
      applyAnswer(data, elapsedMs, i);
    } catch (err) {
      if (requestIdRef.current !== thisReq) return;
      // Restore backup on failure — failed retry must not delete the answer permanently
      if (backupMsg) {
        setMessages((m) => [...m.slice(0, i), backupMsg, ...m.slice(i)]);
        setMeta((mt) => [...mt.slice(0, i), backupMeta ?? { ...EMPTY_META }, ...mt.slice(i)]);
      }
      pushToast("error", friendlyError(err, "Nimglyde could not answer right now."));
    } finally {
      if (requestIdRef.current === thisReq) setBusy(false);
    }
  }

  async function finishConnect(addr: string, hub: HubApi | null, _injected: Provider | null) {
    const canonical = addr.replace(/\s+/g, "");
    hubRef.current = hub;
    setAddress(canonical);
    setWalletStatus("connected");
    setWalletError("");
    try {
      localStorage.setItem("nimglyde_wallet", canonical);
    } catch {
      // storage blocked - session simply won't survive reload
    }
    pushToast("ok", "Wallet connected.");
  }

  function disconnectWallet() {
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    hubRef.current = null;
    setAddress("");
    setWalletStatus("idle");
    setWalletError("");
    try {
      localStorage.removeItem("nimglyde_wallet");
    } catch {
      // ignore
    }
    pushToast("info", "Wallet disconnected.");
  }

  function cancelConnect() {
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    setWalletStatus("idle");
    setWalletError("");
  }

  const NQ_RE = /^NQ[0-9]{2}[0-9A-Z]{32}$/i;

  async function connectWallet(): Promise<Provider | null> {
    connectAbortRef.current?.abort();
    const ctrl = new AbortController();
    connectAbortRef.current = ctrl;
    setWalletStatus("connecting");
    setWalletError("");
    // Raced against every wallet promise: the Hub popup must never hang the
    // gate forever, and Cancel must always work.
    const timeout = (ms: number, message: string): Promise<never> =>
      new Promise<never>((_, reject) => {
        const t = window.setTimeout(() => reject(new Error(message)), ms);
        ctrl.signal.addEventListener("abort", () => {
          window.clearTimeout(t);
          reject(new Error("Connection cancelled."));
        });
      });
    try {
      // Inside Nimiq Pay the host injects window.nimiq - use the Mini App SDK.
      // A regular desktop browser has no injected provider, so use the
      // official Nimiq Hub popup instead (hub.nimiq.com, chooseAddress).
      const injected =
        typeof window !== "undefined" &&
        !!(window as unknown as { nimiq?: unknown }).nimiq;
      let addr = "";
      let connected: Provider | null = null;
      let hub: HubApi | null = null;
      if (injected) {
        try {
          const mod = (await import("@nimiq/mini-app-sdk")) as unknown as {
            init: (opts?: { timeout?: number }) => Promise<unknown>;
          };
          connected = (await Promise.race([
            mod.init({ timeout: 10_000 }),
            timeout(15_000, "Wallet is taking too long — check Nimiq Pay and try again."),
          ])) as unknown as Provider;
          const result = await Promise.race([
            connected.listAccounts(),
            timeout(10_000, "Wallet is taking too long — check Nimiq Pay and try again."),
          ]);
          const denied = deniedMessage(result);
          if (denied) throw new Error(denied);
          // Strict shape-check: full NQ address, not just "long enough".
          if (!Array.isArray(result) || result.length === 0) {
            throw new Error("No Nimiq account was shared.");
          }
          const first = String(result[0] ?? "").replace(/\s+/g, "");
          if (!NQ_RE.test(first)) {
            throw new Error("Wallet returned an invalid account.");
          }
          addr = first;
        } catch (injectedErr) {
          // Injected wallet failed: fall through to the Hub popup instead of
          // stranding the user, unless they cancelled.
          connected = null;
          if (ctrl.signal.aborted) throw injectedErr;
        }
      }
      if (!addr) {
        hub = new HubApi("https://hub.nimiq.com");
        const info = (await Promise.race([
          hub.chooseAddress({ appName: "Nimglyde" }),
          timeout(
            120_000,
            "Popup timed out — allow popups for this site, then try again."
          ),
        ])) as unknown as { address?: string };
        if (!info || typeof info.address !== "string" || !info.address) {
          throw new Error("No Nimiq address was shared.");
        }
        const candidate = info.address.replace(/\s+/g, "");
        if (!NQ_RE.test(candidate)) {
          throw new Error("The Hub returned an invalid address.");
        }
        addr = candidate;
      }
      if (ctrl.signal.aborted) return null;
      await finishConnect(addr, hub, connected);
      return connected;
    } catch (err) {
      if (ctrl.signal.aborted) {
        setWalletStatus("idle");
        return null;
      }
      setWalletStatus("error");
      const raw = err instanceof Error ? err.message : "Could not connect wallet.";
      const friendly = /popup|block/i.test(raw)
        ? "Popup blocked - allow popups for this site, then try again."
        : /timeout|taking too long/i.test(raw)
          ? raw
          : /clos|cancel|dismiss/i.test(raw)
            ? "Connection closed before choosing an address."
            : raw;
      setWalletError(friendly);
      pushToast("error", friendly);
      return null;
    } finally {
      if (connectAbortRef.current === ctrl) connectAbortRef.current = null;
    }
  }

  const empty = messages.length === 0;
  const gated = walletStatus !== "connected";

  return (
    <div className="page">
      <div className="card">
        <header className="topbar">
          <span className="brand">
            <img src="/nimglyde-mark.png" alt="Nimglyde" />
            <strong>Nimglyde</strong>
            <span className="beta-tag">Beta</span>
          </span>
          <span className="top-spacer" />
          {!gated && (
            <span className="wallet-chip" title={address}>
              {address.slice(0, 6)}…{address.slice(-4)}
              <button
                type="button"
                className="icon-btn"
                onClick={disconnectWallet}
                aria-label="Disconnect wallet"
                title="Disconnect wallet"
              >
                <span className="material-symbols-outlined" aria-hidden="true">logout</span>
              </button>
            </span>
          )}
          <button
            className="icon-btn"
            onClick={startNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <span className="material-symbols-outlined" aria-hidden="true">edit_square</span>
          </button>
        </header>

        <main className="stage">
          <div className="scroll" ref={scrollRef} onScroll={handleScroll}>
            <div className="inner">
              {empty ? (
                <>
                <section className="hero">
                  <h1 className="gradient-wave-text">
                    <img className="hero-mark" src="/nimglyde-mark.png" alt="" />
                    Ask me anything, <em>Nimiq.</em>
                  </h1>
                </section>
                <div className="pills">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => void ask(s.prompt)}
                      disabled={busy || gated}
                      title={gated ? "Connect your wallet to start chatting" : s.label}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">{s.icon}</span>
                      {s.label}
                    </button>
                  ))}
                </div>
                </>
              ) : (
                <section className="thread" aria-live="polite" aria-label="Conversation">
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <article className="user-row" key={`user-${i}`}>
                        <div className="user-bubble">{m.content}</div>
                        <div className="user-actions">
                          <button
                            type="button"
                            className="ghost-btn"
                            onClick={() => editMessage(m.content)}
                            aria-label="Edit message"
                            title="Edit in composer"
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">edit</span>
                          </button>
                          <button
                            type="button"
                            className={`ghost-btn${copiedKey === `u-${i}` ? " copied" : ""}`}
                            onClick={() => void copyText(m.content, `u-${i}`)}
                            aria-label="Copy message"
                            title="Copy message"
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">
                              {copiedKey === `u-${i}` ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      </article>
                    ) : (
                      <article className="ai-row" key={`assistant-${i}`}>
                        <div className="ai-text">
                          {meta[i]?.price ? <PriceBlock price={meta[i].price!} /> : null}
                          <RichText text={m.content} />
                          <div className="ai-actions">
                            <button
                              type="button"
                              className={`ghost-btn${copiedKey === `a-${i}` ? " copied" : ""}`}
                              onClick={() => void copyText(m.content, `a-${i}`)}
                              aria-label="Copy answer"
                              title="Copy answer"
                            >
                              <span className="material-symbols-outlined" aria-hidden="true">
                                {copiedKey === `a-${i}` ? "check" : "content_copy"}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="ghost-btn"
                              onClick={() => void retry(i)}
                              disabled={busy}
                              aria-label="Retry answer"
                              title="Retry answer"
                            >
                              <span className="material-symbols-outlined" aria-hidden="true">refresh</span>
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  )}
                  {busy && (
                    <article className="ai-row typing-row" role="status">
                      <span className="sr-only">Nimglyde is answering…</span>
                      <span className="typing" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </article>
                  )}
                </section>
              )}
            </div>
          </div>

          <div className="composer-wrap">
            {showJump && (
              <button
                type="button"
                className="jump-btn"
                onClick={jumpToBottom}
                aria-label="Scroll to latest message"
                title="Scroll to latest"
              >
                <span className="material-symbols-outlined" aria-hidden="true">arrow_downward</span>
              </button>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(input);
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoresize(e.target);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(input);
                  }
                }}
                placeholder={gated ? "Connect your wallet to start chatting" : "Ask Nimglyde"}
                rows={1}
                maxLength={2000}
                aria-label="Type your question here"
                disabled={gated}
              />
              <button
                type="submit"
                className="send-btn"
                disabled={!input.trim() || busy || gated}
                aria-label="Send message"
                title="Send"
              >
                <span className="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
              </button>
            </form>
          </div>
        </main>

        {gated && (
          <div className="gate-backdrop">
            <div className="gate-pattern" aria-hidden="true">
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m1" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m2" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m3" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m4" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m5" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m6" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m7" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m8" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m9" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m10" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m11" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m12" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m13" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m14" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m15" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m16" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m17" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m18" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m19" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m20" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m21" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m22" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m23" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m24" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m25" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m26" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m27" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m28" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m29" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m30" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m31" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m32" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m33" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m34" />
              <img src="/nimglyde-mark.png" alt="" className="gate-mark m35" />
            </div>
            <section
              className="gate-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gate-title"
            >
              <img src="/nimglyde-mark.png" alt="" />
              <h2 id="gate-title">Connect to use Nimglyde</h2>
              <p id="gate-desc">
                Connect your Nimiq wallet to start chatting. In your browser,
                the official Nimiq Hub opens in a popup to pick or create an address.
              </p>
              {walletStatus === "error" && walletError ? (
                <p className="gate-error" role="alert">{walletError}</p>
              ) : null}
              <button
                className="primary-btn"
                onClick={() => void connectWallet()}
                disabled={walletStatus === "connecting"}
                autoFocus
                aria-describedby="gate-desc"
              >
                {walletStatus === "connecting"
                  ? "Connecting…"
                  : walletStatus === "error"
                    ? "Try again"
                    : "Connect wallet"}
              </button>
              {walletStatus === "connecting" ? (
                <button type="button" className="link-btn" onClick={cancelConnect}>
                  Cancel
                </button>
              ) : null}
              <small>
                <span className="material-symbols-outlined" aria-hidden="true">lock</span>
                Your keys never leave your wallet.
              </small>
            </section>
          </div>
        )}

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div className={`toast ${t.kind}`} key={t.id} role={t.kind === "error" ? "alert" : "status"}>
              {t.text}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
