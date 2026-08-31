# Security model

## What we defend

An AI buyer agent is an untrusted client that speaks natural language. The threats that matter here:

- **Overspend** — pushing an order past the user's cap or the shop's limits.
- **Under‑floor haggling** — talking the seller below the merchant's price floor.
- **Scope escape** — buying categories the mandate or the merchant never allowed.
- **Replay** — reusing a mandate to buy twice.
- **Prompt injection** — "ignore your rules", fake merchant approvals, instructions hidden in product questions, fabricated tool output.

## How the design answers

1. **Deterministic gate.** The policy engine is pure TypeScript — no LLM, no I/O, no clock of its own. The seller LLM can only *propose*; the engine stamps every money action ALLOW / COUNTER / GATE / DENY with reason codes and per‑rule checks. Injection can change the words, never the verdict.
2. **Signed mandates.** HS256 JWTs carry spend cap, category scope, expiry and a single‑use nonce. Bad signature, expiry and replay are each a distinct DENY — written to the ledger before the 401 leaves the server.
3. **Bounded tools.** The seller's tools (`search_catalog`, `get_offer`, `propose_bundle`, `finalize_checkout`, `shop_info`) return engine‑stamped data; prices never come from the model. Grounded shop answers cite their source chunk.
4. **Append‑only evidence.** Every money action — including DENY and payment failures — appends a hash‑chained ledger entry. `verifyChain()` pinpoints the first tampered row; the dashboard shows it in red.
5. **Human gate.** Orders above the merchant's threshold GATE to the owner. Approve and Reject both write ledger entries. The AI never approves its own high‑value order.
6. **Idempotent payments.** `mandate_id + offer_id` keys every payment‑creating call; webhooks are signature‑verified; failures land in `HELD` with a fallback link instead of a retry loop.

## Red team

`npm run eval` replays 40 scripted attacks — overspend, below‑floor, out‑of‑scope, expired mandates, replayed nonces, quantity abuse, and prompt‑injection variants — plus 20 legitimate control sessions. The bar: **0 breaches** (money moved against policy), with catch‑rate by reason code and the false‑block rate reported honestly. The run rewrites the results table in the README from real output only.

## Data & keys

- API keys (`OPENAI_API_KEY`, `RAZORPAY_*`, `SARVAM_API_KEY`, `MANDATE_JWT_SECRET`) live server‑side in `.env` (git‑ignored, `.env.example` documents the shape) and are never logged or echoed.
- The mic is consent‑gated: the first press asks, the choice is remembered locally, and audio is used only for transcription. Denial hides the mic; voice never blocks the money path.
- Agent replies are labeled AI‑generated in the chat.
- **Delete my data**: `POST /api/data/delete` (button on `/metrics`) wipes ledger, orders and mandates and reseeds the sample shop.
- Chat and voice endpoints carry in‑process rate limits (fixed window per client).
- Everything runs on **test rails** — mock money or Razorpay test mode; no real funds move.
