import { mkdir, readdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Futures } from "./season-odds";
import type { WeeklyResult } from "./weekly-odds";

export type OddsSnapshot = {
  league: string; season: string; week: number; version: string; at: string; futures: Futures;
};
type PregameSnapshot = Pick<OddsSnapshot, "league" | "season" | "week" | "version" | "at"> & { lines: WeeklyResult["lines"] };

export function snapshotStore(root?: string) {
  const base = root && path.isAbsolute(root) && !process.env.VERCEL ? root : null;
  const directory = (league: string, season: string, version: string) => {
    if (!base || !/^\d+$/.test(league) || !/^\d{4}$/.test(season) || !/^\w[\w.-]*$/.test(version)) return null;
    return path.join(base, league, season, version);
  };
  async function save(snapshot: OddsSnapshot | PregameSnapshot, prefix: string) {
    const folder = directory(snapshot.league, snapshot.season, snapshot.version);
    if (!folder || !Number.isInteger(snapshot.week) || snapshot.week < 1 || snapshot.week > 18) return false;
    await mkdir(folder, { recursive: true });
    const temporary = path.join(folder, randomUUID() + ".tmp");
    try {
      await writeFile(temporary, JSON.stringify(snapshot), { flag: "wx" });
      await link(temporary, path.join(folder, `${prefix}-${snapshot.week}.json`));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
  return {
    enabled: !!base,
    save: (snapshot: OddsSnapshot) => save(snapshot, "week"),
    savePregame: (snapshot: PregameSnapshot) => save(snapshot, "pregame"),
    async getPregame(league: string, season: string, version: string, week: number): Promise<PregameSnapshot | null> {
      const folder = directory(league, season, version);
      if (!folder || !Number.isInteger(week) || week < 1 || week > 18) return null;
      try {
        const filename = path.join(/* turbopackIgnore: true */ folder, `pregame-${week}.json`);
        return JSON.parse(await readFile(/* turbopackIgnore: true */ filename, "utf8")) as PregameSnapshot;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async list(league: string, season: string, version: string) {
      const folder = directory(league, season, version);
      if (!folder) return [];
      const files = await readdir(/* turbopackIgnore: true */ folder).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      const snapshots = await Promise.all(files.filter(file => /^week-\d+\.json$/.test(file)).map(async file => {
        const filename = path.join(/* turbopackIgnore: true */ folder, file);
        const data = JSON.parse(await readFile(/* turbopackIgnore: true */ filename, "utf8")) as OddsSnapshot;
        return data;
      }));
      return snapshots.sort((a, b) => a.week - b.week);
    },
  };
}
