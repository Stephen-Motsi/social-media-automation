import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // bcryptjs and Prisma run on the Node.js runtime only.
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
