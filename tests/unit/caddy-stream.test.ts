import { describe, expect, it } from "vitest";

import {
  decodeEvents,
  encodeEvent,
  pickedIds,
  thinkingTail,
  THINKING_WINDOW,
  type CaddyEvent,
} from "@/lib/caddy/stream";

const patch: CaddyEvent = {
  type: "patch",
  pins: [{ id: "p1", lat: 51.5, lng: -0.08 }],
};

describe("the caddy's narration on the wire", () => {
  it("round-trips an event", () => {
    const { events, rest } = decodeEvents(encodeEvent(patch));
    expect(events).toEqual([patch]);
    expect(rest).toBe("");
  });

  it("keeps a half-arrived event back until the rest of it turns up", () => {
    // The failure this exists for: a chunk off the network splits wherever TCP
    // felt like splitting it, which is regularly mid-object.
    const whole = encodeEvent(patch) + encodeEvent({ type: "thinking", text: "picking" });
    const split = Math.floor(whole.length * 0.7);
    const first = decodeEvents(whole.slice(0, split));
    expect(first.events).toEqual([patch]);
    const second = decodeEvents(first.rest + whole.slice(split));
    expect(second.events).toEqual([{ type: "thinking", text: "picking" }]);
    expect(second.rest).toBe("");
  });

  it("drops a bad line rather than failing the plan", () => {
    // A narration is not worth throwing a finished card away over.
    const { events } = decodeEvents(`{"type":"thinking"\n${encodeEvent(patch)}`);
    expect(events).toEqual([patch]);
  });

  it("survives an empty buffer and a buffer of blank lines", () => {
    expect(decodeEvents("")).toEqual({ events: [], rest: "" });
    expect(decodeEvents("\n\n\n").events).toEqual([]);
  });

  it("never splits an event that contains a newline in its text", () => {
    // JSON.stringify escapes the newline, so the framing holds. If it ever
    // stopped doing that, every multi-line thought would break the stream.
    const multiline: CaddyEvent = { type: "thinking", text: "one\ntwo\nthree" };
    expect(encodeEvent(multiline).trimEnd()).not.toContain("\n");
    expect(decodeEvents(encodeEvent(multiline)).events).toEqual([multiline]);
  });
});

describe("pickedIds", () => {
  it("reads the picks out of a document that is still being written", () => {
    const partial = '{"courseName":"The Crawl","holes":[{"candidateId":"p3","drink":"Pint of stout","par":4},{"candidateId":"p11","dri';
    expect(pickedIds(partial)).toEqual(["p3", "p11"]);
  });

  it("keeps the caddy's own order and says each pub once", () => {
    const text = '"candidateId": "p9" "candidateId":"p2" "candidateId" : "p9"';
    expect(pickedIds(text)).toEqual(["p9", "p2"]);
  });

  it("finds nothing in a document that has not got there yet", () => {
    expect(pickedIds("")).toEqual([]);
    expect(pickedIds('{"courseName":"Half a n')).toEqual([]);
  });

  it("cannot put a pub on a card, whatever it reads", () => {
    // The safety argument for using a regex here rather than a partial JSON
    // parser: this is not in the path that builds a card. `parsePlan` reads
    // the finished document and resolves every id against the dossier, so the
    // worst a wrong answer here can do is light a pin up early.
    expect(pickedIds('"candidateId":"nonsense"')).toEqual(["nonsense"]);
  });
});

describe("thinkingTail", () => {
  it("flattens the reasoning onto one line", () => {
    expect(thinkingTail("  looking\n  at   the   patch \n")).toBe("looking at the patch");
  });

  it("shows the end, because that is where the caddy currently is", () => {
    const long = `${"x".repeat(400)}the last thing`;
    const tail = thinkingTail(long);
    expect(tail.endsWith("the last thing")).toBe(true);
    expect(tail.length).toBeLessThanOrEqual(THINKING_WINDOW + 1);
    expect(tail.startsWith("…")).toBe(true);
  });

  it("leaves a short thought alone", () => {
    expect(thinkingTail("nearly done")).toBe("nearly done");
  });
});
