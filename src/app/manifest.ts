import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rezeptdatenbank",
    short_name: "Rezepte",
    description: "Dein Platz fürs gemeinsame Kochen",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#141619",
    lang: "de",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
