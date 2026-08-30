import { ensureDemoShop } from "./lib/seed";

/**
 * A fresh database (first run, or a serverless cold start on a temp
 * filesystem) gets the demo shop so every route has something to show.
 */
try {
  if (ensureDemoShop()) console.log("[agentgate] fresh database — seeded the demo shop");
} catch (err) {
  console.warn("[agentgate] could not seed the demo shop:", err instanceof Error ? err.message : err);
}
