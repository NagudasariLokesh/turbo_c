import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Single-web-service deployment: the backend (FastAPI) serves this build
  // directly as static files, so there's no Node server involved in
  // production at all -- not `next start`, not `node server.js`. The app
  // qualifies for static export because every component is a Client
  // Component (no Server Components, no Route Handlers, no next/image, no
  // cookies/redirects) -- see Next's static-exports docs for the exact
  // feature list this would break if that ever changed.
  output: "export",
};

export default nextConfig;
