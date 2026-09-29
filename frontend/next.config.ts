import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` here -- Next.js explicitly doesn't support
  // running `next start` (what Render's native Node runtime, and the
  // Dockerfile, both use) against a standalone build. Standalone mode is
  // only for the `node server.js` pattern, which neither deployment path
  // uses anymore.
};

export default nextConfig;
