// Grounded knowledge base. Every answer Nimglyde gives about the ecosystem
// should come from here (or the live AI with these as context), with sources
// shown. Never hallucinate APIs, app capabilities, or wallet features.
export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  sourceUrl: string;
  tags: string[];
  lastVerified?: string; // YYYY-MM-DD discipline: verify sourceUrl returns 200 and body still accurate
}

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "connect-wallet",
    title: "Connect a wallet to Nimglyde",
    body: "On this site Connect takes you to the official Nimiq Hub (hub.nimiq.com) - full page or popup - where you pick one of your addresses or create a new account with a password and Login File. The Hub then sends you back connected. Nimglyde only ever receives your address; keys never leave your wallet. If a popup fails or resets, use the full-page option.",
    sourceUrl: "https://nimiq.dev/hub/api-reference",
    tags: ["connect", "wallet", "hub", "login", "sign in", "popup"],
  },
  {
    id: "what-can-nimglyde-do",    title: "What Nimglyde can do",
    body: "Nimglyde is the AI for Nimiq: it knows and can answer any question about Nimiq and its ecosystem. Ask it to explain Nimiq, how to buy, send or receive NIM, how wallets work, which apps to use, how to build Mini Apps, or what is happening in the ecosystem. Connect a wallet and it can also look up a real balance and help take the next action.",
    sourceUrl: "https://www.nimiq.com",
    tags: ["what can", "can you do", "nimglyde", "help", "features", "about", "able"],
  },
  {
    id: "what-is-miniapp",
    title: "What is a Mini App",
    body: "A Mini App is a web app that runs inside Nimiq Pay and connects to the user's Nimiq or Ethereum wallet through injected providers. Without at least one provider connection it is not a Mini App in any meaningful sense.",
    sourceUrl: "https://nimiq.dev/mini-apps/faq",
    tags: ["mini app", "build", "start"],
  },
  {
    id: "nimiq-provider-access",
    title: "Access the Nimiq provider",
    body: "A Mini App talks to the wallet through the official Mini App SDK, which gives it a Nimiq provider object. Through it the app can ask for the user's accounts, ask the user to sign, and read chain status such as consensus and block height. Account and signing requests always ask the user first. The exact calls live in the official provider reference.",
    sourceUrl: "https://nimiq.dev/mini-apps/api-reference/nimiq-provider",
    tags: ["provider", "sdk", "init", "connect wallet", "account", "build"],
  },
  {
    id: "accept-nim",
    title: "Accept NIM payments",
    body: "To accept NIM, the app prepares a basic payment for the user with a recipient and an amount counted in Luna (1 NIM = 100,000 Luna), optionally with a text memo attached. Nimiq Pay then shows its native confirmation dialog and only moves funds if the user approves — keys never leave the wallet. The exact payment calls live in the official provider reference.",
    sourceUrl: "https://nimiq.dev/mini-apps/api-reference/nimiq-provider",
    tags: ["accept nim", "payments", "send", "transaction", "build"],
  },
  {
    id: "eth-provider",
    title: "Ethereum provider basics",
    body: "Use window.ethereum (EIP-1193): eth_requestAccounts, personal_sign, eth_sendTransaction, wallet_switchEthereumChain. USDT on Polygon: chainId 0x89, contract 0xc2132D05D31c914a87C6611C10748AEb04B58e8F, 6 decimals. Users need native gas (POL on Polygon).",
    sourceUrl: "https://nimiq.dev/mini-apps/features/evm-tokens",
    tags: ["ethereum", "usdt", "polygon", "evm", "build", "payments"],
    lastVerified: "2026-09-01",
  },
  {
    id: "testing",
    title: "Test inside Nimiq Pay",
    body: "Run dev server with --host, open Nimiq Pay on the same WiFi, go to Mini Apps, enter http://<your-ip>:5173 in Custom URL. Testnet: open app menu, long-press settings 10 seconds, switch to Testnet, tap Get free NIM (drip amount varies — check Nimiq docs for current value, do not rely on a remembered number).",
    sourceUrl: "https://nimiq.dev/mini-apps/development/load-local-mini-app",
    tags: ["test", "testnet", "debug", "connect", "build", "error"],
    lastVerified: "2026-09-01",
  },
  {
    id: "no-balance-api",
    title: "No balance method in the provider",
    body: "The injected Nimiq provider has no balance readout and no transaction history. Nimglyde reads balances through backend Nimiq JSON-RPC for addresses the user already shared via the account request, and says so when data cannot be verified.",
    sourceUrl: "https://nimiq.dev/mini-apps/api-reference/nimiq-provider",
    tags: ["balance", "wallet", "transaction", "build"],
  },
  {
    id: "errors",
    title: "Handle provider errors",
    body: "User rejection surfaces as PermissionDeniedError (Nimiq) or EIP-1193 errors including 4902 for unconfigured chains. Treat cancellation as a normal outcome with a clear message, never a freeze.",
    sourceUrl: "https://nimiq.dev/mini-apps/faq",
    tags: ["error", "debug", "build", "connect"],
  },
  {
    id: "secrets",
    title: "Keep API keys server-side",
    body: "Anything in the frontend bundle is visible to anyone. Never embed private API keys or signing secrets in client code. Route third-party calls needing secrets through your own backend.",
    sourceUrl: "https://nimiq.dev/mini-apps/faq",
    tags: ["security", "keys", "backend", "build"],
  },
  {
    id: "competition-rules",
    title: "Competition submission rules",
    body: "One submission per team per cycle, public GitHub under MIT, must integrate USDT or NIM as core UX, fully functional day one, max 250-word description, demo video encouraged. Winners scored on functionality (45), integration (25), real usage (15), design (10), promotion (5).",
    sourceUrl: "https://miniappscompetition.com/rules",
    tags: ["competition", "rules", "scoring", "submit", "build"],
  },
  {
    id: "send-nim-howto",
    title: "How to send NIM",
    body: "In Nimiq Pay open your wallet, choose Send, paste the recipient Nimiq address (starts with NQ), enter the NIM amount, confirm in the native dialog. Inside a Mini App, the app prepares a basic payment and Nimiq Pay asks you to confirm - the app can never move funds alone.",
    sourceUrl: "https://nimiq.dev/mini-apps/api-reference/nimiq-provider",
    tags: ["send", "payments", "wallet", "transfer"],
  },
  {
    id: "staking",
    title: "Stake NIM from a Mini App",
    body: "From a Mini App, staking means guiding the user to delegate to a validator first, then offering ways to add to the stake, change its settings, or retire and remove it later. All amounts are counted in Luna and every step asks the user to confirm in Nimiq Pay. The exact staking calls live in the official provider reference.",
    sourceUrl: "https://nimiq.dev/mini-apps/api-reference/nimiq-provider",
    tags: ["stake", "staking", "validator", "rewards", "build"],
  },
  {
    id: "share-miniapp",
    title: "Share a Mini App with a deeplink",
    body: "Two formats open an app directly in Nimiq Pay: nimiqpay://miniapp?url=your-app.com and https://nimpay.app/miniapps/open/your-app.com. Unknown URLs show a warning first.",
    sourceUrl: "https://nimiq.dev/mini-apps",
    tags: ["share", "deeplink", "open", "build", "explore"],
  },
  {
    id: "localization",
    title: "Match the user's Nimiq Pay language",
    body: "Read window.nimiqPay.language (ISO 639-1 code like en, de, es) instead of navigator.language so the app matches the Nimiq Pay setting. Fall back to device locale, then English. It is undefined outside Nimiq Pay, so use optional chaining.",
    sourceUrl: "https://nimiq.dev/mini-apps/features/localization",
    tags: ["language", "localization", "build"],
  },
  {
    id: "device-id",
    title: "Per-device identifier for trials and leaderboards",
    body: "Call requestDeviceIdentifier({ reason }) from @nimiq/mini-app-sdk. Returns a 64-char hex string scoped to your app origin. First call prompts with your reason, later calls resolve silently. Identifies the device, not the user - never use it for authentication.",
    sourceUrl: "https://nimiq.dev/mini-apps/features/device-identifier",
    tags: ["device", "trial", "leaderboard", "build"],
  },
  {
    id: "usdt-chains",
    title: "USDT contract addresses per chain",
    body: "Polygon 0x89: 0xc2132D05D31c914a87C6611C10748AEb04B58e8F (6 decimals). Ethereum 0x1: 0xdAC17F958D2ee523a2206206994597C13D831ec7. Arbitrum 0xa4b1: 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9. Optimism 0xa: 0x94b008aA00579c1307B0EF2c499aD98a8ce58e58. Always verify contract addresses on the official explorer before sending; addresses above last verified 2026-09-01.",
    sourceUrl: "https://nimiq.dev/mini-apps/features/evm-tokens",
    tags: ["usdt", "payments", "polygon", "ethereum", "build"],
    lastVerified: "2026-09-01",
  },
  {
    id: "evm-gas",
    title: "EVM gas in Mini Apps uses standard rules",
    body: "ERC-20 transfers through window.ethereum need the chain's native token for gas: POL on Polygon, ETH on Ethereum and Arbitrum. With no native balance the transaction fails - unlike native Nimiq Pay sends with gas abstraction.",
    sourceUrl: "https://nimiq.dev/mini-apps/features/evm-tokens",
    tags: ["gas", "payments", "ethereum", "usdt", "build", "error"],
    lastVerified: "2026-09-01",
  },
  {
    id: "scoring",
    title: "Competition scoring breakdown",
    body: "100 points: functionality/reliability/usefulness 45, Nimiq Pay and Nimiq integration 25 (using NIM beyond payment earns 5 inside this), real usage 15, design and UX 10, builder promotion checklist 5. Judged by the Nimiq Community Council; build-and-forget scores lower.",
    sourceUrl: "https://miniappscompetition.com/scoring",
    tags: ["competition", "scoring", "rules"],
  },
  {
    id: "payout",
    title: "Prize payout in 3 installments",
    body: "Prizes paid in USDT on Polygon in 3 equal monthly parts. Month 1: app live + terms accepted. Month 2 (+30d): still live, bugs fixed, feedback answered. Month 3 (+60d): still live, one meaningful update, short status summary. Miss a milestone, lose that month only.",
    sourceUrl: "https://miniappscompetition.com/payout",
    tags: ["competition", "payout", "prize", "rules"],
  },
  {
    id: "submit-flow",
    title: "How submissions work",
    body: "Submit on the Submit page: sign in with GitHub, fill the form, and it opens a pull request to the official competition repository - no git needed. Merged entries appear in the showcase. Deadline enforced, no late entries; non-winners may re-enter next cycle with significant improvements.",
    sourceUrl: "https://miniappscompetition.com/faq",
    tags: ["competition", "submit", "rules"],
  },
  {
    id: "any-framework",
    title: "Any frontend framework works",
    body: "Tutorials use Vue, React and Svelte as examples, not requirements. Any stack running in a WebView works, backends and databases allowed, any external API via fetch. AI coding tools explicitly allowed with no restrictions on how code is written.",
    sourceUrl: "https://nimiq.dev/mini-apps/faq",
    tags: ["build", "framework", "backend", "start"],
  },
  {
    id: "what-is-nimiq",
    title: "What Nimiq is",
    body: "Nimiq is a payments-focused layer-1 blockchain designed to be browser-first: the protocol is implemented in Rust and compiled to WebAssembly so the full experience runs on the web. It moved from proof-of-work to proof-of-stake (Albatross), cutting energy use while keeping self-custody for everyone.",
    sourceUrl: "https://www.nimiq.com",
    tags: ["nimiq", "blockchain", "browser", "proof of stake"],
  },
  {
    id: "nim-supply",
    title: "NIM supply and distribution",
    body: "NIM has a fixed final supply of 21 billion over roughly 100 years: 88% goes to block rewards, 5% to crowdfunding contributors, 2.5% to the team, 2% to charity and 2.5% to the foundation. Circulating supply grows as rewards are mined - check a live tracker for the current figure, never trust a remembered number. Last verified 2026-09-01.",
    sourceUrl: "https://nimiq.com/buy-and-sell",
    tags: ["supply", "total", "max", "circulating", "tokenomics", "how many", "distribution"],
  },
  {
    id: "albatross-pos",
    title: "Albatross proof-of-stake",
    body: "Albatross is Nimiq's proof-of-stake consensus: validators produce micro blocks in under a second and vote macro blocks that finalize batches and epochs. Validators are chosen by stake, earn rewards for honest work, and misbehaving validators are punished up to on-chain jailing.",
    sourceUrl: "https://nimiq.com/albatross",
    tags: ["albatross", "proof of stake", "validator", "consensus", "epoch", "staking", "how it works", "blocks"],
  },
  {
    id: "staking-nim",
    title: "Stake NIM",
    body: "Anyone can stake with as little as 100 NIM by delegating to a validator or staking pool - no technical setup needed. Staked funds always stay yours and can be redelegated; pools charge a fee, so compare fees and decentralization. Nimiq offers a staking calculator to estimate rewards.",
    sourceUrl: "https://www.nimiq.com",
    tags: ["stake", "staking", "rewards", "delegate", "pool", "earn", "passive", "interest"],
  },
  {
    id: "buy-nim",
    title: "Buy NIM",
    body: "The simplest route is buying with a card on the official NIM buy page, or on an exchange that lists NIM - then withdraw to your own Nimiq address so you hold the keys. For live prices use a market tracker, and always confirm you are on the official domain before paying.",
    sourceUrl: "https://nimiq.com/buy-and-sell",
    tags: ["buy", "purchase", "exchange", "card", "price", "get nim", "where"],
  },
  {
    id: "wallets-overview",
    title: "Nimiq wallets",
    body: "Nimiq Pay is the mobile wallet and home of Mini Apps: send, receive, stake and open apps. Nimiq Wallet is the web self-custodial wallet for NIM plus BTC and stablecoins. Every Nimiq account is an IBAN-style address starting with NQ.",
    sourceUrl: "https://wallet.nimiq.com",
    tags: ["wallet", "pay", "address", "receive", "download", "app", "account"],
  },
  {
    id: "whitepaper",
    title: "Nimiq whitepaper",
    body: "The Nimiq Whitepaper v2.0 (litepaper) covers the switch to proof-of-stake, the Albatross algorithm, Schnorr signatures and hierarchical key derivation for practically unlimited accounts from one seed.",
    sourceUrl: "https://www.nimiq.com/litepaper",
    tags: ["whitepaper", "litepaper", "paper", "read", "docs"],
  },
  {
    id: "nimiq-x",
    title: "Nimiq on X (Twitter)",
    body: "Nimiq's official X account is @nimiq at https://x.com/nimiq (also https://twitter.com/nimiq). Follow it for announcements, network updates, and Mini Apps Competition news. For community chat use Telegram https://t.me/Nimiq and Discord https://discord.gg/nimiq.",
    sourceUrl: "https://x.com/nimiq",
    tags: ["x", "twitter", "social", "community", "account", "link", "handle", "follow"],
  },
  {
    id: "nimiq-socials",
    title: "Nimiq community and socials",
    body: "Official Nimiq socials: X https://x.com/nimiq, Telegram https://t.me/Nimiq, Discord https://discord.gg/nimiq, GitHub https://github.com/nimiq, Reddit https://www.reddit.com/r/Nimiq. Always verify you are on the official handle @nimiq before trusting announcements.",
    sourceUrl: "https://www.nimiq.com",
    tags: ["social", "community", "discord", "telegram", "github", "reddit", "x", "twitter"],
  },
];

const STOPWORDS = new Set([
  "how", "what", "why", "when", "does", "are", "the", "and", "for", "with",
  "from", "walk", "tell", "give", "options", "option",
]);

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function searchKnowledge(query: string, limit = 4): KnowledgeEntry[] {
  const q = query.toLowerCase();
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const scored = KNOWLEDGE.map((entry) => {
    const title = entry.title.toLowerCase();
    const hay = `${entry.title} ${entry.body} ${entry.tags.join(" ")}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 3; // title match weighs most
      else if (hay.includes(w)) score += 1;
    }
    // Tag match wins ties. Every word of a multi-word tag must appear as a
    // whole word ("connect wallet" matches "connect my wallet", but "build"
    // never matches "rebuild").
    for (const t of entry.tags) {
      const tagWords = t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (tagWords.length > 0 && tagWords.every((tw) => new RegExp(`\\b${escRe(tw)}\\b`).test(q))) {
        score += 4;
      }
    }
    return { entry, score };
  }).filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
}
