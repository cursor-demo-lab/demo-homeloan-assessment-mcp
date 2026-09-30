import { z } from "zod";
import type { Commitment, Employment } from "@/domain/application";
import type { Aud } from "@/domain/money";
import { aud, formatAud } from "@/domain/money";

/** The one file the app's call writes answers to. */
export const INTAKE_FILE = "HL-26-104471";

/** The app's call-field keys, in the app's order. */
export const INTAKE_KEYS = [
  "applicant_1_name",
  "applicant_1_employment",
  "applicant_1_income",
  "applicant_2_name",
  "applicant_2_employment",
  "applicant_2_income",
  "target_area",
  "purchase_price",
  "deposit",
  "first_home",
  "declared_debts",
] as const;
export type IntakeKey = (typeof INTAKE_KEYS)[number];

const MAX_LENGTH = 200;
const MAX_DEBTS = 5;
const CAPS = {
  income: aud(2_000_000),
  price: aud(20_000_000),
  limit: aud(5_000_000),
  repayment: aud(50_000),
} as const;

/** Exactly what `formatAud` prints, so "A$1234" and "A$1,234.00" don't pass. */
const MONEY = /^A\$(?<dollars>0|[1-9]\d{0,2}(?:,\d{3})*)$/u;

function money(text: string, cap: Aud): Aud | undefined {
  const dollars = MONEY.exec(text)?.groups?.["dollars"];
  if (dollars === undefined) {
    return undefined;
  }
  const amount = Number(dollars.replaceAll(",", ""));
  return amount <= cap ? aud(amount) : undefined;
}

const NAME_PART = String.raw`\p{L}+(?:['’-]\p{L}+)*`;
const NAME = new RegExp(`^(?<first>${NAME_PART}) (?<last>${NAME_PART}(?: ${NAME_PART})*)$`, "u");
const WORDS = /^[\p{L}\p{N}](?:[\p{L}\p{N}&'’()./-]| (?! ))*$/u;

function words(text: string, max: number): string | undefined {
  return text.length <= max && WORDS.test(text) && !text.endsWith(" ") ? text : undefined;
}

const BASES = {
  "full time": "full-time",
  "part time": "part-time",
  casual: "casual",
  "self employed": "self-employed",
} as const satisfies Record<string, Employment["basis"]>;

const STATES = new Set(["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]);

const KINDS: readonly (readonly [RegExp, Commitment["kind"]])[] = [
  [/credit card/iu, "credit-card"],
  [/car loan/iu, "car-loan"],
  [/personal loan/iu, "personal-loan"],
  [/\b(?:hecs|help)\b/iu, "hecs-help"],
  [/afterpay|buy now,? pay later/iu, "buy-now-pay-later"],
];

const kindOf = (description: string): Commitment["kind"] =>
  KINDS.find(([pattern]) => pattern.test(description))?.[1] ?? "personal-loan";

export interface Name {
  readonly firstName: string;
  readonly lastName: string;
}

export type Work = Omit<Employment, "yearsInRole">;

function name(text: string): Name | undefined {
  const groups = text.length <= 60 ? NAME.exec(text)?.groups : undefined;
  const firstName = groups?.["first"];
  const lastName = groups?.["last"];
  return firstName === undefined || lastName === undefined ? undefined : { firstName, lastName };
}

function work(text: string): Work | undefined {
  const [occupation, basis, employer, ...rest] = text.split(", ");
  if (
    occupation === undefined ||
    employer === undefined ||
    rest.length > 0 ||
    !Object.hasOwn(BASES, basis ?? "")
  ) {
    return undefined;
  }
  const checked = { occupation: words(occupation, 60), employer: words(employer, 80) };
  return checked.occupation === undefined || checked.employer === undefined
    ? undefined
    : {
        basis: BASES[basis as keyof typeof BASES],
        occupation: checked.occupation,
        employer: checked.employer,
      };
}

function income(text: string): Aud | undefined {
  return text.endsWith(" a year")
    ? money(text.slice(0, -" a year".length), CAPS.income)
    : undefined;
}

function area(text: string): string | undefined {
  const [suburb, state, ...rest] = text.split(", ");
  return suburb !== undefined &&
    rest.length === 0 &&
    STATES.has(state ?? "") &&
    /^\p{L}+(?:[ '’-]\p{L}+)*$/u.test(suburb) &&
    suburb.length <= 40
    ? text
    : undefined;
}

const DEBT =
  /^(?<description>[^,;]+), (?<limit>A\$[\d,]+) limit, (?<repayment>A\$[\d,]+) a month$/u;

function debt(text: string): Commitment | undefined {
  const groups = DEBT.exec(text)?.groups;
  const description = words(groups?.["description"] ?? "", 40);
  const limit = money(groups?.["limit"] ?? "", CAPS.limit);
  const repayment = money(groups?.["repayment"] ?? "", CAPS.repayment);
  return description === undefined || limit === undefined || repayment === undefined
    ? undefined
    : {
        kind: kindOf(description),
        description,
        limitOrBalance: limit,
        monthlyRepayment: repayment,
      };
}

function debts(text: string): readonly Commitment[] | undefined {
  if (text === "None") {
    return [];
  }
  const parts = text.split("; ");
  const parsed = parts.map((part) => debt(part)).filter((item) => item !== undefined);
  return parts.length <= MAX_DEBTS && parsed.length === parts.length ? parsed : undefined;
}

function firstHome(text: string): boolean | undefined {
  return { Yes: true, No: false }[text];
}

/** A display-format string, parsed. The message names the format, never the value sent. */
const display = <T>(parse: (text: string) => T | undefined, expected: string) =>
  z
    .string()
    .max(MAX_LENGTH)
    .transform((text, context) => {
      const parsed = parse(text);
      if (parsed === undefined) {
        context.addIssue({ code: "custom", message: `Expected ${expected}.` });
        return z.NEVER;
      }
      return parsed;
    })
    .optional();

const FIELDS = {
  name: display(name, 'a first and last name, like "Mia Castellano"'),
  work: display(
    work,
    'occupation, basis and employer, like "Physiotherapist, full time, Merri Creek Physiotherapy"',
  ),
  income: display(
    income,
    `a yearly income like "A$112,000 a year", up to ${formatAud(CAPS.income)}`,
  ),
  price: display(
    (text) => money(text, CAPS.price),
    `an amount like "A$950,000", up to ${formatAud(CAPS.price)}`,
  ),
} as const;

export const intakeFields = z.strictObject({
  applicant_1_name: FIELDS.name,
  applicant_1_employment: FIELDS.work,
  applicant_1_income: FIELDS.income,
  applicant_2_name: FIELDS.name,
  applicant_2_employment: FIELDS.work,
  applicant_2_income: FIELDS.income,
  target_area: display(area, 'a suburb and state, like "Coburg, VIC"'),
  purchase_price: FIELDS.price,
  deposit: FIELDS.price,
  first_home: display(firstHome, '"Yes" or "No"'),
  declared_debts: display(
    debts,
    `"None", or up to ${MAX_DEBTS} debts like "Credit card, A$8,000 limit, A$240 a month" separated by "; "`,
  ),
} satisfies Record<IntakeKey, z.ZodType>);

/** The answers the call captured, parsed. A missing key means the call didn't capture it. */
export type IntakeFields = z.output<typeof intakeFields>;
export type IntakeInput = z.input<typeof intakeFields>;

const capturedAt = z.iso.datetime({ offset: true });

/** `POST /api/intake`. */
export const intakeBody = z.strictObject({
  applicationId: z.literal(INTAKE_FILE),
  capturedAt,
  fields: intakeFields,
});

/** `DELETE /api/intake`. */
export const resetBody = z.strictObject({ applicationId: z.literal(INTAKE_FILE) });

/** What the store keeps: the answers as the app sent them, re-checked on every read. */
export const storedIntake = z.strictObject({ capturedAt, fields: intakeFields });
export type StoredIntake = z.input<typeof storedIntake>;
