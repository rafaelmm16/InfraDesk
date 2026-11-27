import type { NextConfig } from "next";

const isPages = process.env.GITHUB_PAGES === "true";
const repoBase = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

const backendTarget = (
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3333"
).replace(/\/$/, "");

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      ...(repoBase ? { basePath: repoBase } : {}),
      images: {
        unoptimized: true,
      },
    }
  : {
      output: "standalone",
      async rewrites() {
        return [
          {
            source: "/api/:path*",
            destination: `${backendTarget}/api/:path*`,
          },
          {
            source: "/metrics",
            destination: `${backendTarget}/metrics`,
          },
        ];
      },
    };

export default nextConfig;
