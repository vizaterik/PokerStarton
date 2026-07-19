import { getResults, listHandDatabases } from "../api/client";
import { metaFromDatabase, writeHandDbMeta } from "./handDbCache";
import { resultsFingerprint, writeResultsCache } from "./resultsCache";

let warming: Promise<void> | null = null;

/**
 * Prefetch active hand-DB meta + all-time career report into localStorage
 * so Analysis / Career / Schedule open from cache without a spinner.
 */
export function warmHandDbAndResultsCache(): Promise<void> {
  if (warming) return warming;
  warming = (async () => {
    try {
      const dbs = await listHandDatabases();
      const active = dbs.find((d) => d.is_active) ?? dbs[0];
      if (active) writeHandDbMeta(metaFromDatabase(active));
    } catch {
      /* ignore — report warm can still proceed */
    }
    try {
      const report = await getResults({});
      writeResultsCache(resultsFingerprint(""), report);
    } catch {
      /* ignore */
    }
  })().finally(() => {
    warming = null;
  });
  return warming;
}
