# HTTP API

All endpoints speak JSON. Errors share one shape:

```json
{ "ok": false, "error": "what happened and the fix" }
```

Validation failures return `422` with zod `issues`; refused mandates return `401` **and** write a DENY entry to the ledger first. Rate‑limited calls return `429` with a `retry-after` header.

## Agent storefront

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent/discover?q=` | Semantic catalog search. Results are ranked and scope‑marked; the public policy rides along so an agent knows the rules before it asks. |
| `POST` | `/api/agent/negotiate` | One buyer message → one seller reply. Body: `{ session_id?, mandate_token, message, lang? }`. Reply carries verdict `events`, the current `offer`, `citations` for grounded answers, and `injection_signals`. Rate limit: 30/min. |
| `POST` | `/api/agent/checkout` | `{ mandate_token, offer_id }` → policy verdict; on ALLOW creates the order + payment link. Idempotency key `mandate_id + offer_id`. |

Every price in a negotiate/checkout response has been through the policy engine; the LLM cannot quote a number the engine did not stamp.

## Merchant & demo

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/onboard` | URL/CSV (+ optional voice utterance) → drafted catalog + policy |
| `POST` | `/api/onboard/vision` | Bill / price‑list photo (multipart `file`, ≤5 MB JPEG/PNG/WebP) → catalog rows as CSV. `501` when no LLM key. |
| `POST` | `/api/policy/confirm` | Merchant approves; shop goes live |
| `POST` | `/api/mandate/issue` | Demo helper: issues a signed mandate JWT |
| `GET` | `/api/ledger?view=tech\|shopkeeper` | The book, raw or as one warm sentence per entry |
| `GET` | `/api/ledger/export` | CSV download of the full chain |
| `GET` | `/api/stats` | KPIs, ledger integrity, latest eval headline, active modes |
| `GET` | `/api/summary?lang=hi\|en` | Two‑sentence spoken day summary |
| `GET` | `/api/metrics` | Per‑request latency, tokens, tools, estimated cost |
| `POST` | `/api/data/delete` | Delete demo data: wipes ledger/orders/mandates, reseeds the sample shop |

## Voice

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/tts` | `{ text, lang, speaker? }` → WAV bytes (Sarvam). `404 { fallback: "browser" }` without a key — the client speaks with browser voices. Rate limit: 120/min. |
| `POST` | `/api/stt` | multipart `file` or raw audio → `{ transcript, language_code }` (Sarvam Saarika). Same browser fallback contract. Rate limit: 45/min. |

## Payments & webhooks

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/webhook/razorpay` | Signature‑verified payment webhook → order state machine |
| `POST` | `/api/dev/simulate-webhook` | Mock‑mode bank: success/failure buttons post here |

Dev‑only routes (`/api/eval/run`, `/api/dev/*`) refuse to run in production builds.
