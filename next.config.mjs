/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xenova/transformers"],
  eslint: {
    dirs: ["src", "mcp", "scripts"],
  },
};

export default nextConfig;
