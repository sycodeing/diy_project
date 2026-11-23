import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/admin/x-account-candidates": ["./assets/account-designs/v1/**/*"],
    "/admin/x-auto-posts-v2": ["./assets/account-designs/v1/**/*"],
  },
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      {
        hostname: "pbs.twimg.com",
        pathname: "/media/**",
        protocol: "https",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4.4mb",
    },
  },
};

export default nextConfig;
