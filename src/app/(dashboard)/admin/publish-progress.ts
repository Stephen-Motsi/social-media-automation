import type { PlatformOutcome } from "@/lib/adverts";
import { publishProgress } from "./actions";

const POLL_MS = 1500;
const GIVE_UP_MS = 60_000;

// After "Post now": waits until every platform has actually posted or failed (the worker does
// the posting). timedOut = still going after a minute, usually because the worker isn't running.
export async function waitUntilPosted(advertId: string): Promise<{ outcomes: PlatformOutcome[]; timedOut: boolean }> {
  const start = Date.now();
  for (;;) {
    const outcomes = await publishProgress(advertId);
    if (!outcomes.some((o) => o.pending)) return { outcomes, timedOut: false };
    if (Date.now() - start > GIVE_UP_MS) return { outcomes, timedOut: true };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export const homeUrl = (advertId: string) => `/?published=${advertId}#${advertId}`;
export const STILL_POSTING = "Still posting after a minute. Check that the worker is running (npm run worker); it posts as soon as it is.";
