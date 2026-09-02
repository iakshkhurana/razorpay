import { z } from "zod";
import { error, json, parseBody, rateLimit } from "@/lib/api";
import { isLiveAttackId, liveAttacks, runLiveAttack } from "@/lib/redteam/live";

export const dynamic = "force-dynamic";

/**
 * Fire one of the red team's attacks at the running shop. GET lists what can be
 * fired; POST runs it and returns the stamped refusals, which land in the live
 * ledger like any other money action. Only the deterministic attacks from the
 * eval corpus are offered, and only by id — this route can never be handed a
 * basket of its own.
 */

const AttackRequestSchema = z.object({ attack_id: z.string().min(1) });

export function GET() {
  return json({ ok: true, attacks: liveAttacks() });
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "attack", 20);
  if (limited) return limited;

  const body = await parseBody(req, AttackRequestSchema);
  if (!body.ok) return body.response;
  if (!isLiveAttackId(body.data.attack_id)) {
    return error("That attack is not one the console can fire. Ask GET /api/agent/attack for the list.", 400);
  }

  const result = await runLiveAttack(body.data.attack_id);
  if (!result) return error("That attack could not be prepared.", 500);
  return json({ ok: true, ...result });
}
