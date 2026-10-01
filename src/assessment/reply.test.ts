import { describe, expect, it } from "vitest";
import { currentStage } from "@/domain/application";
import { visitsTo } from "@/domain/visits";
import { answered, assessed, landed, reassessed } from "./journey.fixture";
import { afterTheReply, asTheCallLandsIt } from "./reply";

describe("afterTheReply", () => {
  it("takes the file as the call lands it to its second visit to Credit Assessment, as the journey does", () => {
    const replied = afterTheReply(landed);
    expect(replied).toStrictEqual(answered);
    expect(currentStage(replied)).toBe("credit-assessment");
    expect(visitsTo(replied, "credit-assessment")).toBe(2);
  });
});

describe("asTheCallLandsIt", () => {
  it("holds only on the file's first visit to Credit Assessment", () => {
    expect(
      [landed, assessed, answered, reassessed].map((file) => asTheCallLandsIt(file)),
    ).toStrictEqual([true, false, false, false]);
  });
});
