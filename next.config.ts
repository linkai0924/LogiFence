import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "ws"],
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
