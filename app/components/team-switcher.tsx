"use client";

import { useRouter } from "next/navigation";

export function TeamSwitcher({ teams, current, week }: {
  teams: { id: number; name: string }[]; current: number; week?: number;
}) {
  const router = useRouter();
  return <label>Team<select aria-label="Team" value={current} onChange={event => {
    router.push(`/teams/${event.target.value}${week ? `?week=${week}` : ""}`);
  }}>
    {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
  </select></label>;
}
