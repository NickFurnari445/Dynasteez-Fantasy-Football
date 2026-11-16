# Sleeper integration

The read-only server adapter uses the official public API at https://api.sleeper.app/v1 for league `1394584575056822272`. No API key or client-side Sleeper requests are needed. Endpoint reference: https://docs.sleeper.com/.

## Running and checking

```sh
npm run dev
npm run test:sleeper
npx tsc --noEmit
npm run build
```

The homepage shows league metadata, roster records, points for/against, matchups for `league.settings.leg`, and the latest 15 completed trade/waiver/free-agent transactions through that week (including week 0). If the league leg is missing, a regular-season NFL state week is used only when its season matches the league. No week is guessed from the local date.

Teams link to `/teams/[rosterId]` for managers, co-managers, players, starter/bench/IR/taxi status, and confirmed available draft picks. Team names fall back to actual manager names when a custom name is absent. Unresolved identities display their actual API IDs with an unavailable label. Standings display win percentage followed by points for, explicitly not official playoff seeding.

## Refresh, caching, and outages

- Visible pages request a server refresh every 60 seconds and when the tab becomes visible. Sleeper requests remain server-side. Refreshing preserves client navigation state.
- League, rosters, users, NFL state, and matchup responses have a 60-second TTL. Drafts, traded picks, and each transaction week have a five-minute TTL. The full player dictionary has a 24-hour TTL, as recommended by Sleeper.
- In-flight requests for the same endpoint are shared. Transaction history uses batches of at most five requests. Requests time out after seven seconds. Failures back off for at least 30 seconds; numeric HTTP 429 Retry-After is respected up to one hour.
- Valid responses are retained in memory and atomically persisted under `.next/cache/sleeper/` (already ignored by Git). A failed or malformed refresh never replaces a good snapshot. An outage serves the last good response with its original timestamp and a degraded-data notice. A cold outage renders explicit unavailable states while keeping the site shell usable.
- This local Node implementation uses filesystem snapshots rather than a remote cache service. A writable persistent filesystem preserves snapshots across server restarts; read-only or ephemeral hosts retain them only in the current process. Multiple independent hosts do not share a cache. No scheduler, hosting, or deployment is configured.
- Server data is rendered at request time beneath Suspense boundaries, following this project's installed Next.js Cache Components conventions. Production builds do not depend on live Sleeper availability.

## Limits of the published data

- History follows `previous_league_id`, with a cycle guard and a maximum of 20 seasons. Historical team identities are resolved within their own season. Currently, Dynasteez reports no previous league ID; earlier results and champions are not fabricated.
- Sleeper's league traded-picks endpoint lists traded picks, not the complete untraded future inventory. Untraded picks are materialized only for an unstarted draft whose season and round count are explicitly published. A completed startup draft is never used to project future rookie rounds or future seasons. Team pages label inventories as partial when future drafts are not published. Completed/drafting seasons' picks are excluded from available picks.
- Player names require the daily directory. If unavailable, rosters and transaction details still display player IDs. Null points/records remain unavailable rather than becoming zero. Scores honor commissioner `custom_points`, including a zero override.
- Announcements and commissioner bylaws are not available from these public endpoints and remain explicitly unprovided. Actual league/scoring settings are shown in the handbook. An all-time record book is not inferred from incomplete season totals.

## Files

- `lib/sleeper-types.ts`: API and view types.
- `lib/sleeper-model.ts`: pure scoring, identity, week, matchup, transaction, and pick normalization.
- `lib/sleeper-cache.ts`: timeout, TTL, deduplication, validated last-good snapshots, and retry behavior.
- `lib/sleeper.ts`: server-only API orchestration and historical traversal.
- `app/components/league-views.tsx`: shared standings, matchups, transaction, and data-status views.
- `scripts/test-sleeper.cjs`: deterministic adapter and outage regression tests; no external network calls.
