"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense } from "react";
import { Button } from "@/components/ui/button";

/** Take "who to show" from the URL query and hand it to the page.
 *
 *  The pages are exported statically (to be served as plain files), so dynamic routes such as
 *  `/shape/[orcid]` are not available and the value arrives as a query. Two things to watch:
 *
 *  - Wrap `useSearchParams` in Suspense. The query is unknown at export time, so without the
 *    wrapper the export fails (see "Prerendering" in the local Next.js docs,
 *    use-search-params.md).
 *  - Rebuild the page when the value changes. With dynamic routes, a different path meant a
 *    different page, so it was rebuilt naturally. When only the query changes, the same page
 *    survives, and the previous person's filters and selection carry over to the next one.
 *    `key` prevents that. */
export default function ParamGate({
  name,
  children,
}: {
  /** Name of the query parameter to read (orcid / job) */
  name: string;
  children: (value: string) => React.ReactNode;
}) {
  return (
    <Suspense fallback={<Waiting />}>
      <Read name={name}>{children}</Read>
    </Suspense>
  );
}

function Read({
  name,
  children,
}: {
  name: string;
  children: (value: string) => React.ReactNode;
}) {
  const value = useSearchParams().get(name);
  if (!value) return <Missing />;
  return <Fragment key={value}>{children(value)}</Fragment>;
}

function Waiting() {
  return (
    <main className="grid h-svh place-items-center p-10">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading…
      </p>
    </main>
  );
}

function Missing() {
  return (
    <main className="grid h-svh place-items-center p-10 text-center">
      <div>
        <h1 className="text-sm font-semibold">This link does not say who to show</h1>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Start from the front page and search by name or ORCID iD.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href="/">Go to the front page</Link>
        </Button>
      </div>
    </main>
  );
}
