import { describe, expect, it } from "vitest";
import { aud, formatAud } from "./money";

describe("formatAud", () => {
  it("formats whole dollars with the A$ prefix", () => {
    expect(formatAud(aud(810_000))).toBe("A$810,000");
  });

  it("marks indicative figures as approximate", () => {
    expect(formatAud(aud(810_000), { approx: true })).toBe("about A$810,000");
  });
});

describe("aud", () => {
  it("rejects negative amounts", () => {
    expect(() => aud(-1)).toThrow(RangeError);
  });

  it("rejects fractional amounts", () => {
    expect(() => aud(10.5)).toThrow(RangeError);
  });
});
