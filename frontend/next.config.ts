import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal .next/standalone server bundle so the production
  // Docker image (see Dockerfile) doesn't need to ship node_modules.
  output: "standalone",
};

export default nextConfig;
