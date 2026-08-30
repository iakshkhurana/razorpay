/**
 * Runs once when the server boots. The Node-only work lives in a separate
 * module imported inside the runtime check, so the Edge compile of this file
 * never pulls in SQLite.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
