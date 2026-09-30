import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURED_AT, SCRIPTED_ANSWERS } from "./answers.fixture";
import { fakeStore } from "./fake-upstash.fixture";
import type { IntakeStore } from "./store";
import { latestAnswers, RATE_WINDOW_SECONDS } from "./store";

const KEY = "intake:HL-26-104471";

afterEach(() => {
  vi.useRealTimers();
});

describe("the Redis store", () => {
  it("keeps one intake under one key, and deletes it on reset", async () => {
    const { store, upstash } = fakeStore();
    const intake = { capturedAt: CAPTURED_AT, fields: SCRIPTED_ANSWERS };
    await store.write(intake);
    await expect(store.read()).resolves.toStrictEqual(intake);
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
    expect(upstash.commands.map(([name, key]) => [name, key])).toStrictEqual([
      ["set", KEY],
      ["get", KEY],
      ["del", KEY],
      ["get", KEY],
    ]);
  });

  it("counts requests per address in one transaction, in a window that starts with the first", async () => {
    const { store, upstash } = fakeStore();
    await expect(store.count("192.0.2.1")).resolves.toBe(1);
    upstash.now += 59_000;
    await expect(store.count("192.0.2.1")).resolves.toBe(2);
    await expect(store.count("192.0.2.2")).resolves.toBe(1);
    upstash.now += 1000;
    await expect(store.count("192.0.2.1")).resolves.toBe(1);
    expect(upstash.commands.slice(0, 2)).toStrictEqual([
      ["set", "intake-requests:192.0.2.1", 0, "nx", "ex", RATE_WINDOW_SECONDS],
      ["incr", "intake-requests:192.0.2.1"],
    ]);
  });
});

describe("latestAnswers", () => {
  it("parses what the app posted", async () => {
    const { store } = fakeStore();
    await store.write({
      capturedAt: CAPTURED_AT,
      fields: { deposit: "A$200,000", first_home: "No" },
    });
    await expect(latestAnswers(store)).resolves.toStrictEqual({
      deposit: 200_000,
      first_home: false,
    });
  });

  it.each([
    ["nothing stored", null],
    ["something that isn't an intake", "hello"],
    ["an unknown field", { capturedAt: CAPTURED_AT, fields: { applicant_3_name: "Sam Lee" } }],
    ["a bad value", { capturedAt: CAPTURED_AT, fields: { deposit: "A$1,00" } }],
    [
      "a deposit over the script's price",
      { capturedAt: CAPTURED_AT, fields: { deposit: "A$950,001" } },
    ],
  ])("falls back to the script with %s", async (_label, value) => {
    const { store, upstash } = fakeStore();
    upstash.values.set(KEY, { value: JSON.stringify(value), expiresAt: Infinity });
    await expect(latestAnswers(store)).resolves.toStrictEqual({});
  });

  it("falls back to the script when the store is down", async () => {
    const { store, upstash } = fakeStore();
    upstash.failing = true;
    await expect(latestAnswers(store)).resolves.toStrictEqual({});
  });

  it("falls back to the script when the store takes more than a second", async () => {
    vi.useFakeTimers();
    const slow: IntakeStore = { ...fakeStore().store, read: () => Promise.race([]) };
    const answers = latestAnswers(slow);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(answers).resolves.toStrictEqual({});
  });
});
