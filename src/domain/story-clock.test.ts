import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./application";
import { MIA_AND_DAN_AFTER_CALL } from "./fixtures/mia-and-dan";
import { storyWorkingTimeAfter } from "./story-clock";

const endingAt = (at: string) => ({
  audit: [{ ...MIA_AND_DAN_AFTER_CALL.audit[0], at } as AuditEvent],
});

describe("storyWorkingTimeAfter", () => {
  it.each([
    ["an evening to the next morning", "2026-10-12T19:53:00+11:00", "2026-10-13T09:02:00+11:00"],
    ["an early time to that morning", "2026-10-13T03:10:00+11:00", "2026-10-13T09:02:00+11:00"],
    ["5pm to the next morning", "2026-10-13T16:58:00+11:00", "2026-10-14T09:02:00+11:00"],
    ["a Friday evening to Monday", "2026-10-16T19:53:00+11:00", "2026-10-19T09:02:00+11:00"],
    ["a Saturday to Monday", "2026-10-17T10:00:00+11:00", "2026-10-19T09:02:00+11:00"],
    ["a negative offset in its own day", "2026-10-12T19:53:00-04:30", "2026-10-13T09:02:00-04:30"],
  ])("moves %s", (_, last, expected) => {
    expect(storyWorkingTimeAfter(endingAt(last), 2)).toBe(expected);
  });

  it("leaves a time inside working hours alone", () => {
    expect(storyWorkingTimeAfter(endingAt("2026-10-13T10:05:00+11:00"), 2)).toBe(
      "2026-10-13T10:07:00+11:00",
    );
    expect(storyWorkingTimeAfter(endingAt("2026-10-13T08:58:00+11:00"), 2)).toBe(
      "2026-10-13T09:00:00+11:00",
    );
  });
});
