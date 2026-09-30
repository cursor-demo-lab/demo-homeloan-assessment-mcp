import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intakeOf, SCRIPTED_ANSWERS, VARIED_ANSWERS } from "@/intake/answers.fixture";
import { fakeStore } from "@/intake/fake-upstash.fixture";
import { INTAKE_KEYS } from "@/intake/fields";
import type { IntakeStore } from "@/intake/store";
import { latestAnswers, RATE_LIMIT, storeFromEnv } from "@/intake/store";
import { intakeEndpoint, MAX_BODY_BYTES } from "./endpoint";
import * as route from "./route";

const URL = "http://localhost/api/intake";
const TOKEN = randomBytes(32).toString("hex");
const KEY = "intake:HL-26-104471";
const RESET = { applicationId: "HL-26-104471" };

type Method = "POST" | "DELETE" | "OPTIONS" | "GET" | "PUT" | "PATCH";

let fake: ReturnType<typeof fakeStore>;
let endpoint: ReturnType<typeof intakeEndpoint>;

function send(
  method: Method,
  {
    body,
    headers = {},
    token = TOKEN,
    ip = "203.0.113.7",
  }: {
    body?: unknown;
    headers?: Record<string, string>;
    token?: string | null;
    ip?: string;
  } = {},
): Promise<Response> {
  const text = body === undefined || typeof body === "string" ? body : JSON.stringify(body);
  return endpoint[method](
    new Request(URL, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-real-ip": ip,
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      ...(text === undefined ? {} : { body: text }),
    }),
  );
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const stored = () => fake.upstash.values.get(KEY)?.value;

const statusOf = async (response: Promise<Response>) => {
  const { status } = await response;
  return status;
};

const refusal = async (body: unknown, headers?: Record<string, string>) =>
  read(await send("POST", { body, ...(headers && { headers }) }));

const many = (count: number, make: () => Promise<Response>) =>
  Promise.all(Array.from({ length: count }, () => statusOf(make())));

const flipLast = (token: string) => `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`;

const forwardedPost = () =>
  endpoint.POST(
    new Request(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
        "x-forwarded-for": "192.0.2.1, 10.0.0.1",
      },
      body: JSON.stringify(intakeOf({})),
    }),
  );

beforeEach(() => {
  vi.stubEnv("DEMO_MCP_TOKEN", TOKEN);
  fake = fakeStore();
  endpoint = intakeEndpoint(() => fake.store);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/intake", () => {
  it("stores the latest call's answers and lists the keys, in the app's order", async () => {
    const response = await send("POST", { body: intakeOf(SCRIPTED_ANSWERS) });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(read(response)).resolves.toStrictEqual({
      status: 200,
      body: { stored: [...INTAKE_KEYS] },
    });
    expect(JSON.parse(String(stored()))).toStrictEqual({
      capturedAt: "2026-10-12T19:47:00+11:00",
      fields: SCRIPTED_ANSWERS,
    });
  });

  it("keeps only the latest intake: a second post replaces the first, it doesn't merge", async () => {
    await send("POST", { body: intakeOf(VARIED_ANSWERS) });
    const { deposit, applicant_1_income: income } = SCRIPTED_ANSWERS;
    await expect(
      read(await send("POST", { body: intakeOf({ deposit, applicant_1_income: income }) })),
    ).resolves.toStrictEqual({ status: 200, body: { stored: ["applicant_1_income", "deposit"] } });
    await expect(latestAnswers(fake.store)).resolves.toStrictEqual({
      applicant_1_income: 112_000,
      deposit: 160_000,
    });
  });

  it("accepts an intake with nothing captured", async () => {
    await expect(read(await send("POST", { body: intakeOf({}) }))).resolves.toStrictEqual({
      status: 200,
      body: { stored: [] },
    });
  });
});

describe("DELETE /api/intake", () => {
  it("resets to the script's values", async () => {
    await send("POST", { body: intakeOf(VARIED_ANSWERS) });
    await expect(read(await send("DELETE", { body: RESET }))).resolves.toStrictEqual({
      status: 200,
      body: { stored: [] },
    });
    expect(stored()).toBeUndefined();
    await expect(latestAnswers(fake.store)).resolves.toStrictEqual({});
  });

  it.each([
    ["no body", undefined],
    ["another file", { applicationId: "HL-26-000000" }],
    ["the fixture's id", { applicationId: "app-mia-dan" }],
    ["more than the file", { ...RESET, fields: {} }],
  ])("refuses %s with 400 and keeps the intake", async (_label, body) => {
    await send("POST", { body: intakeOf(VARIED_ANSWERS) });
    const before = stored();
    await expect(read(await send("DELETE", { body }))).resolves.toMatchObject({ status: 400 });
    expect(stored()).toBe(before);
  });
});

describe("browsers", () => {
  const ORIGINS = [
    "https://example.com",
    "https://demo-homeloan-assessment-mcp.vercel.app",
    "http://localhost:3000",
    "null",
  ];
  const METHODS: readonly Method[] = ["POST", "DELETE", "OPTIONS", "GET", "PUT", "PATCH"];

  it.each(METHODS.flatMap((method) => ORIGINS.map((origin) => [method, origin] as const)))(
    "refuses %s with any Origin (%s), even with the token: 403, no CORS headers, nothing counted",
    async (method, origin) => {
      const response = await send(method, {
        ...(method !== "GET" && { body: method === "DELETE" ? RESET : intakeOf(SCRIPTED_ANSWERS) }),
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization, content-type",
        },
      });
      expect(response.status).toBe(403);
      expect(
        [...response.headers.keys()].filter((name) => name.startsWith("access-control")),
      ).toStrictEqual([]);
      expect(stored()).toBeUndefined();
      expect(fake.upstash.commands).toStrictEqual([]);
    },
  );

  it("answers OPTIONS without an Origin with the methods, and no CORS headers", async () => {
    const response = await send("OPTIONS", { token: null });
    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("POST, DELETE, OPTIONS");
    expect(
      [...response.headers.keys()].filter((name) => name.startsWith("access-control")),
    ).toStrictEqual([]);
  });
});

describe("the token", () => {
  const TOKENS = [
    ["no Authorization header", null],
    ["an empty token", ""],
    ["a wrong token of the same length", flipLast(TOKEN)],
    ["the token with more on the end", `${TOKEN}0`],
  ] as const;

  it.each(
    (["POST", "DELETE"] as const).flatMap((method) =>
      TOKENS.map(([label, token]) => [method, label, token] as const),
    ),
  )(
    "refuses %s with %s: 401, a Bearer challenge, nothing stored",
    async (method, _label, token) => {
      const response = await send(method, {
        body: method === "POST" ? intakeOf(VARIED_ANSWERS) : RESET,
        token,
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      await expect(response.json()).resolves.toStrictEqual({ error: "Unauthorized." });
      expect(stored()).toBeUndefined();
    },
  );

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("refuses every token when DEMO_MCP_TOKEN is %s", async (_label, value) => {
    vi.stubEnv("DEMO_MCP_TOKEN", value);
    await expect(
      read(await send("POST", { body: intakeOf(VARIED_ANSWERS) })),
    ).resolves.toMatchObject({
      status: 401,
    });
    expect(stored()).toBeUndefined();
  });

  it.each(["GET", "PUT", "PATCH"] as const)(
    "answers %s with 405 given the token, and 401 without it",
    async (method) => {
      const allowed = await send(method);
      expect(allowed.status).toBe(405);
      expect(allowed.headers.get("Allow")).toBe("POST, DELETE, OPTIONS");
      await expect(read(await send(method, { token: null }))).resolves.toMatchObject({
        status: 401,
      });
    },
  );
});

describe("the body", () => {
  it("needs JSON", async () => {
    await expect(
      refusal(intakeOf(SCRIPTED_ANSWERS), { "Content-Type": "text/plain" }),
    ).resolves.toMatchObject({
      status: 400,
    });
    await expect(refusal("{not json")).resolves.toMatchObject({ status: 400 });
    await expect(
      refusal(intakeOf(SCRIPTED_ANSWERS), { "Content-Type": "application/json; charset=utf-8" }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it(`refuses more than ${MAX_BODY_BYTES} bytes with 413, whether or not Content-Length says so`, async () => {
    const large = { ...intakeOf({}), padding: "x".repeat(MAX_BODY_BYTES) };
    await expect(refusal(large)).resolves.toMatchObject({ status: 413 });

    const chunk = new TextEncoder().encode("x".repeat(1024));
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 5; index++) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    const response = await endpoint.POST(
      new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: streamed,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(stored()).toBeUndefined();
  });

  it.each([
    ["an unknown top-level key", { ...intakeOf({}), extra: true }, "body"],
    ["an unknown field", intakeOf({ applicant_3_name: "Sam Lee" } as never), "fields"],
    ["another file", { ...intakeOf({}), applicationId: "HL-26-000000" }, "applicationId"],
    ["the fixture's id", { ...intakeOf({}), applicationId: "app-mia-dan" }, "applicationId"],
    ["no capturedAt", { applicationId: "HL-26-104471", fields: {} }, "capturedAt"],
    ["a capturedAt that isn't ISO", { ...intakeOf({}), capturedAt: "last Monday" }, "capturedAt"],
    [
      "no fields",
      { applicationId: "HL-26-104471", capturedAt: "2026-10-12T19:47:00+11:00" },
      "fields",
    ],
    ["a number for a field", intakeOf({ deposit: 160_000 } as never), "fields.deposit"],
    [
      "a field over 200 characters",
      intakeOf({ target_area: `${"A".repeat(200)}, VIC` }),
      "fields.target_area",
    ],
  ])("refuses %s with 400 and says where", async (_label, body, where) => {
    const { status, body: reply } = await refusal(body);
    expect(status).toBe(400);
    expect(reply["error"]).toBe("The body doesn't match the intake contract.");
    expect(reply["issues"]).toContainEqual(
      expect.stringMatching(new RegExp(`^${where.replace(".", String.raw`\.`)}[.:]`, "u")),
    );
  });

  it.each([
    ["applicant_1_income", "112000"],
    ["applicant_1_income", "A$112000 a year"],
    ["applicant_1_income", "A$112,000.00 a year"],
    ["applicant_1_income", "A$112,000"],
    ["applicant_1_income", "A$2,000,001 a year"],
    ["applicant_1_income", "-A$1 a year"],
    ["purchase_price", "A$20,000,001"],
    ["purchase_price", "$950,000"],
    ["purchase_price", "A$ 950,000"],
    ["deposit", "A$0,160,000"],
    ["first_home", "yes"],
    ["first_home", "true"],
    ["applicant_1_name", "Mia"],
    ["applicant_1_name", "Mia  Castellano"],
    ["applicant_1_name", "Mia Castellano1"],
    ["applicant_1_name", `Mia ${"Castellano".repeat(6)}`],
    ["applicant_1_employment", "Physiotherapist, full-time, Merri Creek Physiotherapy"],
    ["applicant_1_employment", "Physiotherapist, contract, Merri Creek Physiotherapy"],
    ["applicant_1_employment", "Physiotherapist, full time"],
    ["applicant_1_employment", "Physiotherapist, full time, Merri Creek, Coburg"],
    ["target_area", "Coburg"],
    ["target_area", "Coburg, Victoria"],
    ["target_area", "Coburg, vic"],
    ["declared_debts", "none"],
    ["declared_debts", ""],
    ["declared_debts", "Credit card, A$8,000 limit"],
    ["declared_debts", "Credit card, A$8,000 limit, A$240 a month, "],
    ["declared_debts", "Credit card, A$5,000,001 limit, A$240 a month"],
    ["declared_debts", "Credit card, A$8,000 limit, A$50,001 a month"],
    ["declared_debts", Array.from({ length: 6 }, () => "Card, A$1 limit, A$1 a month").join("; ")],
  ])("refuses %s as %j", async (key, value) => {
    const { status, body } = await refusal(intakeOf({ [key]: value }));
    expect(status).toBe(400);
    expect(body["issues"]).toStrictEqual([
      expect.stringMatching(new RegExp(`^fields\\.${key}: Expected `, "u")),
    ]);
  });

  it("never repeats a refused value back", async () => {
    const sentinel = "Zqxv Sentinel9";
    const fields = Object.fromEntries(INTAKE_KEYS.map((key) => [key, sentinel]));
    const { status, body } = await refusal(intakeOf(fields));
    expect(status).toBe(400);
    expect(body["issues"]).toHaveLength(INTAKE_KEYS.length);
    expect(JSON.stringify(body)).not.toContain("Sentinel");
  });

  it.each([
    ["with both", { purchase_price: "A$500,000", deposit: "A$600,000" }],
    ["with the script's price", { deposit: "A$950,001" }],
    ["with the script's deposit", { purchase_price: "A$159,999" }],
  ])("refuses a deposit over the price, %s", async (_label, fields) => {
    await expect(refusal(intakeOf(fields))).resolves.toStrictEqual({
      status: 400,
      body: {
        error: "The body doesn't match the intake contract.",
        issues: ["fields.deposit: The deposit can't be more than the purchase price."],
      },
    });
  });

  it("keeps the previous intake when a post is refused", async () => {
    await send("POST", { body: intakeOf(VARIED_ANSWERS) });
    const before = stored();
    await expect(refusal(intakeOf({ deposit: "lots" }))).resolves.toMatchObject({ status: 400 });
    expect(stored()).toBe(before);
  });

  it.each([
    [
      "the edges of every cap",
      {
        applicant_1_income: "A$2,000,000 a year",
        purchase_price: "A$20,000,000",
        deposit: "A$0",
        declared_debts: "Credit card, A$5,000,000 limit, A$50,000 a month",
      },
    ],
    ["no debts", { declared_debts: "None" }],
    [
      "names with hyphens, apostrophes and more than one last name",
      {
        applicant_1_name: "Mary-Jane O'Brien",
        applicant_2_name: "Dan van der Berg",
      },
    ],
    [
      "five debts",
      {
        declared_debts: Array.from(
          { length: 5 },
          (_, index) => `Card ${index + 1}, A$1 limit, A$1 a month`,
        ).join("; "),
      },
    ],
  ])("accepts %s", async (_label, fields) => {
    await expect(refusal(intakeOf(fields))).resolves.toMatchObject({ status: 200 });
  });
});

describe("the rate limit", () => {
  it(`allows ${RATE_LIMIT} requests a minute from one address, then 429 with Retry-After`, async () => {
    await expect(
      many(RATE_LIMIT, () => send("POST", { body: intakeOf({}) })),
    ).resolves.toStrictEqual(Array.from({ length: RATE_LIMIT }, () => 200));
    const limited = await send("POST", { body: intakeOf({}) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    await expect(statusOf(send("DELETE", { body: RESET }))).resolves.toBe(429);
    await expect(statusOf(send("POST", { body: intakeOf({}), ip: "198.51.100.9" }))).resolves.toBe(
      200,
    );

    fake.upstash.now += 60_000;
    await expect(statusOf(send("POST", { body: intakeOf({}) }))).resolves.toBe(200);
  });

  it("counts refused tokens too", async () => {
    await expect(
      many(RATE_LIMIT, () => send("POST", { body: intakeOf({}), token: "wrong" })),
    ).resolves.toStrictEqual(Array.from({ length: RATE_LIMIT }, () => 401));
    await expect(statusOf(send("POST", { body: intakeOf({}) }))).resolves.toBe(429);
  });

  it("uses the first X-Forwarded-For address when X-Real-IP is missing", async () => {
    await forwardedPost();
    expect(fake.upstash.values.has("intake-requests:192.0.2.1")).toBe(true);
  });
});

describe("the store", () => {
  it("answers 503 when no store is configured, after the token and body checks", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    endpoint = intakeEndpoint(storeFromEnv);
    await expect(
      read(await send("POST", { body: intakeOf(VARIED_ANSWERS), token: "wrong" })),
    ).resolves.toMatchObject({
      status: 401,
    });
    await expect(
      read(await send("POST", { body: intakeOf({ deposit: "lots" }) })),
    ).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      read(await send("POST", { body: intakeOf(VARIED_ANSWERS) })),
    ).resolves.toStrictEqual({
      status: 503,
      body: { error: "No intake store is configured." },
    });
    await expect(read(await send("DELETE", { body: RESET }))).resolves.toMatchObject({
      status: 503,
    });
  });

  it("answers 503 when the store is down", async () => {
    fake.upstash.failing = true;
    await expect(
      read(await send("POST", { body: intakeOf(VARIED_ANSWERS) })),
    ).resolves.toMatchObject({
      status: 503,
    });
  });

  it("answers 503 when a write fails", async () => {
    const failing: IntakeStore = {
      ...fake.store,
      write: () => Promise.reject(new Error("down")),
      clear: () => Promise.reject(new Error("down")),
    };
    endpoint = intakeEndpoint(() => failing);
    await expect(
      read(await send("POST", { body: intakeOf(VARIED_ANSWERS) })),
    ).resolves.toStrictEqual({
      status: 503,
      body: { error: "The intake store couldn't save that." },
    });
    await expect(read(await send("DELETE", { body: RESET }))).resolves.toMatchObject({
      status: 503,
    });
  });

  it.each([
    ["UPSTASH_REDIS_REST", "The intake store isn't answering."],
    ["KV_REST_API", "The intake store isn't answering."],
    ["UNSET", "No intake store is configured."],
  ])("uses the Upstash store the Vercel integration sets under %s_*", async (prefix, error) => {
    for (const name of ["UPSTASH_REDIS_REST", "KV_REST_API"]) {
      vi.stubEnv(`${name}_URL`, name === prefix ? "http://127.0.0.1:9" : "");
      vi.stubEnv(`${name}_TOKEN`, name === prefix ? "not-a-real-token" : "");
    }
    const response = await route.POST(
      new Request(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(intakeOf({})),
      }),
    );
    await expect(read(response)).resolves.toStrictEqual({ status: 503, body: { error } });
  });
});
