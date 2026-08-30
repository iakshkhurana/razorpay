import { z } from "zod";
import { error, json, parseBody } from "@/lib/api";
import { buyerNext, DEMO_GOALS } from "@/lib/llm/buyer";
import { ChatMessageSchema, VerdictEventSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const BuyerTurnSchema = z.object({
  goal_key: z.enum(["gift", "wedding", "failure"]),
  transcript: z.array(ChatMessageSchema).default([]),
  last_events: z.array(VerdictEventSchema).default([]),
  turn: z.number().int().nonnegative().default(0),
  order_placed: z.boolean().default(false),
  user_ref: z.string().min(1).default("priya@example.com"),
});

export async function GET() {
  return json({ ok: true, goals: DEMO_GOALS.map(({ key, label, goal, cap_paise, scope }) => ({ key, label, goal, cap_paise, scope })) });
}

/** The in-app buyer's next line for the simulator. It only talks; the engine bounds it. */
export async function POST(req: Request) {
  const body = await parseBody(req, BuyerTurnSchema);
  if (!body.ok) return body.response;
  const goal = DEMO_GOALS.find((g) => g.key === body.data.goal_key);
  if (!goal) return error("Unknown demo goal.", 404);

  const decision = await buyerNext(
    { goal, transcript: body.data.transcript, last_events: body.data.last_events, turn: body.data.turn, order_placed: body.data.order_placed },
    body.data.user_ref,
  );
  return json({ ok: true, ...decision });
}
