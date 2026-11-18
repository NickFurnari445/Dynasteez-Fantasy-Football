"use client";
import { BrandLogo } from "./brand-logo";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  ["/", "Overview"], ["/standings", "Standings"], ["/this-week", "This Week"],
  ["/weekly-newsletter", "Weekly Newsletter"], ["/power-rankings", "Power Rankings"], ["/teams", "Teams"], ["/draft", "Draft"],
  ["/manager-history", "Manager History"], ["/hall-of-champions", "Hall of Champions"],
  ["/records", "Records"], ["/history", "League History"], ["/handbook", "League Handbook"],
];

export default function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="header-inner"><Link className="brand" href="/" aria-label="Dynasteez home"><BrandLogo className="header-logo"/></Link><button className="menu-toggle" aria-expanded={open} aria-controls="primary-nav" onClick={()=>setOpen(!open)}>{open ? "Close ✕" : "Menu ☰"}</button><nav id="primary-nav" className={open ? "nav-links is-open" : "nav-links"} aria-label="Main navigation">{links.map(([href,label])=><Link key={href} href={href} aria-current={pathname===href || (href!=="/" && pathname.startsWith(href+"/")) ? "page" : undefined} onClick={()=>setOpen(false)}>{label}</Link>)}</nav></div></header>;
}
