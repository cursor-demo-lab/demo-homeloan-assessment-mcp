import { describe, expect, it } from "vitest";
import { viewFor } from "./access";
import { MIA_AND_DAN_AFTER_CALL } from "./fixtures/mia-and-dan";
import { STAGES } from "./stages";

const app = MIA_AND_DAN_AFTER_CALL;
const [mia] = app.applicants;

describe("viewFor", () => {
  it("gives each stage only the sections it is granted", () => {
    for (const stage of STAGES) {
      const allowed = new Set<string>(["id", ...stage.dataAccess]);
      for (const key of Object.keys(viewFor(stage.id, app))) {
        expect(allowed.has(key), `${stage.id} sees ${key}`).toBe(true);
      }
    }
  });

  it("keeps Mia's phone and email away from credit assessment and credit decision", () => {
    for (const stage of ["credit-assessment", "credit-decision"] as const) {
      const view = JSON.stringify(viewFor(stage, app));
      expect(view).not.toContain(mia.mobile);
      expect(view).not.toContain(mia.email);
    }
  });

  it("shows the assessor the applicants' names and earlier decisions", () => {
    const view = viewFor("credit-decision", app);
    expect(view.identity.map((person) => person.firstName)).toStrictEqual(["Mia", "Dan"]);
    expect(view.decision).toStrictEqual([]);
  });

  it("gives voice intake the decision history, since more info and decline loop back to it", () => {
    expect(viewFor("voice-intake", app)).toHaveProperty("decision");
  });
});
