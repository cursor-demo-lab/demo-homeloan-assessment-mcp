import { describe, expect, it } from "vitest";
import { answered, landed } from "@/assessment/journey.fixture";
import { indicativeBorrowing } from "@/assessment/serviceability";
import { SCRIPT_FIGURES } from "@/domain/figures";
import { MIA_AND_DAN_AFTER_CALL } from "@/domain/fixtures/mia-and-dan";
import { SCRIPTED_ANSWERS, VARIED_ANSWERS } from "./answers.fixture";
import { applyIntake, capturedOf, changesTheFigures, fitsTheFile } from "./apply";
import type { IntakeFields } from "./fields";
import { INTAKE_KEYS, intakeFields } from "./fields";

const parsed = (fields: object): IntakeFields => intakeFields.parse(fields);

describe("applyIntake", () => {
  it("leaves the file as it is when the call follows the script", () => {
    expect(applyIntake(landed, parsed(SCRIPTED_ANSWERS))).toStrictEqual(landed);
    expect(applyIntake(answered, parsed(SCRIPTED_ANSWERS))).toStrictEqual(answered);
  });

  it("returns the same file when the call captured nothing", () => {
    expect(applyIntake(landed, {})).toBe(landed);
  });

  it("puts every answer from a different call in place of the script's", () => {
    const file = applyIntake(landed, parsed(VARIED_ANSWERS));
    const [sofia, tom] = file.applicants;
    expect(sofia).toMatchObject({
      id: "applicant-mia",
      firstName: "Sofia",
      lastName: "Reyes",
      mobile: landed.applicants[0].mobile,
      employment: {
        status: "stated",
        source: "voice-call",
        value: {
          basis: "part-time",
          occupation: "Nurse",
          employer: "Northern Health",
          yearsInRole: 6,
        },
      },
      annualIncome: { status: "stated", source: "voice-call", value: 150_000 },
    });
    expect(tom).toMatchObject({
      id: "applicant-dan",
      firstName: "Tom",
      lastName: "Nguyen",
      employment: {
        value: { basis: "self-employed", occupation: "Electrician", employer: "Nguyen Electrical" },
      },
      annualIncome: { value: 120_000 },
      identity: { status: "pending" },
    });
    expect(file.commitments).toStrictEqual({
      status: "stated",
      source: "voice-call",
      value: [
        {
          kind: "credit-card",
          description: "Credit card",
          limitOrBalance: 10_000,
          monthlyRepayment: 300,
        },
        {
          kind: "car-loan",
          description: "Car loan",
          limitOrBalance: 30_000,
          monthlyRepayment: 600,
        },
      ],
    });
    expect(file.goal).toStrictEqual({
      ...landed.goal,
      firstHomeBuyers: false,
      targetArea: "Brunswick, VIC",
      purchasePrice: { ...landed.goal.purchasePrice, value: 1_100_000 },
      deposit: { ...landed.goal.deposit, value: 200_000 },
      loanAmountSought: 900_000,
    });
    expect(file.audit).toBe(landed.audit);
  });

  it("rewords what's to check with the new names, and keeps every id", () => {
    const file = applyIntake(landed, parsed({ applicant_2_name: "Tom Nguyen" }));
    expect(file.toCheck.map(({ id }) => id)).toStrictEqual(landed.toCheck.map(({ id }) => id));
    expect(file.toCheck.map(({ label }) => label).slice(0, 4)).toStrictEqual([
      "Mia's income",
      "Tom's income",
      "Tom's identity",
      "Tom's consent",
    ]);
    expect(file.toCheck[1]?.reason).toBe(
      "Mia stated Tom's income on the call, so his payslips need to confirm it.",
    );
  });

  it("keeps the script's value for anything the call didn't capture", () => {
    const file = applyIntake(landed, parsed({ applicant_2_income: "A$60,000 a year" }));
    const [mia, dan] = landed.applicants;
    expect(file).toStrictEqual({
      ...landed,
      applicants: [mia, { ...dan, annualIncome: { ...dan?.annualIncome, value: 60_000 } }],
    });
  });

  it("reads 'None' as no debts", () => {
    expect(applyIntake(landed, parsed({ declared_debts: "None" })).commitments.value).toStrictEqual(
      [],
    );
  });

  it.each([
    ["Credit card", "credit-card"],
    ["Car loan", "car-loan"],
    ["Personal loan", "personal-loan"],
    ["HECS debt", "hecs-help"],
    ["HELP loan", "hecs-help"],
    ["Afterpay", "buy-now-pay-later"],
    ["Buy now pay later", "buy-now-pay-later"],
    ["Boat finance", "personal-loan"],
  ])("files a %s as %s", (description, kind) => {
    const file = applyIntake(
      landed,
      parsed({ declared_debts: `${description}, A$1,000 limit, A$50 a month` }),
    );
    expect(file.commitments.value[0]?.kind).toBe(kind);
  });

  it("only changes the file the app's call writes to", () => {
    const other = { ...landed, reference: "HL-26-000000" };
    expect(applyIntake(other, parsed(VARIED_ANSWERS))).toBe(other);
  });
});

describe("capturedOf", () => {
  it("lists the captured keys among those asked for, in the app's order", () => {
    const fields = parsed({ deposit: "A$1", applicant_1_name: "Sofia Reyes", first_home: "No" });
    expect(capturedOf(fields)).toStrictEqual(["applicant_1_name", "deposit", "first_home"]);
    expect(capturedOf(fields, ["first_home", "purchase_price", "deposit"])).toStrictEqual([
      "deposit",
      "first_home",
    ]);
    expect(capturedOf(parsed(SCRIPTED_ANSWERS))).toStrictEqual([...INTAKE_KEYS]);
  });
});

describe("changesTheFigures", () => {
  it.each([
    ["the script's answers", SCRIPTED_ANSWERS, false],
    ["nothing", {}, false],
    ["only the script's deposit", { deposit: "A$160,000" }, false],
    [
      "the script's figures with other names, work, area and first home",
      {
        ...SCRIPTED_ANSWERS,
        applicant_1_name: "Sofia Reyes",
        applicant_2_employment: "Electrician, self employed, Nguyen Electrical",
        target_area: "Brunswick, VIC",
        first_home: "No",
      },
      false,
    ],
    ["another income", { ...SCRIPTED_ANSWERS, applicant_2_income: "A$99,000 a year" }, true],
    ["another price", { purchase_price: "A$960,000" }, true],
    ["another deposit", { ...SCRIPTED_ANSWERS, deposit: "A$150,000" }, true],
    ["another repayment", { declared_debts: "Credit card, A$8,000 limit, A$250 a month" }, true],
    ["another debt", { declared_debts: "Car loan, A$8,000 limit, A$240 a month" }, true],
    ["no debts", { declared_debts: "None" }, true],
    ["every answer from a different call", VARIED_ANSWERS, true],
  ])("with %s: %s", (_label, fields, changes) => {
    expect(changesTheFigures(landed, parsed(fields))).toBe(changes);
    expect(changesTheFigures(answered, parsed(fields))).toBe(changes);
  });
});

describe("fitsTheFile", () => {
  it.each([
    [{}, true],
    [{ deposit: "A$950,000" }, true],
    [{ deposit: "A$950,001" }, false],
    [{ purchase_price: "A$160,000" }, true],
    [{ purchase_price: "A$159,999" }, false],
    [{ purchase_price: "A$500,000", deposit: "A$600,000" }, false],
  ])("%j fits: %s", (fields, fits) => {
    expect(fitsTheFile(parsed(fields))).toBe(fits);
  });
});

describe("the script's answers through the formula", () => {
  it("give the script's figures exactly", () => {
    expect(
      indicativeBorrowing(applyIntake(MIA_AND_DAN_AFTER_CALL, parsed(SCRIPTED_ANSWERS))),
    ).toStrictEqual({
      beforeAfterpay: SCRIPT_FIGURES.borrowingBeforeAfterpay.amount,
      withAfterpay: SCRIPT_FIGURES.borrowingAfterAfterpay.amount,
      amountNeeded: SCRIPT_FIGURES.amountNeeded.amount,
    });
  });
});
