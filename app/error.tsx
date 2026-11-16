"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <div className="section-page"><div className="eyebrow">DYNASTEEZ LEAGUE HQ</div><h1>Taking a timeout.</h1><p className="section-description">This section could not be loaded. Your league’s navigation is still available.</p><button className="button primary" onClick={reset}>Try again</button></div>;
}
