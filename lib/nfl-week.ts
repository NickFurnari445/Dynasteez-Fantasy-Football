import { numeric } from "./sleeper-model";

export type NflGame = { game_id: string; week: number; status: string; home: string; away: string; date: string };
export type NflPlayerWeek = {
  player_id: string; game_id: string | null; team: string | null; opponent: string | null; stats: Record<string, number>;
};

export function nflGameStatus(value?: string) {
  if (value === "pre_game") return "Upcoming";
  if (value === "in_game" || value === "in_progress" || value === "live" || value === "halftime") return "Live";
  if (value === "complete" || value === "final") return "Final";
  if (value === "postponed" || value === "canceled") return "Unavailable";
  return null;
}

const offense = new Set(["pass_yd", "pass_td", "pass_int", "pass_2pt", "rush_yd", "rush_td", "rush_2pt",
  "rec", "rec_yd", "rec_td", "rec_2pt", "fum_lost"]);

// Dynasteez's active defense and kicking rules. Their projection feeds do not
// publish all the matching distance and points-allowed buckets.
const defenseOrKicking = /^(?:fgm(?:iss)?_(?:0_19|20_29|30_39|40_49|50_59|60p)|fgmiss|xpm|xpmiss|pts_allow_(?:0|1_6|7_13|14_20|21_27|28_34|35p)|sack|int|fum_rec|fum_rec_td|ff|safe|blk_kick|def_2pt|def_td|def_st_td|def_st_ff|def_st_fum_rec)$/;

export function offensiveProjection(position: string | undefined, entry: NflPlayerWeek | undefined, settings?: Record<string, number>) {
  if (!position || !["QB", "RB", "WR", "TE", "FB"].includes(position) || !entry?.game_id ||
    numeric(entry.stats.pts_ppr) === null || !settings) return null;
  const rules = Object.entries(settings).filter(([, weight]) => weight !== 0);
  if (!rules.some(([key]) => offense.has(key) && numeric(entry.stats[key]) !== null) ||
    rules.some(([key]) => !offense.has(key) && !defenseOrKicking.test(key) && !["st_td", "st_ff", "st_fum_rec"].includes(key))) return null;
  // Sparse offensive stats represent zero for fields the provider leaves out.
  // Include return and recovery contributions only when the feed supplies them.
  return rules.filter(([key]) => offense.has(key) || ["st_td", "st_ff", "st_fum_rec", "fum_rec_td"].includes(key))
    .reduce((sum, [key, weight]) => sum + (numeric(entry.stats[key]) ?? 0) * weight, 0);
}
