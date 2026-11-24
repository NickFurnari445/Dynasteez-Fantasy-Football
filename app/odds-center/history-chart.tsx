"use client";

import { useState } from "react";
import { Avatar } from "../components/avatar";
import { americanOdds, probabilityLabel } from "@/lib/odds-math";
import type { OddsSnapshot } from "@/lib/odds-history";
import { marketLabels, type Market } from "@/lib/season-odds";

const chartMarkets: Market[] = ["champion", "playoffs", "finalist", "bye", "regular", "draft", "punishment"];
const colors = ["#6b2dac", "#b8450c", "#007590", "#b32268", "#357b2e", "#544bd1", "#996000", "#9c2121", "#00786b", "#634349"];

export default function HistoryChart({ teams, snapshots, storageAvailable }: {
  teams: { id: number; name: string; avatars?: string[] }[]; snapshots: OddsSnapshot[]; storageAvailable: boolean;
}) {
  const [market, setMarket] = useState<Market>("champion");
  const [hidden, setHidden] = useState<number[]>([]);
  const [active, setActive] = useState<{ team: number; week: number } | null>(null);
  const points = snapshots.filter(snapshot => snapshot.futures.markets[market]);
  const first = points[0]?.week ?? 0;
  const last = points.at(-1)?.week ?? first;
  const x = (week: number) => first === last ? 204 : 43 + (week - first) / (last - first) * 319;
  const y = (p: number) => 192 - p * 170;
  const focus = active && points.find(point => point.week === active.week);
  const value = focus && active ? focus.futures.markets[market]?.[active.team] : undefined;
  const showLabels = points.length > 7 ? points.filter((_, i) => i % Math.ceil(points.length / 6) === 0 || i === points.length - 1) : points;
  return <section className="odds-card odds-history">
    <div className="odds-week-heading"><h2>Probability history</h2>
      <label>Market <select value={market} onChange={event => { setMarket(event.target.value as Market); setActive(null); }}>
        {chartMarkets.map(key => <option key={key} value={key}>{marketLabels[key]}</option>)}
      </select></label>
    </div>
    {points.length === 0 ? <p className="odds-empty">{storageAvailable ? "No recorded snapshots for this market yet." :
      "No recorded odds yet. Configure durable weekly snapshot storage to start the history."}</p> : <>
      <div className="odds-chart-area">
        <svg viewBox="0 0 382 222" role="group" aria-label={marketLabels[market] + " probability by finalized week"}>
          {[0, 0.25, 0.5, 0.75, 1].map(p => <g key={p}><line x1="43" x2="362" y1={y(p)} y2={y(p)} stroke="#e8dfec"/>
            <text x="38" y={y(p) + 4} textAnchor="end">{p * 100}%</text></g>)}
          {showLabels.map(point => <text key={point.week} x={x(point.week)} y="211" textAnchor="middle">W{point.week}</text>)}
          {teams.map((team, i) => {
            if (hidden.includes(team.id)) return null;
            const series = points.flatMap(point => {
              const p = point.futures.markets[market]?.[team.id];
              return p === undefined ? [] : [{ point, p }];
            });
            const color = colors[i % colors.length];
            return <g key={team.id}><polyline points={series.map(({point,p}) => `${x(point.week)},${y(p)}`).join(" ")} fill="none" stroke={color} strokeWidth="2"/>
              {series.map(({point, p}) => {
                const certified = point.futures.certified[market]?.[team.id];
                return <circle key={point.week} cx={x(point.week)} cy={y(p)} r="4" fill={color} stroke="white" tabIndex={0}
                  aria-label={`${team.name}, Week ${point.week}, ${probabilityLabel(p, undefined, certified !== undefined)}, ${americanOdds(p) ?? (certified === 1 ? "Confirmed" : certified === 0 ? "Eliminated" : "No finite odds")}`}
                  onMouseEnter={() => setActive({ team: team.id, week: point.week })}
                  onFocus={() => setActive({ team: team.id, week: point.week })}
                  onClick={() => setActive({ team: team.id, week: point.week })}/>;
              })}</g>;
          })}
        </svg>
      </div>
      <p className="odds-chart-tooltip" aria-live="polite">{focus && active && value !== undefined ?
        `${teams.find(team => team.id === active.team)?.name} · Week ${focus.week} · ${focus.at.slice(0, 10)} · ${probabilityLabel(value, undefined, focus.futures.certified[market]?.[active.team] !== undefined)} · ${americanOdds(value) ?? (focus.futures.certified[market]?.[active.team] === 1 ? "Confirmed" : focus.futures.certified[market]?.[active.team] === 0 ? "Eliminated" : "No finite odds")}` :
        "Focus or tap a point to see its recorded probability and odds."}</p>
      <div className="odds-chart-legend">{teams.map((team, i) => <button type="button" key={team.id} aria-pressed={!hidden.includes(team.id)}
        onClick={() => { setHidden(current => current.includes(team.id) ? current.filter(id => id !== team.id) : [...current, team.id]); setActive(null); }}>
        <span style={{backgroundColor: colors[i % colors.length]}}/><Avatar sources={team.avatars} size={19}/>{team.name}</button>)}</div>
    </>}
  </section>;
}
