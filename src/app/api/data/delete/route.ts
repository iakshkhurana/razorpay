import { json } from "@/lib/api";
import { seedDatabase } from "@/lib/seed";

export const dynamic = "force-dynamic";

/**
 * Delete-my-data for the demo: wipes every table — sessions, mandates,
 * orders, the ledger — and reseeds the demo shop, so nothing personal
 * survives. The client confirms before calling; the reset itself is the
 * deletion (single-tenant demo data).
 */
export async function POST() {
  const { skuCount } = seedDatabase({ quiet: true });
  return json({ ok: true, reset: true, skuCount });
}
