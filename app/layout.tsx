import type { Metadata, Viewport } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/ui/AppShell";
import { getSession } from "@/lib/server/session";

// next/font self-hosts Outfit (the reference theme's typeface) at build time, so it is served from our own origin and works offline.
// --font-inter is the one real variable; globals.css aliases --font-grotesk and --font-jbmono to it.
const outfit = Outfit({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Safar Saathi", template: "%s · Safar Saathi" },
  description: "Help after you pay. Changes only when you confirm. Works offline. A prototype travel companion with sample data.",
  applicationName: "Safar Saathi",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Safar Saathi", statusBarStyle: "black-translucent" },
  icons: { icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
};
export const viewport: Viewport = { themeColor: "#050505", width: "device-width", initialScale: 1, viewportFit: "cover" };

const themeInit = `try{var t=localStorage.getItem('ss-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = !!(await getSession().catch(() => null));
  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-dvh">
        <AppShell signedIn={signedIn}>{children}</AppShell>
      </body>
    </html>
  );
}
