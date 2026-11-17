import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Dev-only timing trace for sign-in. One JSON object per line in logs/login-trace.jsonl.
// Read it with: npm run login:report
const enabled = process.env.NODE_ENV !== "production" || process.env.LOGIN_TRACE === "1";
const file = path.join(process.cwd(), "logs", "login-trace.jsonl");

export function traceLogin(step: string, ms: number, extra: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), step, ms: Math.round(ms), ...extra }) + "\n");
  } catch {
    // Tracing must never break sign-in.
  }
}

export async function timed<T>(step: string, fn: () => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    traceLogin(step, performance.now() - start, extra);
  }
}
