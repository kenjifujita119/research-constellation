"use client";

import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  fetchReach,
  fetchStatus,
  fetchWorks,
  startReachBuild,
  startWorksBuild,
} from "./api";
import type { ReachGraph, WorksGraph } from "./types";

/** If the data doesn't exist, has it built on the spot and shows progress until it is ready.
 *
 *  Without this, a user who has only built the co-author network cannot open /shape or /reach —
 *  both just GET, and with nothing cached they get a 404 and a dead end. It isn't built up front
 *  on the entry page so that people who never look don't have to wait for it. It is built only
 *  for the people who come to look.
 *
 *  Publications and citations are split in two because their cost and time differ by orders of
 *  magnitude (Measured: for a researcher with 508 papers, 8 s / $0.0004 versus 382 s / $0.0187).
 *  The Shape page can be drawn from the publications alone, so it appears without waiting for the
 *  citations. */
export type Loading<T> = {
  data: T | null;
  /** Whether it is being built */
  building: boolean;
  /** Progress lines reported by the job (by the server, before the app moved into the browser).
   *  The latest 12 lines */
  messages: string[];
  elapsed: number;
  error: string | null;
};

const POLL_MS = 1500;

/** GETs; on a 404, has it built, then GETs again once it is ready.
 *
 *  Publications and citations differ in only three things — what to fetch, what to start and which
 *  job to watch — so only those are swapped in. */
function useBuilt<T>(
  orcid: string,
  get: (orcid: string) => Promise<T>,
  start: (orcid: string) => Promise<{ status: string; job: string }>,
  jobKey: (orcid: string) => string,
  enabled = true,
): Loading<T> {
  const [data, setData] = useState<T | null>(null);
  const [building, setBuilding] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };

    const finish = async () => {
      const got = await get(orcid);
      if (cancelled) return;
      setData(got);
      setBuilding(false);
    };

    const watch = (job: string) => {
      timer.current = setInterval(async () => {
        try {
          const st = await fetchStatus(job);
          if (cancelled) return;
          setMessages(st.messages);
          setElapsed(st.elapsed);
          if (st.status === "running") return;
          stop();
          if (st.status === "error") {
            setBuilding(false);
            setError(st.error ?? "That build failed");
            return;
          }
          await finish();
        } catch (err) {
          // The server could briefly stop responding during a build (when there was one). Leave it
          // to the next tick.
          if (err instanceof ApiError && err.status >= 500) return;
          stop();
          if (!cancelled) {
            setBuilding(false);
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      }, POLL_MS);
    };

    const load = async () => {
      try {
        const got = await get(orcid);
        if (!cancelled) setData(got);
        return;
      } catch (err) {
        // 404 means "not built yet", so go and build it. Anything else is a real failure.
        if (!(err instanceof ApiError) || err.status !== 404) {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          return;
        }
      }

      if (cancelled) return;
      setBuilding(true);
      try {
        const started = await start(orcid);
        // It may already be done right after starting (another page was building it)
        if (started.status === "done") {
          await finish();
          return;
        }
        // Citations queue behind the publications. The job that start returns is the
        // publications one, so watch our own job — its status reads running while it is
        // queued, too.
        watch(jobKey(orcid));
      } catch (err) {
        if (!cancelled) {
          setBuilding(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      stop();
    };
  }, [orcid, enabled, get, start, jobKey]);

  return { data, building, messages, elapsed, error };
}

const worksJob = (orcid: string) => `${orcid}_works`;
const reachJob = (orcid: string) => `${orcid}_reach`;
const startWorks = (orcid: string) => startWorksBuild(orcid);
const startReach = (orcid: string) => startReachBuild(orcid);

/** The author's own publications. This is enough to draw the Shape page. Measured: 3–8 s. */
export function useWorksGraph(orcid: string): Loading<WorksGraph> {
  return useBuilt(orcid, fetchWorks, startWorks, worksJob);
}

/** How far the work has reached. Carries on in the background once the publications are fetched.
 *
 *  With enabled set to false it does not fetch anything. The Shape page only wants to know "can
 *  the globe be viewed yet", so it doesn't need this. */
export function useReachGraph(orcid: string, enabled = true): Loading<ReachGraph> {
  return useBuilt(orcid, fetchReach, startReach, reachJob, enabled);
}

/** Whether the globe can be viewed yet. Checks only the status, not the contents.
 *
 *  This is all the Shape page needs — there is no need to fetch 3.6MB of aggregates. It can take
 *  6 minutes before it is ready, so the button needs to be able to say "not yet". Otherwise whoever
 *  presses it lands on an empty page. */
export function useReachReady(orcid: string): "building" | "ready" | "none" {
  const [state, setState] = useState<"building" | "ready" | "none">("building");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const look = async () => {
      try {
        const st = await fetchStatus(reachJob(orcid));
        if (cancelled) return;
        if (st.status === "done") {
          setState("ready");
          if (timer) clearInterval(timer);
        } else if (st.status === "error") {
          setState("none");
          if (timer) clearInterval(timer);
        }
      } catch (err) {
        // 404 = not even queued yet. Pressing the button builds it, so "none" is fine.
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setState("none");
      }
    };
    look();
    timer = setInterval(look, 5000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [orcid]);

  return state;
}
