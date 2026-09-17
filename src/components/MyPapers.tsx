"use client";

import { ChevronDown, ExternalLink, FileWarning, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { fetchExclusionStatus, pruneExclusions, saveWorksExclusions } from "@/lib/api";
import { countingNotes } from "@/lib/counting";
import type { ExclusionStatus, MyWork, WorksMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Review the papers that are not the user's own and set them aside. Used from both the Shape
 *  page and the collaborator search.
 *
 *  OpenAlex sometimes merges people with the same name into one author record. In real data,
 *  Kenji's 37 papers had work by 3 other people mixed in: rice breeding in Toyama, an essay on
 *  Kenzo Tange's architecture, and a railway availability study. OpenAlex even tags the first
 *  two with "Military Technology and Strategies".
 *
 *  Left in, 3 of the 37 papers (8%) stay someone else's. That muddies the colours of the shape,
 *  and worse, **the recommendations put forward agronomists and railway engineers as "your next
 *  collaborator"**. That breaks the product's main function outright, so this feature stays.
 *
 *  **But this is a stopgap.** Fixing it is OpenAlex's job; our list only bridges the gap until
 *  upstream is fixed. So the permanent fix comes first, and setting papers aside here comes
 *  below it. We can also check whether upstream has been fixed yet.
 *
 *  **We do not decide by machine which papers are intruders.** Every automatic rule we measured
 *  was rejected. For example, flagging "papers whose co-authors appear on no other paper" picks
 *  out 5 papers, but 4 of them were the author's own early papers in Japanese. */
export default function MyPapers({
  orcid,
  works,
  meta,
  onSaved,
}: {
  orcid: string;
  works: MyWork[];
  meta: WorksMeta;
  /** Called once the save has gone through and the rebuild has started */
  onSaved: (job: string) => void;
}) {
  const excludedNow = meta.excluded_works ?? [];
  const [drop, setDrop] = useState<Set<string>>(
    () => new Set(excludedNow.map((w) => w.id)),
  );
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [status, setStatus] = useState<ExclusionStatus | null>(null);
  const [checking, setChecking] = useState(false);

  /** Group by topic. An intruder shows up as "an unfamiliar topic with a single paper", so
   *  this ordering makes it easy to spot. */
  const groups = (() => {
    const by = new Map<string, MyWork[]>();
    for (const w of works) {
      const key = w.topic ?? "No topic";
      by.set(key, [...(by.get(key) ?? []), w]);
    }
    return [...by.entries()]
      .map(([topic, rows]) => ({
        topic,
        rows: [...rows].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
      }))
      .sort((a, b) => b.rows.length - a.rows.length || (a.topic < b.topic ? -1 : 1));
  })();

  const before = new Set(excludedNow.map((w) => w.id));
  const changed =
    before.size !== drop.size || [...drop].some((id) => !before.has(id));

  const toggle = (id: string) =>
    setDrop((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save() {
    setSaving(true);
    setFailed(null);
    try {
      onSaved((await saveWorksExclusions(orcid, [...drop])).job);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  async function check(prune = false) {
    setChecking(true);
    try {
      setStatus(prune ? await pruneExclusions(orcid) : await fetchExclusionStatus(orcid));
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    }
    setChecking(false);
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs">
          <FileWarning className="size-3.5" />
          <span className="hidden sm:inline">My papers</span>
          {excludedNow.length > 0 && (
            <span className="tabular rounded-sm bg-muted px-1 text-[10px]">
              {excludedNow.length}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <div className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="text-sm">Is this all your work?</SheetTitle>
          <SheetDescription className="text-[11px] leading-relaxed">
            OpenAlex sometimes files another researcher&apos;s paper under your ORCID.
            Your shape, your collaborators and who we suggest you connect with next are
            all built from this list.
            {countingNotes(meta, false).length > 0 && (
              <span className="mt-1 block">
                Already sorted out for you: {countingNotes(meta, false).join(" ")}
              </span>
            )}
          </SheetDescription>
        </div>

        {/* The permanent fix comes first. The list below is a stopgap until it takes effect. */}
        <UpstreamFix
          status={status}
          checking={checking}
          records={meta.n_author_records ?? 1}
          onCheck={() => check(false)}
          onPrune={() => check(true)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <p className="border-b bg-muted/20 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Until that takes effect, untick anything that is not yours here. Grouped by
            topic, because a stranger&apos;s paper usually shows up as one lone
            unfamiliar topic.
          </p>

          {groups.map(({ topic, rows }) => (
            <section key={topic}>
              <h3 className="eyebrow sticky top-0 z-10 flex items-baseline justify-between border-b bg-card px-4 py-1.5">
                <span className="truncate">{topic}</span>
                <span className="tabular shrink-0 text-[10px]">{rows.length}</span>
              </h3>
              <ul>
                {rows.map((w) => (
                  <li key={w.id} className="border-b last:border-b-0">
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 px-4 py-2 hover:bg-muted/50",
                        drop.has(w.id) && "opacity-50",
                      )}
                    >
                      <Checkbox
                        checked={!drop.has(w.id)}
                        onCheckedChange={() => toggle(w.id)}
                        className="mt-0.5"
                        aria-label={`${w.title ?? "Untitled"} is mine`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] leading-snug">
                          {w.title ?? "Untitled"}
                        </span>
                        <span className="tabular mt-0.5 block text-[10.5px] text-muted-foreground">
                          {w.year} · {w.coauthors.length}{" "}
                          {w.coauthors.length === 1 ? "co-author" : "co-authors"}
                          {w.cited_by_count > 0 && ` · cited ${w.cited_by_count}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {excludedNow.length > 0 && (
            <section>
              <h3 className="eyebrow sticky top-0 z-10 flex items-baseline gap-2 border-b bg-card px-4 py-1.5">
                <Undo2 className="size-3" />
                <span className="flex-1">Already set aside</span>
                <span className="tabular text-[10px]">{excludedNow.length}</span>
              </h3>
              <ul>
                {excludedNow.map((w) => (
                  <li key={w.id} className="border-b last:border-b-0">
                    <label className="flex cursor-pointer items-start gap-2.5 px-4 py-2 hover:bg-muted/50">
                      <Checkbox
                        checked={!drop.has(w.id)}
                        onCheckedChange={() => toggle(w.id)}
                        className="mt-0.5"
                        aria-label={`Put ${w.title ?? "Untitled"} back`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] leading-snug">
                          {w.title ?? "Untitled"}
                        </span>
                        <span className="tabular mt-0.5 block text-[10.5px] text-muted-foreground">
                          {w.year}
                          {w.topic && ` · ${w.topic}`}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t px-4 py-3">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
            {failed ? (
              <span className="text-destructive">{failed}</span>
            ) : drop.size === 0 ? (
              `${works.length} publications, all yours`
            ) : (
              `Setting aside ${drop.size} of ${works.length + excludedNow.length}`
            )}
          </p>
          <Button
            size="sm"
            className="h-7 shrink-0 text-xs"
            disabled={!changed || saving}
            onClick={save}
          >
            {saving && <Loader2 className="size-3 animate-spin" />}
            Save and rebuild
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The route to fixing it upstream (at OpenAlex), and how far along that is.
 *
 *  Setting papers aside here means fighting the name matching on every rebuild. Removing them at
 *  OpenAlex means "the author ID is removed from that paper every cycle", so it is done once.
 *  It also fixes the record for every other tool that reads OpenAlex. That is why it comes
 *  first. */
function UpstreamFix({
  status,
  checking,
  records,
  onCheck,
  onPrune,
}: {
  status: ExclusionStatus | null;
  checking: boolean;
  /** Number of OpenAlex author records with this ORCID */
  records: number;
  onCheck: () => void;
  onPrune: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const todo = status?.works.filter((w) => w.attached) ?? [];
  // "All done" with nothing set aside claimed a fix that never happened.
  const none = status !== null && status.works.length === 0;

  return (
    <Collapsible
      open={expanded}
      onOpenChange={(v) => {
        setExpanded(v);
        // Check once, when it is first opened. While it stays closed we do not call OpenAlex.
        if (v && !status && !checking) onCheck();
      }}
      className="shrink-0 border-b bg-muted/30"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-2 text-left">
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
        />
        <span className="flex-1 text-xs font-medium">
          Fix this permanently at OpenAlex
        </span>
        {status && (
          <Badge
            variant={status.n_attached > 0 ? "secondary" : "outline"}
            className="h-4 px-1.5 text-[10px]"
          >
            {none ? "nothing set aside" : status.n_attached > 0 ? `${status.n_attached} to do` : "all done"}
          </Badge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="px-4 pb-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Removing a paper here filters it out every time we rebuild. Removing it at
          OpenAlex is permanent — it stays detached even when their matcher tries to
          re-attach it, and it fixes your record for every other tool that reads
          OpenAlex.
        </p>

        <ol className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
          <li className="flex gap-2">
            <span className="tabular text-muted-foreground">1.</span>
            <span className="flex-1">
              Sign in at openalex.org, open your author profile and claim it as yours.
              {records > 1 &&
                ` OpenAlex lists you under ${records} separate profiles; this app reads them all, and the check below covers every one.`}
              {status && (
                <a
                  href={status.profile_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1.5 inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                >
                  Open my profile
                  <ExternalLink className="size-3" />
                </a>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="tabular text-muted-foreground">2.</span>
            <span className="flex-1">
              On the claimed profile, remove these papers:
              {checking && !status ? (
                <span className="ml-1.5 inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  checking…
                </span>
              ) : none ? (
                <span className="ml-1.5 text-muted-foreground">
                  you have not set any papers aside, so there is nothing to remove.
                </span>
              ) : status && todo.length === 0 ? (
                <span className="ml-1.5 text-muted-foreground">
                  nothing left — all of them are already detached upstream.
                </span>
              ) : (
                <ul className="mt-1 space-y-1">
                  {todo.map((w) => (
                    <li key={w.id} className="flex items-baseline gap-1.5">
                      <span className="tabular text-muted-foreground">{w.year ?? "—"}</span>
                      <a
                        href={w.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate underline underline-offset-2 hover:text-primary"
                      >
                        {w.title ?? w.id}
                      </a>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="tabular text-muted-foreground">3.</span>
            <span className="flex-1">
              Changes usually show up within a day or two, once OpenAlex has updated its
              data. Then press Check OpenAlex below.
            </span>
          </li>
        </ol>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={checking}
            onClick={onCheck}
          >
            {checking ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Check OpenAlex
          </Button>
          {status && status.n_fixed > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs"
              disabled={checking}
              onClick={onPrune}
            >
              Drop {status.n_fixed} now fixed upstream
            </Button>
          )}
          {status?.pruned && status.pruned.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Cleared {status.pruned.length}. Nothing else changes — those papers are
              no longer yours in OpenAlex either.
            </span>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
