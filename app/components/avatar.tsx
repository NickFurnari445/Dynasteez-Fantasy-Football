"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export function Avatar({ sources = [], className = "team-avatar", size = 34, fallback = null }: {
  sources?: string[]; className?: string; size?: number; fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = sources.find(url => !failed.includes(url));
  if (!source) return fallback;
  // External images can fail independently; try the next reported source.
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={source} className={className} src={source} alt="" width={size} height={size} loading="lazy"
    onError={() => setFailed(previous => [...previous, source])}/>;
}
