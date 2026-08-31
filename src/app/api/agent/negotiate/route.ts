import { json, parseBody, rateLimit, requireMandate } from "@/lib/api";
import { loadSession, sellerTurn } from "@/lib/llm/seller";
import { beginTurn, endTurn } from "@/lib/metrics";
import { NegotiateRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** One buyer message → one seller reply. Every price inside came through the policy engine. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "chat", 30);
  if (limited) return limited;
  const body = await parseBody(req, NegotiateRequestSchema);
  if (!body.ok) return body.response;

  const mandate = requireMandate(body.data.mandate_token, "negotiate");
  if (!mandate.ok) return mandate.response;

  const session = loadSession(body.data.session_id, mandate.claims.mandate_id);
  beginTurn("negotiate", body.data.lang);
  let result;
  try {
    result = await sellerTurn({ session, mandate: mandate.claims, message: body.data.message, now: mandate.now, lang: body.data.lang });
  } catch (err) {
    endTurn({ ok: false });
    throw err;
  }
  endTurn({ mode: result.mode });

  return json({
    ok: true,
    session_id: result.session.id,
    reply: result.reply,
    events: result.events,
    offer: result.offer,
    order: result.order,
    mode: result.mode,
    upsell_done: result.session.upsell_done,
    injection_signals: result.injection_signals,
    citations: result.citations,
  });
}
