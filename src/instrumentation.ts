/**
 * Runs once when the Node server boots. A fresh database (first run, or a
 * serverless cold start on a temp filesystem) gets the demo shop so every
 * route has something to show.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureDemoShop } = await import("./lib/seed");
  try {
    if (ensureDemoShop()) console.log("[agentgate] fresh database — seeded the demo shop");
  } catch (err) {
    console.warn("[agentgate] could not seed the demo shop:", err instanceof Error ? err.message : err);
  }
}
