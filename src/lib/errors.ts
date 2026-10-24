import { Prisma } from "@prisma/client";

// Turns infrastructure failures into a reason an admin can act on.
export function reasonFor(err: unknown): string {
  if (err instanceof Prisma.PrismaClientInitializationError || (err instanceof Prisma.PrismaClientKnownRequestError && /^P10/.test(err.code))) {
    return "the database isn't reachable. Start it (docker compose up -d) and try again.";
  }
  if (err instanceof QueueUnavailable) return err.message;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return "a service didn't answer in time (Meta, X, TikTok or OpenAI). Try again in a minute.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/.test(msg)) return `a service isn't reachable (${msg}).`;
  return msg;
}

export class QueueUnavailable extends Error {
  constructor() {
    super("the job queue (Redis) isn't reachable. Start it (docker compose up -d); the worker sends anything due once it's back.");
  }
}

// Gives up on a call that would otherwise wait forever (e.g. Redis being down).
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(onTimeout()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: process.env.APP_TIMEZONE ?? "Africa/Nairobi",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatWhen = (d: Date) => when.format(d);
