"use client";

import { Info } from "lucide-react";
import { inTopic } from "@/lib/graph";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { EgoTopic, GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Pick one of the ego's topics and narrow the whole page (graph, stats, recommendations) to it.
 *
 * It sits full-width right below the header because it scopes the whole page, not one panel.
 * If only the recommendations were narrowed and the graph stayed the same, the left and right
 * of the same page would be pointing at different things.
 */
export default function TopicScope({
  topics, nodes, egoId, topic, onChange,
}: {
  topics: EgoTopic[];
  nodes: GraphNode[];
  egoId: string;
  topic: string | null;
  onChange: (topic: string | null) => void;
}) {
  if (topics.length === 0) return null;

  // How many people each topic involves, so you can see the scale before clicking.
  const reach = new Map(
    topics.map((t) => [t.id, nodes.filter((n) => n.hop !== 0 && inTopic(n, t.id)).length]),
  );

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-card/60 px-2 py-1.5 sm:px-3">
      <span className="eyebrow hidden shrink-0 sm:block">Scope</span>

      {/* Only the chip row may scroll sideways. That is not the same as the page doing so. */}
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip active={topic === null} onClick={() => onChange(null)}>
          All topics
        </Chip>
        {topics.map((t) => (
          <Chip
            key={t.id}
            active={topic === t.id}
            onClick={() => onChange(topic === t.id ? null : t.id)}
            title={`${t.papers} of your papers · ${reach.get(t.id) ?? 0} people: your co-authors on those papers and the candidates found in this topic`}
          >
            {t.name}
            <span
              className={cn(
                "tabular rounded-sm px-1 text-[10px]",
                topic === t.id ? "bg-black/15" : "bg-muted-foreground/10",
              )}
            >
              {reach.get(t.id) ?? 0}
            </span>
          </Chip>
        ))}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label="About these topics"
          >
            <Info className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 text-xs leading-relaxed">
          {/* Name-matching errors are OpenAlex's problem and cannot be fixed here.
              Silently removing papers on a guess would drop the author's own work too,
              so we only show a caveat. */}
          <p>
            Topics come from OpenAlex&rsquo;s automatic classification, and a profile
            sometimes includes papers by a different researcher with the same name — an
            unfamiliar topic here is usually one of those.
          </p>
          <p className="mt-2">
            <a
              className="text-primary underline underline-offset-2"
              href={`https://openalex.org/${egoId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Check the source profile on OpenAlex
            </a>
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Chip({
  active, onClick, title, children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-1",
        "text-xs transition-colors duration-200",
        "focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-2",
        active
          ? "border-accent bg-accent text-accent-foreground font-medium"
          : "border-border bg-background text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
