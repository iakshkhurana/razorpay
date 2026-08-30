import fs from "node:fs";
import path from "node:path";
import { error, json } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Ramesh ji's sample catalog, served raw so the onboarding screen can drop it into the CSV box. */
export async function GET() {
  try {
    const file = path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv");
    const csv = fs.readFileSync(file, "utf8");
    return json({ ok: true, csv });
  } catch {
    return error("The sample catalog is missing on this server. Paste a CSV instead.", 500);
  }
}
