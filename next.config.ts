import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // bcryptjs and Prisma run on the Node.js runtime only.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Hostnames allowed to load the dev server (e.g. a Cloudflare tunnel), comma-separated.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").filter(Boolean),
};

export default nextConfig;
