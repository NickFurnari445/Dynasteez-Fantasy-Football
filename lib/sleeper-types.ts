export type League = {
  league_id: string; name: string; season: string; status: string; sport: string;
  total_rosters?: number; previous_league_id?: string | null;
  settings: Record<string, number>; scoring_settings?: Record<string, number>;
  roster_positions?: string[];
};
export type Roster = {
  roster_id: number; owner_id?: string | null; co_owners?: string[] | null;
  players?: string[] | null; starters?: string[] | null; reserve?: string[] | null; taxi?: string[] | null;
  settings?: Record<string, number>; metadata?: Record<string, string> | null;
};
export type User = { user_id: string; display_name?: string; username?: string; metadata?: { team_name?: string } | null };
export type Matchup = { roster_id: number; matchup_id: number | null; points?: number | null; custom_points?: number | null };
export type NflState = { season: string; week: number; leg?: number; season_type?: string };
export type TradedPick = { season: string; round: number; roster_id: number; owner_id: number };
export type Draft = { draft_id: string; season: string; status: string; type?: string; settings?: { rounds?: number }; start_time?: number | null };
export type Transaction = {
  transaction_id: string; type: string; status: string; roster_ids?: number[];
  status_updated?: number; created?: number; adds?: Record<string, number> | null;
  drops?: Record<string, number> | null; draft_picks?: TradedPick[];
  waiver_budget?: { sender: number; receiver: number; amount: number }[];
  settings?: { waiver_bid?: number } | null;
};
export type Player = { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null; injury_status?: string | null };
export type Players = Record<string, Player>;
export type Team = { id: number; name: string; manager: string | null; coManagers: string[]; roster: Roster; wins: number | null; losses: number | null; ties: number | null; pointsFor: number | null; pointsAgainst: number | null };
export type AvailablePick = { season: string; round: number; originalRosterId: number; ownerId: number; source: "scheduled" | "reported trade" };
