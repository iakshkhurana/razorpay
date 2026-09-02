/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xenova/transformers"],
  // Serverless bundles only what static analysis can trace; these are read via
  // paths built at runtime, so name them explicitly for the routes that read them.
  outputFileTracingIncludes: {
    "/api/onboard/sample": ["./data/seed/ramesh-catalog.csv"],
    "/api/stats": ["./data/eval-latest.json"],
    "/api/eval/latest": ["./data/eval-latest.json"],
  },
  eslint: {
    dirs: ["src", "mcp", "scripts"],
  },
  // Agents look for a shop's rules at a well-known path before they spend a turn asking.
  async rewrites() {
    return [{ source: "/.well-known/agent-commerce.json", destination: "/api/agent/manifest" }];
  },
};

export default nextConfig;
