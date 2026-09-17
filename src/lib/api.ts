/** The interface the pages use. Everything runs inside the user's browser (lib/local.ts).
 *
 *  This used to query a Python server. Now the browser calls OpenAlex directly and builds the
 *  results itself — so that each user spends their own keyless free allowance and no server is
 *  needed (the site is published as static files on GitHub Pages). The function names and shapes
 *  are kept from the server days, so the pages have barely changed. */

export { ApiError } from "./errors";
export type { StartResult } from "./local";
export {
  fetchCountryReach,
  fetchExclusionStatus,
  fetchIntroducers,
  fetchNetwork,
  fetchReach,
  fetchRecommendations,
  fetchStatus,
  fetchWorks,
  pruneExclusions,
  remainingAllowance,
  saveWorksExclusions,
  searchAuthors,
  startBuild,
  startReachBuild,
  startWorksBuild,
} from "./local";
