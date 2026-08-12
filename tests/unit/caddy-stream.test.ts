import { describe, expect, it } from "vitest";

import {
  decodeEvents,
  encodeEvent,
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
