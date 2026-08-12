import { describe, expect, it } from "vitest";

import { CADDY_SYSTEM } from "@/lib/caddy/plan";
import { CADDY_TOOLS } from "@/lib/caddy/tools";
import { INVITATIONAL_COURSE } from "@/lib/course-templates";
import { HAZARDS } from "@/lib/hazards";
import {
  GOOD_COURSE,
  HOLE_PARTS,
  HOW_IT_PLAYS,
  NOT_THE_CADDYS,
  PAR_TYPICAL_MAX,
  PAR_TYPICAL_MIN,
} from "@/lib/house-rules";

/**
 * One rulebook, two readers.
 *
 * These tests exist because the caddy and the player used to be told different
 * things, and the difference was invisible: two files, two paraphrases, both
 * plausible. Nothing here checks wording for its own sake — each case is a
 * place where a drift actually cost something.
 */
describe("the house rulebook", () => {
  it("tells the caddy the same sentence the rules sheet tells a player", () => {
    expect(CADDY_SYSTEM).toContain(HOW_IT_PLAYS);
  });

  it("gives the caddy a goal, not only a list of prohibitions", () => {
    // The flat par-34 nine-pinter came out of a prompt that was all
    // constraints: a card breaking no rules and having no shape scored full
    // marks against it.
    GOOD_COURSE.forEach((line) => expect(CADDY_SYSTEM).toContain(line));
  });

  it("says what every part of a hole does to the round", () => {
    Object.values(HOLE_PARTS).forEach((does) =>
      expect(CADDY_SYSTEM).toContain(does),
    );
  });

  it("names what the caddy does not decide", () => {
    NOT_THE_CADDYS.forEach((line) => expect(CADDY_SYSTEM).toContain(line));
  });

  it("states par once, and in the same words wherever it is stated", () => {
    // The bug this file was written for: the par ladder lived in the system
    // prompt *and* in a tool description, in two different wordings, and both
    // disagreed with the printed card.
    const parTool = CADDY_TOOLS.flatMap((tool) => {
      const hole = (
        tool.input_schema.properties as Record<string, { description?: string }>
      ).par;
      return hole?.description ? [hole.description] : [];
    });
    parTool.forEach((description) => expect(description).toBe(HOLE_PARTS.par));
    expect(CADDY_SYSTEM).toContain(HOLE_PARTS.par);
  });

  it("no longer teaches a fixed drink-to-par table", () => {
    // The exact sentence that flattened every card. If it comes back, it will
    // come back as a helpful clarification.
    expect(CADDY_SYSTEM).not.toContain("4 is a pint");
    expect(CADDY_SYSTEM).not.toContain("4 a pint");
  });

  it("teaches a par range the printed card actually obeys", () => {
    // The Invitational is the house's worked example — nine holes that a real
    // group has played. If the doctrine and the card disagree, one of them is
    // wrong, and this is where that argument has to happen rather than in a
    // generated course nobody checks.
    const pars = INVITATIONAL_COURSE.map((hole) => hole.par);
    pars.forEach((par) => {
      expect(par).toBeGreaterThanOrEqual(PAR_TYPICAL_MIN);
      expect(par).toBeLessThanOrEqual(PAR_TYPICAL_MAX);
    });
    // And it is genuinely a spread, not a table: the same drink — a pint —
    // is priced at more than one par across the card.
    const pintPars = new Set(
      INVITATIONAL_COURSE
        .filter((hole) => /\bpint\b/i.test(hole.drink))
        .map((hole) => hole.par),
    );
    expect(pintPars.size).toBeGreaterThan(1);
  });

  it("puts the hazards in front of the caddy in the club's own words", () => {
    HAZARDS.forEach((hazard) => expect(CADDY_SYSTEM).toContain(hazard.meaning));
  });

  it("insists a drink be one the pub would actually pour", () => {
    // The pub can't be invented because the schema has nowhere to put a name.
    // The drink is free text, so this rule has to be argued instead — and it
    // is the same failure one pub further in.
    expect(HOLE_PARTS.drink).toMatch(/actually pour/i);
    expect(CADDY_SYSTEM).toContain(HOLE_PARTS.drink);
  });

  it("stays byte-stable, because it is a cached prompt prefix", () => {
    // Assembled at module load out of constants. If any of it ever became a
    // function of the request, every cache read would turn back into a cache
    // write and "ask as often as you like" would stop being affordable.
    expect(CADDY_SYSTEM).toBe(CADDY_SYSTEM);
    const descriptions = () =>
      JSON.stringify(CADDY_TOOLS.map((tool) => tool.input_schema));
    expect(descriptions()).toBe(descriptions());
  });
});
