# demo-homeloan-assessment-mcp

A demo MCP server for the Credit Assessment stage of a home loan. It serves seven
tools over one made-up file, Mia Castellano and Dan Okafor's application, at
`/api/mcp`. It is for demos only. Every call reads the same fixture, with the latest
call's answers from [`/api/intake`](#the-intake) in place of the script's where there
are any. Nothing a tool does is written anywhere.

Production: `https://demo-homeloan-assessment-mcp.vercel.app/api/mcp`

## The token

Every request to `/api/mcp` and `/api/intake` needs
`Authorization: Bearer <your-demo-token>`, including `initialize` and `tools/list`.

- The server accepts only the value of `DEMO_MCP_TOKEN`. There is no token in the
  source.
- If `DEMO_MCP_TOKEN` is unset or empty, every request gets `401`.
- A missing or wrong token gets `401` with `WWW-Authenticate: Bearer` and the body
  `{"error":"Unauthorized."}`. No tool names or schemas come back.

The header is what makes xAI's MCP client report the refusal as "Authentication
failed for <url>". Without it, xAI reports every failure as "Failed to connect to MCP
server <url>".

## The tools

| Tool | What it does |
| --- | --- |
| `list_applications` | Lists the files at Credit Assessment, with the visit and how many items each has to check. |
| `get_application` | Reads one file as Credit Assessment sees it. Never shows contact details or the appointment. |
| `check_documents` | Cross-checks what the call stated against the documents on file and lists the open gaps. |
| `indicative_serviceability` | Indicative borrowing figures, worked out from the call's answers, labelled "Indicative, not lender policy". With no answers they are the demo script's. |
| `draft_assessor_notes` | Drafts the assessor's findings and the bot's recommendation, with the same label. |
| `draft_customer_request` | Drafts a text to the customer about the gap. It is never sent from here. |
| `hand_over_to_assessor` | Without `confirm`, returns what the handover would record. With `confirm: true`, returns the handover record. Nothing is stored either way. |

Every tool but `list_applications` takes `applicationId`. The fixture's id is
`app-mia-dan`.

When a reply uses answers from the latest call, it ends with `fromCall`, the intake
keys it used. With no answers stored, every reply is the same as before the intake
existed, byte for byte.

## The intake

The app's server posts what the voice call captured to `/api/intake`. The tools then
use those answers for file `HL-26-104471`, and the script's values for anything the
call didn't capture. Only the latest intake is kept: a new post replaces it, and it
isn't merged.

```bash
curl -X POST https://demo-homeloan-assessment-mcp.vercel.app/api/intake \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"applicationId":"HL-26-104471","capturedAt":"2026-10-12T19:47:00+11:00",
       "fields":{"applicant_1_income":"A$150,000 a year","deposit":"A$200,000"}}'
# {"stored":["applicant_1_income","deposit"]}

curl -X DELETE https://demo-homeloan-assessment-mcp.vercel.app/api/intake \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"applicationId":"HL-26-104471"}'
# {"stored":[]}, and the tools are back to the script's values
```

Every field is optional, a string of at most 200 characters, in the format shown:

| Field | Format |
| --- | --- |
| `applicant_1_name`, `applicant_2_name` | `Mia Castellano`: a first name and a last name |
| `applicant_1_employment`, `applicant_2_employment` | `Physiotherapist, full time, Merri Creek Physiotherapy`: the basis is `full time`, `part time`, `casual` or `self employed` |
| `applicant_1_income`, `applicant_2_income` | `A$112,000 a year`, up to A$2,000,000 |
| `target_area` | `Coburg, VIC` |
| `purchase_price`, `deposit` | `A$950,000`, up to A$20,000,000. The deposit can't be more than the price. |
| `first_home` | `Yes` or `No` |
| `declared_debts` | `None`, or up to 5 of `Credit card, A$8,000 limit, A$240 a month` separated by `; ` |

The borrowing is 4 × the couple's yearly income less 125 × their monthly repayments,
to the nearest A$10,000 and never below 0. It is A$50,000 less with the Afterpay
account on the documents, and they need the price less the deposit. With the
script's answers that gives the script's A$810,000, A$760,000 and A$790,000.

| Request | Answer |
| --- | --- |
| Any `Origin` header, preflights included | `403`. The intake comes from the app's server, never a browser, and no CORS headers are ever sent. |
| More than 30 requests a minute from one address | `429` with `Retry-After` |
| A missing or wrong token | `401`, as for `/api/mcp` |
| Not `Content-Type: application/json`, a body that isn't JSON, another file, an unknown key or a value in the wrong format | `400`, with `issues` naming each field that failed. Values are never repeated back. |
| A body over 4 KB | `413` |
| No store, or the store is down | `503`. The tools use the script's values. |
| `GET`, `PUT`, `PATCH` | `405` |

## Run it locally

Tested on Node 22 with pnpm 10.

```bash
pnpm install
DEMO_MCP_TOKEN='<your-demo-token>' pnpm dev
```

```bash
TOKEN='<your-demo-token>'

# 401, WWW-Authenticate: Bearer, no tool list
curl -i -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# the seven tools, as one SSE "data:" line
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`GET` and `DELETE` get `405`: there are no sessions or streams to resume.

## Deploy on Vercel

1. In Vercel, choose **Add New → Project** and import
   `cursor-demo-lab/demo-homeloan-assessment-mcp`.
2. Name the project `demo-homeloan-assessment-mcp`. Vercel detects Next.js and pnpm;
   keep the default build settings.
3. Add `DEMO_MCP_TOKEN` under **Environment Variables** for Production. Without it,
   every request gets `401`.
4. Under **Storage**, create an **Upstash for Redis** database from the Marketplace
   and connect it to the project. That sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` work too). Without it,
   `/api/intake` gets `503` and the tools use the script's values.
5. Deploy. The server is at
   `https://demo-homeloan-assessment-mcp.vercel.app/api/mcp`.

Keep Deployment Protection at the default, Standard Protection, which leaves the
production domain public. xAI has to reach the server without a Vercel login.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm assessment:check` drives a deployment through xAI's MCP client. It needs
`XAI_API_KEY` and `DEMO_MCP_TOKEN`, the deployment's token.

```bash
XAI_API_KEY=... DEMO_MCP_TOKEN='<your-demo-token>' pnpm assessment:check
XAI_API_KEY=... DEMO_MCP_TOKEN='<your-demo-token>' pnpm assessment:check --url https://<another-host>/api/mcp
```

`--url` must be `https` and reachable from xAI, so a preview behind Vercel's login
won't pass. It checks that xAI lists all seven tools and gets an answer from each one, that the
serviceability figures and the notes carry "Indicative, not lender policy", and that
`hand_over_to_assessor` without `confirm` asks for confirmation. It then connects
with no token and with a random wrong token, and passes only if xAI reports
"Authentication failed" for both. It prints one line per check and exits `1` if any
fail. The xAI key and the token are never printed.

## Use it from xAI

```json
{
  "type": "mcp",
  "server_url": "https://demo-homeloan-assessment-mcp.vercel.app/api/mcp",
  "server_label": "assessment",
  "headers": { "Authorization": "Bearer <your-demo-token>" }
}
```

Send it in `tools` on `POST https://api.x.ai/v1/responses`, with `store: false` so
xAI doesn't keep a response that echoes the header.
