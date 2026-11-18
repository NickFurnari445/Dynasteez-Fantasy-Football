import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ApiResult<T> = { data: T | null; fetchedAt: string | null; stale: boolean; error: string | null };
type Snapshot = { data: unknown; fetchedAt: string };
type Validator<T> = (value: unknown) => value is T;

// Persistent, per-endpoint last-good responses survive process restarts on a writable Node host.
// Read-only/ephemeral hosts degrade to a process-local cache without failing the page.
export function createSleeperClient(options: { directory: string; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number; baseUrl?: string }) {
  const memory = new Map<string, Snapshot>();
  const pending = new Map<string, Promise<ApiResult<unknown>>>();
  const retryAfter = new Map<string, number>();
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  async function get<T>(endpoint: string, validate: Validator<T>, ttlSeconds = 60): Promise<ApiResult<T>> {
    if (pending.has(endpoint)) return pending.get(endpoint) as Promise<ApiResult<T>>;
    const operation = (async (): Promise<ApiResult<T>> => {
      const file = path.join(options.directory, createHash("sha256").update(endpoint).digest("hex") + ".json");
      let saved = memory.get(endpoint);
      if (!saved) {
        try {
          const candidate = JSON.parse(await readFile(file, "utf8")) as Snapshot;
          if (validate(candidate.data) && Number.isFinite(Date.parse(candidate.fetchedAt))) saved = candidate;
        } catch { /* A missing or corrupt cache is a cold start. */ }
      }
      if (saved && !validate(saved.data)) saved = undefined;
      if (saved) memory.set(endpoint, saved);
      const result = (error: string | null): ApiResult<T> => ({ data: saved?.data as T ?? null, fetchedAt: saved?.fetchedAt ?? null, stale: !!error && !!saved, error });
      if (saved && now() - Date.parse(saved.fetchedAt) < ttlSeconds * 1000) return result(null);
      if ((retryAfter.get(endpoint) ?? 0) > now()) return result("Sleeper is temporarily unavailable; retrying automatically.");
      try {
        const response = await fetcher(`${options.baseUrl ?? "https://api.sleeper.app/v1/"}${endpoint}`, { cache: "no-store", signal: AbortSignal.timeout(options.timeoutMs ?? 7000), headers: { Accept: "application/json" } });
        if (!response.ok) {
          const seconds = Number(response.headers.get("retry-after"));
          if (response.status === 429 && Number.isFinite(seconds) && seconds > 0) retryAfter.set(endpoint, now() + Math.min(seconds, 3600) * 1000);
          throw new Error(`HTTP ${response.status}`);
        }
        const data: unknown = await response.json();
        if (!validate(data)) throw new Error("Unexpected response shape");
        saved = { data, fetchedAt: new Date(now()).toISOString() };
        memory.set(endpoint, saved);
        retryAfter.delete(endpoint);
        try {
          await mkdir(options.directory, { recursive: true });
          const temporary = `${file}.${randomUUID()}.tmp`;
          await writeFile(temporary, JSON.stringify(saved), "utf8");
          await rename(temporary, file);
        } catch { /* In-memory caching remains available on a read-only host. */ }
        return result(null);
      } catch (error) {
        retryAfter.set(endpoint, Math.max(retryAfter.get(endpoint) ?? 0, now() + 30000));
        console.warn(`[Sleeper] ${endpoint}: ${error instanceof Error ? error.message : "request failed"}`);
        return result("Sleeper is temporarily unavailable; retrying automatically.");
      }
    })();
    pending.set(endpoint, operation);
    try { return await operation; } finally { pending.delete(endpoint); }
  }
  return { get };
}
