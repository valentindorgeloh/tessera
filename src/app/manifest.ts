import type { MetadataRoute } from "next";

/**
 * Web app manifest: lets Chrome install Tessera as an app and gives Safari's
 * "Add to Dock" its name. The icons are src/app/icon.png (rounded, for tabs
 * and Chrome) and src/app/apple-icon.png (full-bleed, for Safari's Dock app).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tessera",
    short_name: "Tessera",
    description: "Local AI-first work tracker",
    start_url: "/",
    display: "standalone",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
