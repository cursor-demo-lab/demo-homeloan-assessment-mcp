import type { Requester, UpstashRequest, UpstashResponse } from "@upstash/redis";
import { Redis } from "@upstash/redis";
import type { IntakeStore } from "./store";
import { redisStore } from "./store";

type Command = readonly [string, ...unknown[]];

/**
 * Upstash's REST protocol over a Map, with just the commands the store sends. `now` drives
 * expiry, and `failing` makes every request throw, as a store that's down would.
 */
export class FakeUpstash implements Requester {
  readonly values = new Map<string, { value: unknown; expiresAt: number }>();
  readonly commands: Command[] = [];
  failing = false;
  now = 0;

  request<TResult>(request: UpstashRequest): Promise<UpstashResponse<TResult>> {
    if (this.failing) {
      return Promise.reject(new Error("The fake store is down."));
    }
    const batched = request.path?.[0] === "pipeline" || request.path?.[0] === "multi-exec";
    const results = batched
      ? (request.body as Command[]).map((command) => ({ result: this.run(command) }))
      : { result: this.run(request.body as Command) };
    return Promise.resolve(results as UpstashResponse<TResult>);
  }

  private live(key: string) {
    const entry = this.values.get(key);
    return entry && entry.expiresAt > this.now ? entry : undefined;
  }

  private run(command: Command): unknown {
    this.commands.push(command);
    const [name, key, ...rest] = command;
    const id = String(key);
    switch (name.toLowerCase()) {
      case "get": {
        return this.live(id)?.value ?? null;
      }
      case "set": {
        const [value, ...options] = rest;
        if (options.includes("nx") && this.live(id)) {
          return null;
        }
        const ex = options.indexOf("ex");
        const expiresAt = ex === -1 ? Infinity : this.now + Number(options[ex + 1]) * 1000;
        this.values.set(id, { value, expiresAt });
        return "OK";
      }
      case "del": {
        return this.values.delete(id) ? 1 : 0;
      }
      case "incr": {
        const entry = this.live(id) ?? { value: 0, expiresAt: Infinity };
        const value = Number(entry.value) + 1;
        this.values.set(id, { value, expiresAt: entry.expiresAt });
        return value;
      }
      default: {
        throw new Error(`The fake store doesn't know ${name}.`);
      }
    }
  }
}

export function fakeStore(): { upstash: FakeUpstash; store: IntakeStore } {
  const upstash = new FakeUpstash();
  return { upstash, store: redisStore(new Redis(upstash)) };
}
