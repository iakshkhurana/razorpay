# AgentGate — Hackathon Playbook

> Stage notes only. The build spec in `CLAUDE.md` is the source of truth; nothing here changes what the product does.

## The one-liner

**AgentGate makes any small merchant safely sellable to AI buyer agents.** Every rupee an agent sells is explained, bounded, gated when it should be, and written down in a ledger the shopkeeper can read.

## Why this matters (30 seconds)

- Buyer agents are coming to Indian commerce. A shopkeeper like Ramesh ji cannot review every negotiation a bot has on his behalf.
- The risk is not that the AI is rude. The risk is that it moves money it should not: below cost, over a buyer's budget, on things the shop never agreed to sell.
- AgentGate puts a deterministic policy engine between every agent and every rupee. The LLM talks; it never decides money.

## The 3-minute demo (run the Grand Tour from `/dashboard?tour=1`)

| Step | What the judges see | What to say |
|---|---|---|
| 1 | Landing: the book writes itself | "This is AgentGate. Watch the book write itself." |
| 2 | Ramesh ji pastes a messy CSV | "Any catalog, any format. Voice works too — in Hinglish." |
| 3 | Drafted rulebook, approved by a human | "AI drafts the rules. The human approves them. Always." |
| 4 | A buyer agent arrives with a ₹2,000 mandate | "The buyer carries a signed mandate: cap, scope, expiry." |
| 5 | Seller upsells a blouse — ₹1,849 | "One upsell, inside every rule. The engine stamped ALLOW." |
| 6 | ALLOW → PAID | "Money moved. The book already explains why." |
| 7 | ₹5,000 try on a ₹2,000 mandate | "Over the cap? COUNTER, not crash. Nobody can lift a buyer's cap — not even the owner." |
| 8 | ₹5,648 order → OWNER'S CALL | "Big order? Ramesh ji decides. The AI never does." |
| 9 | Bank fails the payment | "FAILED → HELD → backup link. Gracefully, and every hop is in the book." |
| 10 | The scorecard | "Not vibes — measured. Zero breaches across forty attacks." |

End card: **Har paisa, likha hua.**

## Judging bar → where we hit it

| Judging criterion | Where it lives |
|---|---|
| Every money action explainable | `human_reason` + `policy_checks[]` on every ledger entry; Shopkeeper view turns each into one Hinglish sentence |
| Bounded | Ten ordered rules in `lib/policy/engine.ts`; counters are exact to the paisa |
| Gated | `HIGH_VALUE_REVIEW` → `PENDING_APPROVAL` → owner approves or rejects, both written down |
| Audit trail | Hash-chained ledger; `verifyChain()` badge; tamper a row and the badge flips |
| One failure handled gracefully | Simulate Failure → HELD → backup link → PAID, with confetti |
| Razorpay rails | `PAYMENTS_MODE=razorpay` uses test-mode Payment Links and verified webhooks; `mock` runs the whole thing offline |

## Questions we expect

**"Isn't this just prompt engineering?"** No. The seller LLM has no tool that moves money without a verdict. Remove the OpenAI key and the demo still runs on a scripted negotiator — the guarantees never depended on the model.

**"What stops the buyer agent from lying?"** Nothing has to. The mandate is signed by us, the nonce is single-use, and every basket is re-priced from the catalog. Prompt injection changes what the seller *says*, never what the engine *decides* — the red team includes four injection scripts.

**"Why can't the owner approve an over-cap order?"** Because the cap belongs to the buyer's principal, not the shop. The engine counters before it gates, so an over-cap order never reaches the approval queue.

**"What happens when the payment fails?"** The order goes to HELD, a fresh payment link is issued automatically, and the dashboard shows the recovery card. Nothing is lost, nothing is double-charged (idempotency key = mandate + offer).

**"Is the eval real?"** Yes, and it says so: synthetic sessions with a scripted adversary, printed with a caveat. `npm run eval` reruns it in under two minutes and rewrites the README table.

## Things not to claim on stage

- No market numbers. The uplift figure is against a static keyword store on synthetic intents.
- No "trust score", no WhatsApp, no fine-tuned models. See "What it is not" in the README.

## Pre-demo checklist

- [ ] `npm run demo:reset` (fresh book, Ramesh ji live, embeddings warmed)
- [ ] Wi-Fi off test passes in mock mode
- [ ] Speaker volume up for "Aaj ka summary"
- [ ] Browser: Chrome (Web Speech API), zoom 110% for the projector
- [ ] `/eval` shows a run from today
