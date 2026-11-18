import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import Navigation from "./components/navigation";
import { BrandLogo } from "./components/brand-logo";
import AutoRefresh from "./components/auto-refresh";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dynasteez | Dynasty Football", template: "%s | Dynasteez" },
  description: "The home of Dynasteez, a 10-team dynasty fantasy football league. Standings, matchups, league history, and the long game.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a><Suspense fallback={<header className="site-header"><div className="header-inner"><Link href="/" className="brand"><BrandLogo className="header-logo"/></Link><Link href="/teams">Teams</Link></div></header>}><Navigation /></Suspense><main id="main" className="site-main">{children}</main><footer className="site-footer"><div><strong>DYNASTEEZ</strong><p>Play the long game.</p></div><AutoRefresh/><span>Independent fantasy league · Data from Sleeper</span></footer></body></html>;
}
