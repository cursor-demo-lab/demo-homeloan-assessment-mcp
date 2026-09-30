import type { z } from "zod";
import { tokenRefusal } from "@/app/api/mcp/auth";
import { capturedOf, fitsTheFile } from "@/intake/apply";
import { intakeBody, resetBody } from "@/intake/fields";
import type { IntakeStore } from "@/intake/store";
import { RATE_LIMIT, RATE_WINDOW_SECONDS, withinWriteTime } from "@/intake/store";

export const MAX_BODY_BYTES = 4096;
const ALLOW = "POST, DELETE, OPTIONS";
const NO_STORE = { "Cache-Control": "no-store" };

type Handler = (request: Request) => Promise<Response>;

function reply(status: number, body: object, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

const refuse = (
  status: number,
  error: string,
  { issues, headers }: { issues?: readonly string[]; headers?: Record<string, string> } = {},
) => reply(status, { error, ...(issues && { issues }) }, headers);

/** Vercel sets both headers itself, so a caller can't choose its own address. */
function callerIp(request: Request): string {
  const [forwarded = ""] = (request.headers.get("x-forwarded-for") ?? "").split(",");
  return (
    request.headers.get("x-real-ip") ?? (forwarded.trim() === "" ? "unknown" : forwarded.trim())
  );
}

/** Stops reading as soon as the body passes the cap, whatever Content-Length said. */
async function chunksUpToCap(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  chunks: readonly Uint8Array[] = [],
  size = 0,
): Promise<readonly Uint8Array[] | null> {
  const chunk = await reader.read();
  if (chunk.done) {
    return chunks;
  }
  if (size + chunk.value.byteLength > MAX_BODY_BYTES) {
    await reader.cancel();
    return null;
  }
  return chunksUpToCap(reader, [...chunks, chunk.value], size + chunk.value.byteLength);
}

async function cappedText(request: Request): Promise<string | null> {
  const chunks = request.body ? await chunksUpToCap(request.body.getReader()) : [];
  return chunks && new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

type Parsed<S extends z.ZodType> =
  | { readonly ok: true; readonly input: z.input<S>; readonly output: z.output<S> }
  | { readonly ok: false; readonly refusal: Response };

const fail = (refusal: Response) => ({ ok: false, refusal }) as const;

const issuesOf = (error: z.ZodError) =>
  error.issues.map(
    ({ path, message }) => `${path.length > 0 ? path.join(".") : "body"}: ${message}`,
  );

async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<S>> {
  if (!/^application\/json\s*(?:;|$)/iu.test(request.headers.get("content-type") ?? "")) {
    return fail(refuse(400, "Send the body as JSON, with Content-Type: application/json."));
  }
  const tooLarge = refuse(413, `The body can be at most ${MAX_BODY_BYTES} bytes.`);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail(tooLarge);
  }
  let json: unknown;
  try {
    const text = await cappedText(request);
    if (text === null) {
      return fail(tooLarge);
    }
    json = JSON.parse(text);
  } catch {
    return fail(refuse(400, "The body isn't valid JSON."));
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, input: json as z.input<S>, output: parsed.data }
    : fail(
        refuse(400, "The body doesn't match the intake contract.", {
          issues: issuesOf(parsed.error),
        }),
      );
}

const noBrowsers = (request: Request) =>
  request.headers.has("origin")
    ? refuse(403, "The intake is posted from the app's server, never from a browser.")
    : null;

async function save(
  store: IntakeStore | undefined,
  work: (store: IntakeStore) => Promise<void>,
): Promise<Response | null> {
  if (store === undefined) {
    return refuse(503, "No intake store is configured.");
  }
  try {
    await withinWriteTime(work(store));
    return null;
  } catch {
    return refuse(503, "The intake store couldn't save that.");
  }
}

const OPTIONS: Handler = (request) =>
  Promise.resolve(
    noBrowsers(request) ??
      new Response(null, { status: 204, headers: { ...NO_STORE, Allow: ALLOW } }),
  );

/**
 * `/api/intake`, which only the app's own server calls. Every request needs the MCP token and
 * no Origin header: a browser always sends one, so browsers are refused, preflights included.
 */
export function intakeEndpoint(storeOf: () => IntakeStore | undefined) {
  const guarded =
    (handle: (request: Request, store: IntakeStore | undefined) => Promise<Response>): Handler =>
    async (request) => {
      const browser = noBrowsers(request);
      if (browser) {
        return browser;
      }
      const store = storeOf();
      if (store) {
        let requests: number;
        try {
          requests = await withinWriteTime(store.count(callerIp(request)));
        } catch {
          return refuse(503, "The intake store isn't answering.");
        }
        if (requests > RATE_LIMIT) {
          return refuse(429, `At most ${RATE_LIMIT} intake requests a minute.`, {
            headers: { "Retry-After": String(RATE_WINDOW_SECONDS) },
          });
        }
      }
      return tokenRefusal(request) ?? (await handle(request, store));
    };

  const POST = guarded(async (request, store) => {
    const body = await parseBody(request, intakeBody);
    if (!body.ok) {
      return body.refusal;
    }
    if (!fitsTheFile(body.output.fields)) {
      return refuse(400, "The body doesn't match the intake contract.", {
        issues: ["fields.deposit: The deposit can't be more than the purchase price."],
      });
    }
    const { capturedAt, fields } = body.input;
    return (
      (await save(store, (saving) => saving.write({ capturedAt, fields }))) ??
      reply(200, { stored: capturedOf(body.output.fields) })
    );
  });

  const DELETE = guarded(async (request, store) => {
    const body = await parseBody(request, resetBody);
    if (!body.ok) {
      return body.refusal;
    }
    return (await save(store, (saving) => saving.clear())) ?? reply(200, { stored: [] });
  });

  const notAllowed = guarded(() =>
    Promise.resolve(refuse(405, "Use POST or DELETE.", { headers: { Allow: ALLOW } })),
  );

  return { POST, DELETE, OPTIONS, GET: notAllowed, PUT: notAllowed, PATCH: notAllowed };
}
