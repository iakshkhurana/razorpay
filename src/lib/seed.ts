import fs from "node:fs";
import path from "node:path";
import { skusFromCsv } from "./catalog";
import { clearAllTables, getDb, getMerchant, replaceCatalog, setPolicy, upsertMerchant } from "./db";
import { DEFAULT_POLICY, type Sku } from "./schemas";
import { recordShopLive } from "./storefront";

export const SEED_MERCHANT_NAME = "Ramesh Handlooms";

/** Embedded copy so a serverless cold start can seed without the data directory. */
const SEED_CSV = `name,description,price_inr,stock,category,tags
Cotton Handloom Saree,Soft daily-wear handloom saree in pastel shades,1499,15,handloom,"saree,cotton,gift,daily"
Matching Blouse Piece,Unstitched blouse fabric matched to our sarees,350,40,handloom,"blouse,addon,matching"
Phulkari Dupatta,Hand-embroidered Patiala phulkari dupatta,1299,12,handloom,"dupatta,phulkari,wedding,gift"
Banarasi Silk Saree,Rich zari-work Banarasi silk for occasions,4999,6,handloom,"saree,silk,banarasi,wedding"
Zari Border Saree,Elegant saree with golden zari border,2799,9,handloom,"saree,zari,festive,gift"
Handwoven Stole,Light handwoven stole in earthy tones,649,20,handloom,"stole,gift,winter"
Brass Diya Gift Set,Set of 4 engraved brass diyas in gift box,499,25,gifts,"diya,brass,festive,gift"
Punjabi Jutti Gold,Hand-crafted golden jutti with embroidery,899,10,footwear,"jutti,ethnic,wedding"
`;

export function seedSkus(): Sku[] {
  const file = path.join(process.cwd(), "data", "seed", "ramesh-catalog.csv");
  try {
    const parsed = skusFromCsv(fs.readFileSync(file, "utf8"));
    if (parsed.length > 0) return parsed;
  } catch {
    /* fall through to the embedded copy */
  }
  return skusFromCsv(SEED_CSV);
}

/** Wipes every table and loads the demo shop with the default policy. */
export function seedDatabase(opts: { quiet?: boolean } = {}): { skuCount: number } {
  const log = opts.quiet ? () => undefined : console.log;
  const skus = seedSkus();
  if (skus.length === 0) throw new Error("Seed catalog is empty.");

  getDb();
  clearAllTables();
  upsertMerchant({ name: SEED_MERCHANT_NAME, source_url: null, live: true });
  replaceCatalog(skus);
  setPolicy(DEFAULT_POLICY);
  recordShopLive(SEED_MERCHANT_NAME, skus.length);

  log(`Seeded ${skus.length} SKUs for ${SEED_MERCHANT_NAME}; the book opens with the shop-live entry.`);
  log(
    `Policy: floor ${DEFAULT_POLICY.price_floor_pct}% · max discount ${DEFAULT_POLICY.max_discount_pct}% · gate above ₹${DEFAULT_POLICY.gate_above_paise / 100}`,
  );
  return { skuCount: skus.length };
}

/** Seeds only when the database has no merchant yet — a fresh serverless instance, a first run. */
export function ensureDemoShop(): boolean {
  if (getMerchant()) return false;
  seedDatabase({ quiet: true });
  return true;
}
