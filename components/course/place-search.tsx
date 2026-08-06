"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { FieldLabel, Input } from "@/components/ui/input";
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
}: {
  onAdd: (pub: FoundPub) => void;
  nextHoleNumber: number;
}) {
  const [query, setQuery] = useState("");
  const [manualName, setManualName] = useState("");
  const [results, setResults] = useState<VenueResult[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [searching, setSearching] = useState(false);
  const requestSeq = useRef(0);

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
        const response = await fetch("/api/places/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });
        const data = (await response.json()) as {
          degraded?: boolean;
          results?: VenueResult[];
        };
        if (seq !== requestSeq.current) return;
        setDegraded(Boolean(data.degraded));
        setResults(data.results ?? []);
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
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel htmlFor="pub-search">Search pubs</FieldLabel>
        <div className="relative">
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
                onClick={() =>
                  onAdd({
                    venue_id: venue.id,
                    venue_name: venue.name,
                    address: venue.address,
                    rating: venue.rating,
                    lat: venue.lat,
                    lng: venue.lng,
                  })
                }
                className="flex min-h-10 shrink-0 items-center gap-1 rounded-full border-[1.5px] border-fairway px-3.5 text-xs font-bold text-fairway"
              >
                <Plus size={13} aria-hidden /> Add
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
          disabled={!manualName.trim()}
          onClick={addManual}
          className="flex min-h-12 shrink-0 items-center gap-1 rounded-lg border-[1.5px] border-fairway px-4 text-sm font-bold text-fairway disabled:opacity-40"
        >
          <Plus size={14} aria-hidden /> Add
        </button>
      </div>
    </div>
  );
}
