import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./studio.css";
import { appearanceBootstrap } from "../components/theme-config";
export const metadata: Metadata = {
  title: "Rezeptdatenbank · Dein Platz fürs Kochen",
  description:
    "Die selbst gehostete Plattform für Rezepte und gemeinsames Kochen.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Rezeptdatenbank",
  },
  icons: { icon: "/icon.svg", apple: "/icons/apple.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#141619" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
