import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;
