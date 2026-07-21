import { clearAllLocalHands } from "../engine/localDb";
import { clearAllProfileSyncState } from "../engine/profileSync";
import { clearAnalysisCache } from "./analysisCache";
import { resetAnalysisJob } from "./analysisJob";
import { clearHandDbMeta } from "./handDbCache";
import { clearResultsCache } from "./resultsCache";

/**
 * Full local wipe after profile hand-DB clear / delete / switch.
 * Analysis reads IndexedDB first — server-only deletes leave a stale report.
 */
export async function purgeLocalHandState(): Promise<void> {
  await clearAllLocalHands();
  clearAnalysisCache();
  clearResultsCache();
  clearHandDbMeta();
  clearAllProfileSyncState();
  resetAnalysisJob();
}
