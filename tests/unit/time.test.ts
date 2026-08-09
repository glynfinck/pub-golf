import { describe, expect, it } from "vitest";

import {
  BUSY_DELAY_MS,
  BUSY_MIN_VISIBLE_MS,
  busyDelayRemaining,
  busyHoldRemaining,
  clockTime12,
  deadlineFrom,
  estimatedFinishMs,
  formatClock,
  formatDuration,
  isUrgent,
  remainingSeconds,
  ringFraction,
  roundMinutes,
  spokenClock,
} from "@/lib/time";

describe("remainingSeconds", () => {
  it("has no answer before the first client tick", () => {
    expect(remainingSeconds(null)).toBeNull();
  });

  it("rounds up, so a countdown never shows the next second early", () => {
    expect(remainingSeconds(1)).toBe(1);
    expect(remainingSeconds(1_000)).toBe(1);
    expect(remainingSeconds(1_001)).toBe(2);
  });
});

describe("formatClock", () => {
  it("shows a placeholder before the first tick", () => {
    expect(formatClock(null)).toBe("--:--");
  });

  it("pads seconds but not minutes", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(600_000)).toBe("10:00");
  });

  it("counts the final second down to zero", () => {
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(0)).toBe("0:00");
  });

  it("never runs negative", () => {
    expect(formatClock(-5_000)).toBe("0:00");
  });
});

describe("spokenClock", () => {
  it("is silent before the first tick", () => {
    expect(spokenClock(null)).toBeNull();
  });

  it("reads the clock as words for a screen reader", () => {
    expect(spokenClock(65_000)).toBe("1 minutes 5 seconds");
  });
});

describe("isUrgent", () => {
  it("turns the hole red inside the last two minutes", () => {
    expect(isUrgent(120_000)).toBe(true);
    expect(isUrgent(119_999)).toBe(true);
  });

  it("stays calm above two minutes", () => {
    expect(isUrgent(120_001)).toBe(false);
  });

  it("is never urgent before the first tick", () => {
    expect(isUrgent(null)).toBe(false);
  });
});

describe("ringFraction", () => {
  it("rests full before the first tick", () => {
    expect(ringFraction(null, 60_000)).toBe(1);
  });

  it("rests full when the round carries no timer", () => {
    expect(ringFraction(30_000, 0)).toBe(1);
    expect(ringFraction(30_000, -1)).toBe(1);
  });

  it("drains in proportion to the time left", () => {
    expect(ringFraction(30_000, 60_000)).toBe(0.5);
  });

  it("clamps at both ends", () => {
    expect(ringFraction(90_000, 60_000)).toBe(1);
    expect(ringFraction(-1_000, 60_000)).toBe(0);
  });
});

describe("busy thresholds", () => {
  const T0 = 1_000_000;

  it("holds the furniture back until the wait has earned it", () => {
    expect(busyDelayRemaining(T0, T0)).toBe(BUSY_DELAY_MS);
    expect(busyDelayRemaining(T0, T0 + 399)).toBe(1);
  });

  it("shows it exactly at the threshold, never late-negative", () => {
    expect(busyDelayRemaining(T0, T0 + BUSY_DELAY_MS)).toBe(0);
    expect(busyDelayRemaining(T0, T0 + 5_000)).toBe(0);
  });

  it("once shown, holds long enough not to flash", () => {
    // A 420ms action shows the mark at 400 and must keep it to 700.
    expect(busyHoldRemaining(T0 + BUSY_DELAY_MS, T0 + 420)).toBe(
      BUSY_MIN_VISIBLE_MS - 20,
    );
  });

  it("costs nothing once the minimum has passed", () => {
    expect(busyHoldRemaining(T0, T0 + BUSY_MIN_VISIBLE_MS)).toBe(0);
    expect(busyHoldRemaining(T0, T0 + 10_000)).toBe(0);
  });
});

describe("deadlineFrom", () => {
  const NOON = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("puts the deadline the given number of minutes out", () => {
    expect(deadlineFrom(NOON, 20)).toBe("2026-01-01T12:20:00.000Z");
  });

  it("is null when the round runs without a clock", () => {
    expect(deadlineFrom(NOON, null)).toBeNull();
    expect(deadlineFrom(NOON, undefined)).toBeNull();
    expect(deadlineFrom(NOON, 0)).toBeNull();
  });
});

describe("the 19th-hole estimate", () => {
  it("adds the pubs at pace to the walks between them", () => {
    // The printed Invitational: 9 pubs, 101 minutes of walking.
    expect(roundMinutes(9, 20, 101)).toBe(281);
    expect(roundMinutes(2, 15, 8)).toBe(38);
  });

  it("lands the finish that many minutes past the tee", () => {
    const NOON = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(estimatedFinishMs(NOON, 90)).toBe(NOON + 90 * 60_000);
  });
});

describe("formatDuration", () => {
  it("reads as hours and minutes, dropping what is zero", () => {
    expect(formatDuration(235)).toBe("3h 55m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(55)).toBe("55m");
  });

  it("never runs negative and rounds stray fractions", () => {
    expect(formatDuration(-10)).toBe("0m");
    expect(formatDuration(90.4)).toBe("1h 30m");
  });
});

describe("clockTime12", () => {
  it("prints the tee times the way the card says them", () => {
    expect(clockTime12(19 * 60)).toBe("7:00 PM");
    expect(clockTime12(18 * 60 + 30)).toBe("6:30 PM");
  });

  it("handles noon and midnight without a 0 o'clock", () => {
    expect(clockTime12(0)).toBe("12:00 AM");
    expect(clockTime12(12 * 60)).toBe("12:00 PM");
  });

  it("wraps a finish past midnight — its own warning", () => {
    expect(clockTime12(24 * 60 + 40)).toBe("12:40 AM");
  });
});
