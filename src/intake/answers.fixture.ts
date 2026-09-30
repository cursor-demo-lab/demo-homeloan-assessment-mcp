import type { IntakeInput } from "./fields";

/** What the app posts when the call follows Mia's script: today's scripted values exactly. */
export const SCRIPTED_ANSWERS = {
  applicant_1_name: "Mia Castellano",
  applicant_1_employment: "Physiotherapist, full time, Merri Creek Physiotherapy",
  applicant_1_income: "A$112,000 a year",
  applicant_2_name: "Dan Okafor",
  applicant_2_employment: "Secondary school teacher, full time, Coburg Hills College",
  applicant_2_income: "A$98,000 a year",
  target_area: "Coburg, VIC",
  purchase_price: "A$950,000",
  deposit: "A$160,000",
  first_home: "Yes",
  declared_debts: "Credit card, A$8,000 limit, A$240 a month",
} as const satisfies Required<IntakeInput>;

/**
 * A different call. 4 × A$270,000 − 125 × A$900 = A$967,500, so about A$970,000 before the
 * Afterpay commitment and A$920,000 with it, against A$900,000 needed: it no longer falls short.
 */
export const VARIED_ANSWERS = {
  applicant_1_name: "Sofia Reyes",
  applicant_1_employment: "Nurse, part time, Northern Health",
  applicant_1_income: "A$150,000 a year",
  applicant_2_name: "Tom Nguyen",
  applicant_2_employment: "Electrician, self employed, Nguyen Electrical",
  applicant_2_income: "A$120,000 a year",
  target_area: "Brunswick, VIC",
  purchase_price: "A$1,100,000",
  deposit: "A$200,000",
  first_home: "No",
  declared_debts:
    "Credit card, A$10,000 limit, A$300 a month; Car loan, A$30,000 limit, A$600 a month",
} as const satisfies Required<IntakeInput>;

export const CAPTURED_AT = "2026-10-12T19:47:00+11:00";

export const intakeOf = (fields: IntakeInput) => ({
  applicationId: "HL-26-104471",
  capturedAt: CAPTURED_AT,
  fields,
});
