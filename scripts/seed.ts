import { closeDb } from "../src/lib/db";
import { EMBEDDING_MODEL, warmSearch } from "../src/lib/search";
import { seedDatabase } from "../src/lib/seed";

export { seedDatabase, SEED_MERCHANT_NAME } from "../src/lib/seed";

const isDirectRun = process.argv[1] && /seed\.ts$/.test(process.argv[1]);
/** Seeding is where the model first downloads (~23MB), so allow well beyond the request-path budget. */
const SEED_MODEL_TIMEOUT_MS = 180_000;

if (isDirectRun) {
  seedDatabase();
  warmSearch({ loadTimeoutMs: SEED_MODEL_TIMEOUT_MS })
    .then((mode) => {
      console.log(
        mode === "embedding"
          ? `Embeddings: ready (${EMBEDDING_MODEL.replace(/^Xenova\//, "")})`
          : "Embeddings: unavailable, keyword search active",
      );
    })
    .finally(() => {
      closeDb();
      process.exit(0);
    });
}
