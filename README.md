# demo-homeloan-assessment-mcp

A demo MCP server for the Credit Assessment stage of a home loan. It serves seven
tools over one made-up file, Mia Castellano and Dan Harlow's application, at
`/api/mcp`. It is for demos only. It keeps no state: every call reads the same
fixture, and nothing a tool does is written anywhere.

Production: `https://demo-homeloan-assessment-mcp.vercel.app/api/mcp`

## The token

Every request needs `Authorization: Bearer <token>`, including `initialize` and
`tools/list`.

- The token is `DEMO_ONLY_TOKEN` in `src/app/api/mcp/auth.ts`, a random 32-byte hex
  value. It is in the source on purpose and guards nothing but demo data.
- Set `DEMO_MCP_TOKEN` to use a different token. The server then accepts that value
  and refuses the hardcoded one. An empty `DEMO_MCP_TOKEN` counts as unset.
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
| `indicative_serviceability` | The demo script's borrowing figures, labelled "Indicative, not lender policy". Nothing is calculated. |
| `draft_assessor_notes` | Drafts the assessor's findings and the bot's recommendation, with the same label. |
| `draft_customer_request` | Drafts a text to the customer about the gap. It is never sent from here. |
| `hand_over_to_assessor` | Without `confirm`, returns what the handover would record. With `confirm: true`, returns the handover record. Nothing is stored either way. |

Every tool but `list_applications` takes `applicationId`. The fixture's id is
`app-mia-dan`.

## Run it locally

Tested on Node 22 with pnpm 10.

```bash
pnpm install
pnpm dev
```

```bash
TOKEN=2381f05ddc3a010030d70c6b310510cab10ba23953da044b9ee39758b203ea82

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
3. Optionally, add `DEMO_MCP_TOKEN` under **Environment Variables** for Production.
   Leave it out to use the hardcoded demo token.
4. Deploy. The server is at
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
`XAI_API_KEY`, and uses `DEMO_MCP_TOKEN` if set, else the demo token.

```bash
XAI_API_KEY=... pnpm assessment:check
XAI_API_KEY=... pnpm assessment:check --url https://<another-host>/api/mcp
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
  "headers": { "Authorization": "Bearer <token>" }
}
```

Send it in `tools` on `POST https://api.x.ai/v1/responses`, with `store: false` so
xAI doesn't keep a response that echoes the header.
