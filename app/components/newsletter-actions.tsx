"use client";

import { useState } from "react";

export function NewsletterActions() {
  const [status, setStatus] = useState("");
  async function copy() {
    const edition = document.getElementById("newsletter-edition");
    if (!edition) return;
    try {
      await navigator.clipboard.writeText(edition.innerText.trim());
      setStatus("Newsletter copied.");
    } catch {
      setStatus("Copy is unavailable in this browser. Select the edition text to copy it.");
    }
  }
  return <div className="newsletter-actions">
    <button className="button secondary" type="button" onClick={copy}>Copy Newsletter</button>
    <button className="button secondary" type="button" onClick={() => window.print()}>Print</button>
    <span role="status">{status}</span>
  </div>;
}
