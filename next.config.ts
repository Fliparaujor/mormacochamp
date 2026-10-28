import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

const hasLogo = fs.existsSync(path.join(process.cwd(), "public", "logo-mormaco.png"));

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  env: {
    NEXT_PUBLIC_HAS_LOGO: hasLogo ? "1" : "",
  },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
