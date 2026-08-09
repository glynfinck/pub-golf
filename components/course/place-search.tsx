"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Map as MapIcon, Plus, Search } from "lucide-react";
import { FieldLabel, Input } from "@/components/ui/input";
import { searchPubs } from "@/lib/pub-search";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/supabase-helpers";

type VenueResult = Tables<"venues">;

export interface FoundPub {
  venue_id: string | null;
  venue_name: string;
  address: string | null;
  rating: number | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Debounced Google Places search (server-proxied — the key stays home).
 * When the stack has no key the route degrades and only the by-name row
 * renders, so the builder works everywhere.
 */
export function PlaceSearch({
  onAdd,
  nextHoleNumber,
  onOpenMap,
}: {
  onAdd: (pub: FoundPub) => void;
  nextHoleNumber: number;
  /** Opens the map sheet with the current query. Absent when the browser
   * has no Maps key, and the field stays exactly as it always was. */
  onOpenMap?: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [manualName, setManualName] = useState("");
  const [results, setResults] = useState<VenueResult[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [searching, setSearching] = useState(false);
  const requestSeq = useRef(0);
  // The hole lands at the bottom of a long form, often below the fold, so the
  // tap itself has to confirm it landed. Keyed by venue id ("manual" for the
  // by-name row) so only the button actually pressed flips.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );

  function confirmAdd(key: string) {
    setJustAdded(key);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setJustAdded(null), 1400);
  }

  useEffect(() => {
    const trimmed = query.trim();
    const seq = ++requestSeq.current;
    // All setState lives in the (async) timeout callback — the strict
    // hooks lint forbids it in the effect body itself.
    const timeout = setTimeout(async () => {
      if (seq !== requestSeq.current) return;
      if (trimmed.length < 3) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const data = await searchPubs({ query: trimmed });
        if (seq !== requestSeq.current) return;
        setDegraded(data.degraded);
        setResults(data.results);
      } catch {
        if (seq === requestSeq.current) setResults([]);
      } finally {
        if (seq === requestSeq.current) setSearching(false);
      }
    }, trimmed.length < 3 ? 0 : 350);
    return () => clearTimeout(timeout);
  }, [query]);

  function addManual() {
    const name = manualName.trim();
    if (!name) return;
    onAdd({
      venue_id: null,
      venue_name: name,
      address: null,
      rating: null,
      lat: null,
      lng: null,
    });
    setManualName("");
    confirmAdd("manual");
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel htmlFor="pub-search">Search pubs</FieldLabel>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={15}
              aria-hidden
              className="absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="pub-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="The Auld Shillelagh…"
              className="pl-9"
            />
          </div>
          {onOpenMap ? (
            <button
              type="button"
              aria-label="See pubs on the map"
              onClick={() => onOpenMap(query)}
              className="flex size-12 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-fairway text-fairway"
            >
              <MapIcon size={18} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {degraded && query.trim().length >= 3 ? (
        <p className="text-[11px] text-muted-foreground">
          Pub search needs a Google Places key on the server — add pubs by
          name below and the course works just the same.
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="flex flex-col">
          {results.map((venue) => (
            <div
              key={venue.id}
              className="flex min-h-13 items-center gap-2.5 border-b border-dotted border-border py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{venue.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {venue.address}
                  {venue.rating ? ` · ★ ${venue.rating}` : ""}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Add ${venue.name} as hole ${nextHoleNumber}`}
                onClick={() => {
                  onAdd({
                    venue_id: venue.id,
                    venue_name: venue.name,
                    address: venue.address,
                    rating: venue.rating,
                    lat: venue.lat,
                    lng: venue.lng,
                  });
                  confirmAdd(venue.id);
                }}
                className={cn(
                  "flex min-h-10 shrink-0 items-center gap-1 rounded-full border-[1.5px] border-fairway px-3.5 text-xs font-bold transition-colors duration-200",
                  justAdded === venue.id
                    ? "bg-fairway text-primary-foreground"
                    : "text-fairway",
                )}
              >
                {justAdded === venue.id ? (
                  <>
                    <Check
                      size={13}
                      aria-hidden
                      className="animate-in zoom-in-50 duration-200"
                    />
                    Added
                  </>
                ) : (
                  <>
                    <Plus size={13} aria-hidden /> Add
                  </>
                )}
              </button>
            </div>
          ))}
        </div>
      ) : searching ? (
        <p className="text-[11px] text-muted-foreground">Searching…</p>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor="manual-pub">Add a pub by name</FieldLabel>
          <Input
            id="manual-pub"
            value={manualName}
            onChange={(event) => setManualName(event.target.value)}
            placeholder="The Test Tavern"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addManual();
              }
            }}
          />
        </div>
        <button
          type="button"
          aria-label="Add the named pub"
          disabled={!manualName.trim() && justAdded !== "manual"}
          onClick={addManual}
          className={cn(
            "flex min-h-12 shrink-0 items-center gap-1 rounded-lg border-[1.5px] border-fairway px-4 text-sm font-bold transition-colors duration-200 disabled:opacity-40",
            justAdded === "manual"
              ? "bg-fairway text-primary-foreground"
              : "text-fairway",
          )}
        >
          {justAdded === "manual" ? (
            <>
              <Check
                size={14}
                aria-hidden
                className="animate-in zoom-in-50 duration-200"
              />
              Added
            </>
          ) : (
            <>
              <Plus size={14} aria-hidden /> Add
            </>
          )}
        </button>
      </div>
    </div>
  );
}
