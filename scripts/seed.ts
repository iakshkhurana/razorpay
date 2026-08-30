import fs from "node:fs";
import path from "node:path";
import {
  clearAllTables,
  closeDb,
  getDb,
  replaceCatalog,
  setPolicy,
  upsertMerchant,
} from "../src/lib/db";
import { skusFromCsv } from "../src/lib/catalog";
import { DEFAULT_POLICY } from "../src/lib/schemas";

export const SEED_MERCHANT_NAME = "Ramesh Handlooms";

export function seedDatabase(opts: { quiet?: boolean } = {}): { skuCount: number } {
  const log = opts.quiet ? () => undefined : console.log;
  const csvPath = path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv");
  const csv = fs.readFileSync(csvPath, "utf8");
  const skus = skusFromCsv(csv);
  if (skus.length === 0) {
    throw new Error(`No SKUs parsed from ${csvPath}`);
  }

  getDb();
  clearAllTables();
  upsertMerchant({ name: SEED_MERCHANT_NAME, source_url: null, live: true });
  replaceCatalog(skus);
  setPolicy(DEFAULT_POLICY);

  log(`Seeded ${skus.length} SKUs for ${SEED_MERCHANT_NAME}.`);
  log(`Policy: floor ${DEFAULT_POLICY.price_floor_pct}% · max discount ${DEFAULT_POLICY.max_discount_pct}% · gate above ₹${DEFAULT_POLICY.gate_above_paise / 100}`);
  return { skuCount: skus.length };
}

const isDirectRun = process.argv[1] && /seed\.ts$/.test(process.argv[1]);
if (isDirectRun) {
  seedDatabase();
  closeDb();
}
