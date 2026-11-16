"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [["/", "Overview"], ["/teams", "Teams"], ["/history", "League History"], ["/records", "Records"], ["/draft", "Draft"], ["/handbook", "League Handbook"]];

export default function Navigation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return <header className="site-header"><div className="header-inner"><Link className="brand" href="/" aria-label="Dynasteez home"><span className="brand-mark">D<span>★</span></span><span>DYNASTEEZ<small>DYNASTY FOOTBALL</small></span></Link><button className="menu-toggle" aria-expanded={open} aria-controls="primary-nav" onClick={()=>setOpen(!open)}>{open ? "Close ✕" : "Menu ☰"}</button><nav id="primary-nav" className={open ? "nav-links is-open" : "nav-links"} aria-label="Main navigation">{links.map(([href,label])=><Link key={href} href={href} aria-current={pathname===href || (href!=="/" && pathname.startsWith(href+"/")) ? "page" : undefined} onClick={()=>setOpen(false)}>{label}</Link>)}</nav><div className="header-status"><span className="status-dot" /> SLEEPER LEAGUE</div></div></header>;
}
