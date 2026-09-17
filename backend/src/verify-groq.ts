// One-off check: verifies each Groq key and the configured model.
// Run: npm run verify-groq. Prints key validity (last 4 chars only,
// never full keys) plus the live model list straight from Groq.
import "dotenv/config";
import { config } from "./lib/config.js";

console.log(`Keys configured: ${config.groqKeys.length}`);
console.log(`Configured model: ${config.groqModel}\n`);

let workingKey: string | null = null;

for (let i = 0; i < config.groqKeys.length; i++) {
  const key = config.groqKeys[i];
  const label = `key${i + 1} (...${key.slice(-4)})`;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id: string }[] };
      const ids = (json.data || []).map((m) => m.id);
      console.log(`${label}: VALID - ${ids.length} models available`);
      for (const id of ids) console.log(`   - ${id}`);
      workingKey ||= key;
    } else {
      console.log(`${label}: HTTP ${res.status} - ${(await res.text()).slice(0, 160)}`);
    }
  } catch (err) {
    console.log(`${label}: network error - ${err instanceof Error ? err.message : err}`);
  }
}

if (!workingKey) {
  console.log("\nNo working key - fix keys before using Groq.");
  process.exit(1);
}

// Live chat test against the configured model. OSS models spend tokens on
// hidden reasoning first, so this uses a generous token budget.
console.log(`\nTesting chat completion with ${config.groqModel}...`);
const chat = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${workingKey}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: config.groqModel,
    messages: [{ role: "user", content: "Reply with exactly: Nimglyde online" }],
    max_tokens: 300,
  }),
  signal: AbortSignal.timeout(30_000),
});
if (chat.ok) {
  const json = (await chat.json()) as { choices?: { message?: { content?: string } }[] };
  console.log(`Model WORKS - reply: ${json.choices?.[0]?.message?.content?.trim()}`);
} else {
  console.log(`Model FAILED - HTTP ${chat.status}: ${(await chat.text()).slice(0, 300)}`);
  process.exit(1);
}
