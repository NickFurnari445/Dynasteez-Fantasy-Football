"use client";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

export default function AutoRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => { if (!document.hidden) startTransition(() => router.refresh()); };
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return <span className="refresh-status" role="status">{pending ? "Refreshing league data…" : "Auto-refreshes every minute"}</span>;
}
