import { Redis } from "@upstash/redis";
import { fitsTheFile } from "./apply";
import type { IntakeFields, StoredIntake } from "./fields";
import { INTAKE_FILE, storedIntake } from "./fields";

/** Where the latest intake lives, and the per-IP request counter for `/api/intake`. */
export interface IntakeStore {
  readonly read: () => Promise<unknown>;
  readonly write: (intake: StoredIntake) => Promise<void>;
  readonly clear: () => Promise<void>;
  /** Counts one request from `ip` and returns how many it has made in the current window. */
  readonly count: (ip: string) => Promise<number>;
}

export const RATE_WINDOW_SECONDS = 60;
export const RATE_LIMIT = 30;
const READ_TIMEOUT_MS = 1000;
const WRITE_TIMEOUT_MS = 2500;
const INTAKE_KEY = `intake:${INTAKE_FILE}`;

export function redisStore(redis: Redis): IntakeStore {
  return {
    read: () => redis.get(INTAKE_KEY),
    write: async (intake) => {
      await redis.set(INTAKE_KEY, intake);
    },
    clear: async () => {
      await redis.del(INTAKE_KEY);
    },
    count: async (ip) => {
      const key = `intake-requests:${ip}`;
      const [, requests] = await redis
        .multi()
        .set(key, 0, { nx: true, ex: RATE_WINDOW_SECONDS })
        .incr(key)
        .exec<[unknown, number]>();
      return requests;
    },
  };
}

/** The first of `names` that's set and not empty, or "". */
const firstSet = (...names: readonly string[]) =>
  names.map((name) => process.env[name] ?? "").find((value) => value !== "") ?? "";

let cached:
  | { readonly url: string; readonly token: string; readonly store: IntakeStore }
  | undefined;

/**
 * The Upstash Redis store the Vercel Marketplace integration connects, under either of the
 * names it sets. Without both a URL and a token there is no store.
 */
export function storeFromEnv(): IntakeStore | undefined {
  const url = firstSet("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
  const token = firstSet("UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN");
  if (url === "" || token === "") {
    return undefined;
  }
  if (cached?.url !== url || cached.token !== token) {
    const redis = new Redis({ url, token, enableTelemetry: false, retry: { retries: 1 } });
    cached = { url, token, store: redisStore(redis) };
  }
  return cached.store;
}

export function withinMs<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`No answer from the store within ${ms}ms.`));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export const withinWriteTime = <T>(work: Promise<T>) => withinMs(work, WRITE_TIMEOUT_MS);

/**
 * The latest call's answers, or none. No store, a slow or failed read, and anything stored
 * that no longer passes the intake checks all mean none, so the tools use the script.
 */
export async function latestAnswers(store?: IntakeStore): Promise<IntakeFields> {
  if (store === undefined) {
    return {};
  }
  try {
    const stored = storedIntake.safeParse(await withinMs(store.read(), READ_TIMEOUT_MS));
    return stored.success && fitsTheFile(stored.data.fields) ? stored.data.fields : {};
  } catch {
    return {};
  }
}
