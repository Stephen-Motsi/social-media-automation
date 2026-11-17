// Usage: npm run login:report [-- --last N]
// Summarises logs/login-trace.jsonl: per-step timings and the slowest recent sign-in attempts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Entry = { at: string; step: string; ms: number; [k: string]: unknown };
const file = path.join(process.cwd(), "logs", "login-trace.jsonl");
if (!existsSync(file)) {
  console.log("No trace yet. Start `npm run dev`, try signing in, then run this again.");
  process.exit(0);
}

const lastIdx = process.argv.indexOf("--last");
const last = lastIdx > -1 ? Number(process.argv[lastIdx + 1]) || 10 : 10;
const entries: Entry[] = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try { return JSON.parse(l) as Entry; } catch { return null; }
  })
  .filter((e): e is Entry => !!e);

const byStep = new Map<string, number[]>();
for (const e of entries) byStep.set(e.step, [...(byStep.get(e.step) ?? []), e.ms]);

const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`\n${entries.length} trace entries\n`);
console.log("step".padEnd(28), "count".padStart(5), "avg".padStart(7), "p95".padStart(7), "max".padStart(7));
for (const [step, v] of [...byStep].sort((a, b) => Math.max(...b[1]) - Math.max(...a[1]))) {
  const avg = Math.round(v.reduce((s, n) => s + n, 0) / v.length);
  console.log(step.padEnd(28), String(v.length).padStart(5), `${avg}ms`.padStart(7), `${pct(v, 0.95)}ms`.padStart(7), `${Math.max(...v)}ms`.padStart(7));
}

console.log(`\nLast ${last} sign-in attempts:`);
for (const e of entries.filter((x) => x.step === "login.total").slice(-last)) {
  const end = new Date(e.at).getTime();
  const parts = entries
    .filter((x) => x.step !== "login.total" && new Date(x.at).getTime() <= end && new Date(x.at).getTime() > end - e.ms - 50)
    .map((x) => `${x.step}=${x.ms}ms`)
    .join(" ");
  console.log(`${e.at}  total=${e.ms}ms  ${e.outcome ?? ""}  ${parts}`);
}
