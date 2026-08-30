# AgentGate MCP server

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It gives any MCP-capable agent three tools for shopping from an AgentGate merchant.

**Guarantee:** every tool is a thin proxy over the AgentGate HTTP API, so the merchant's policy engine and the hash-chained ledger are always in the path — the server cannot price, discount or pay on its own.

## Run

The server needs a running AgentGate app to talk to (default `http://localhost:3000`).

```bash
npm run dev          # terminal 1: the app (seeded with Ramesh Handlooms)
npm run mcp          # terminal 2: the MCP server, waits on stdio
```

Point it elsewhere with `AGENTGATE_URL`:

```bash
AGENTGATE_URL=https://agentgate.example.com npm run mcp
```

```powershell
$env:AGENTGATE_URL = "https://agentgate.example.com"; npm run mcp
```

Logs go to stderr; stdout is reserved for the protocol.

## Claude Desktop config

Add this to `claude_desktop_config.json` (use forward slashes on Windows):

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "npx",
      "args": ["tsx", "K:/hacks/razorpay/mcp/server.ts"],
      "env": { "AGENTGATE_URL": "http://localhost:3000" }
    }
  }
}
```

On Windows, Claude Desktop cannot spawn the `npx` shim directly; run it through `cmd`:

```json
{
  "mcpServers": {
    "agentgate": {
      "command": "cmd",
      "args": ["/c", "npx", "tsx", "K:/hacks/razorpay/mcp/server.ts"],
      "env": { "AGENTGATE_URL": "http://localhost:3000" }
    }
  }
}
```

Restart Claude Desktop; the three `agentgate_*` tools appear in its tools list.

## Tools

| Tool | Proxies | Returns |
|---|---|---|
| `agentgate_search` `{ query, k?, mandate_token? }` | `GET /api/agent/discover` | `results[]` with `name`, `sku_id`, `price`, `price_paise`, `sellable`, `category` |
| `agentgate_offer` `{ mandate_token, sku_ids[], qty?, discount_pct? }` | `POST /api/agent/offer` | `offer_id`, `total`, `verdict { decision, reason_code, human_reason, counter? }` |
| `agentgate_checkout` `{ mandate_token, offer_id }` | `POST /api/agent/checkout` | `status`, `payment_url`, `verdict` (a refused checkout comes back as content, not an error) |

Results are pretty-printed JSON text. Network failures and non-2xx answers come back as `isError` content carrying the server's message.

## Example: search → offer → checkout

The buyer needs a signed mandate first. In the demo, mint one from the app:

```bash
curl -s -X POST http://localhost:3000/api/mandate/issue \
  -H "content-type: application/json" \
  -d '{"agent_id":"mcp-buyer","user_ref":"priya@example.com","spend_cap_paise":200000,"category_scope":["handloom","gifts"]}'
# → { "ok": true, "token": "eyJ...", ... }
```

Then, from the MCP client:

1. **Search**
   `agentgate_search { "query": "anniversary gift saree", "k": 5, "mandate_token": "eyJ..." }`
   → `Cotton Handloom Saree` (`sku_...`, ₹1,499, sellable) and `Matching Blouse Piece` (`sku_...`, ₹350, sellable).

2. **Offer**
   `agentgate_offer { "mandate_token": "eyJ...", "sku_ids": ["<saree id>", "<blouse id>"], "qty": 1 }`
   → `offer_id: "off_..."`, `total: "₹1,849"`, `verdict.decision: "ALLOW"`, `reason_code: "OK"`.
   Ask for too much and the verdict says so instead — e.g. a ₹5,000 basket on a ₹2,000 mandate returns `COUNTER` / `SPEND_CAP_EXCEEDED` with `counter.max_total`.

3. **Checkout**
   `agentgate_checkout { "mandate_token": "eyJ...", "offer_id": "off_..." }`
   → `status: "AWAITING_PAYMENT"`, `payment_url: "http://localhost:3000/dev/mock-pay?order=ord_..."`.
   Open the link to pay (mock mode) — the order flips to `PAID` and the ledger on `/dashboard` shows every step.

Every step above — the ALLOW, any COUNTER or DENY, the checkout and the payment — is a line in the merchant's ledger with its reason and policy checks.
