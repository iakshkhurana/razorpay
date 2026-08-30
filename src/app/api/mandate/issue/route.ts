import { json, parseBody } from "@/lib/api";
import { issueMandate, mandateToDisplay } from "@/lib/mandate";
import { MandateIssueRequestSchema } from "@/lib/schemas";
import { recordMandateIssued } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/** Demo helper: mints a signed mandate for a buyer agent and registers the agent. */
export async function POST(req: Request) {
  const body = await parseBody(req, MandateIssueRequestSchema);
  if (!body.ok) return body.response;

  const { mandate, token } = issueMandate(body.data);
  const claims = {
    mandate_id: mandate.id,
    agent_id: mandate.agent_id,
    user_ref: mandate.user_ref,
    spend_cap_paise: mandate.spend_cap_paise,
    category_scope: mandate.category_scope,
    exp: mandate.exp,
    nonce: mandate.nonce,
  };
  const entry = recordMandateIssued(claims);

  return json({
    ok: true,
    token,
    mandate: {
      id: mandate.id,
      agent_id: mandate.agent_id,
      user_ref: mandate.user_ref,
      spend_cap_paise: mandate.spend_cap_paise,
      category_scope: mandate.category_scope,
      exp: mandate.exp,
      ...mandateToDisplay(claims),
    },
    ledger_entry_id: entry.id,
  });
}
