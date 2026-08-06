import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Local Supabase Storage (this stack's API port)
      { protocol: "http", hostname: "127.0.0.1", port: "54331" },
      // Hosted Supabase Storage
      { protocol: "https", hostname: "*.supabase.co" },
      // Google Places photos
      { protocol: "https", hostname: "places.googleapis.com" },
    ],
  },
};

export default nextConfig;
