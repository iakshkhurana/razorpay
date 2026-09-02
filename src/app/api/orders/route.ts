import { error, json, parseBody } from "@/lib/api";
import { getOrder } from "@/lib/db";
import { ApprovalRequestSchema, OrderStatusSchema } from "@/lib/schemas";
import { paymentsMode } from "@/lib/payments";
import { approvalQueue, orderView, ownerDecision, recentOrders, reconcileOrder } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * GET ?id= for one order (in Razorpay mode an awaiting order is reconciled
 * against the provider first), ?status=PENDING_APPROVAL for the queue,
 * otherwise recent orders.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const order = getOrder(id);
    if (!order) return error("Order not found.", 404);
    if (paymentsMode() === "razorpay" && order.status === "AWAITING_PAYMENT") {
      const reconciled = await reconcileOrder(id);
      if (reconciled) return json({ ok: true, order: orderView(reconciled.order), reconciled: reconciled.changed });
    }
    return json({ ok: true, order: orderView(order) });
  }
  const status = url.searchParams.get("status");
  if (status === "PENDING_APPROVAL") return json({ ok: true, orders: approvalQueue() });
  if (status) {
    const parsed = OrderStatusSchema.safeParse(status);
    if (!parsed.success) return error("Unknown order status.", 400);
    return json({ ok: true, orders: recentOrders(100).filter((o) => o.status === parsed.data) });
  }
  return json({ ok: true, orders: recentOrders(50) });
}

/** The owner's call on a gated order. Both outcomes are written to the book. */
export async function POST(req: Request) {
  const body = await parseBody(req, ApprovalRequestSchema);
  if (!body.ok) return body.response;
  const result = await ownerDecision(body.data.order_id, body.data.decision);
  // A provider outage is retryable (502); a wrong-state order is a conflict (409).
  if (!result.ok) return error(result.error, result.kind === "provider" ? 502 : 409);
  return json({ ok: true, order: orderView(result.order) });
}
