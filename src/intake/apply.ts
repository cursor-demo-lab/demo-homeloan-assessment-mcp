import type { Applicant, Application } from "@/domain/application";
import { MIA_AND_DAN_AFTER_CALL, toCheckFor } from "@/domain/fixtures/mia-and-dan";
import { aud } from "@/domain/money";
import type { IntakeFields, IntakeKey } from "./fields";
import { INTAKE_FILE, INTAKE_KEYS } from "./fields";

const APPLICANT_KEYS = [
  { name: "applicant_1_name", work: "applicant_1_employment", income: "applicant_1_income" },
  { name: "applicant_2_name", work: "applicant_2_employment", income: "applicant_2_income" },
] as const;

function withAnswers(
  applicant: Applicant,
  keys: (typeof APPLICANT_KEYS)[number] | undefined,
  fields: IntakeFields,
): Applicant {
  const work = keys && fields[keys.work];
  const income = keys && fields[keys.income];
  const { employment, annualIncome } = applicant;
  return {
    ...applicant,
    ...(keys && fields[keys.name]),
    ...(work && {
      employment: { ...employment, value: { ...work, yearsInRole: employment.value.yearsInRole } },
    }),
    ...(income !== undefined && { annualIncome: { ...annualIncome, value: income } }),
  };
}

/** The keys among `keys` that the call captured, in the app's order. */
export function capturedOf(
  fields: IntakeFields,
  keys: readonly IntakeKey[] = INTAKE_KEYS,
): IntakeKey[] {
  return INTAKE_KEYS.filter((key) => keys.includes(key) && fields[key] !== undefined);
}

/**
 * The file with the call's answers in place of the script's, field by field. Anything the
 * call didn't capture keeps the scripted value, and with no answers the file is unchanged.
 */
export function applyIntake(application: Application, fields: IntakeFields): Application {
  if (application.reference !== INTAKE_FILE || capturedOf(fields).length === 0) {
    return application;
  }
  const [primary, ...others] = application.applicants;
  const applicants: Application["applicants"] = [
    withAnswers(primary, APPLICANT_KEYS[0], fields),
    ...others.map((applicant, index) => withAnswers(applicant, APPLICANT_KEYS[index + 1], fields)),
  ];
  const { goal, commitments } = application;
  const price = fields.purchase_price ?? goal.purchasePrice.value;
  const deposit = fields.deposit ?? goal.deposit.value;
  const renamed = fields.applicant_1_name !== undefined || fields.applicant_2_name !== undefined;
  const [first, second] = applicants.map((applicant) => applicant.firstName);

  return {
    ...application,
    applicants,
    ...(fields.declared_debts && { commitments: { ...commitments, value: fields.declared_debts } }),
    goal: {
      ...goal,
      ...(fields.first_home !== undefined && { firstHomeBuyers: fields.first_home }),
      ...(fields.target_area !== undefined && { targetArea: fields.target_area }),
      purchasePrice: { ...goal.purchasePrice, value: price },
      deposit: { ...goal.deposit, value: deposit },
      ...((fields.purchase_price !== undefined || fields.deposit !== undefined) && {
        loanAmountSought: aud(price - deposit),
      }),
    },
    ...(renamed &&
      first !== undefined &&
      second !== undefined && { toCheck: toCheckFor(first, second) }),
  };
}

/** False when the deposit would be more than the price, once the script fills in either. */
export function fitsTheFile(fields: IntakeFields): boolean {
  const { goal } = MIA_AND_DAN_AFTER_CALL;
  return (
    (fields.deposit ?? goal.deposit.value) <= (fields.purchase_price ?? goal.purchasePrice.value)
  );
}
