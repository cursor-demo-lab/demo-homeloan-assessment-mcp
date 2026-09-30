import type { StageView } from "@/domain/access";
import { viewFor } from "@/domain/access";
import type { Application, IdentityCheck } from "@/domain/application";
import { formatAud } from "@/domain/money";
import { visitsTo } from "@/domain/visits";

export interface AssessmentDocument {
  readonly id: string;
  readonly title: string;
  readonly shows: string;
  readonly verifies: readonly string[];
}

export interface Person {
  readonly firstName: string;
  readonly slug: string;
  readonly identity: IdentityCheck;
  readonly income: StageView<"credit-assessment">["income"][number];
}

/** The slug comes from the applicant's id, so a name the call changes keeps every id. */
export function peopleOn(view: StageView<"credit-assessment">): readonly Person[] {
  return view.identity.flatMap(({ id, firstName, identity }) =>
    view.income
      .filter((income) => income.id === id)
      .map((income) => ({ firstName, slug: id.replace(/^applicant-/u, ""), identity, income })),
  );
}

/** What the call declared, or "None". */
export function statedDebts(view: StageView<"credit-assessment">): string {
  const debts = view.commitments.value.map(
    ({ kind, description, limitOrBalance }) =>
      `${description} (${formatAud(limitOrBalance)} ${kind === "credit-card" ? "limit" : "balance"})`,
  );
  return debts.length > 0 ? debts.join(", ") : "None";
}

/** The declared debts, then `more`: "Credit card (A$8,000 limit), and an Afterpay account". */
export function debtsAnd(
  view: StageView<"credit-assessment">,
  more: string,
  joiner = ", and ",
): string {
  return view.commitments.value.length > 0
    ? `${statedDebts(view)}${joiner}${more}`
    : `${more.charAt(0).toUpperCase()}${more.slice(1)}`;
}

/** "A, B and C". */
const listed = (items: readonly string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items.join("");

export function afterpayClosed(application: Application): boolean {
  return visitsTo(application, "credit-assessment") > 1;
}

export function documentsOnFile(application: Application): readonly AssessmentDocument[] {
  const view = viewFor("credit-assessment", application);
  const closed = afterpayClosed(application);
  const people = peopleOn(view);
  const repayments = view.commitments.value.map(({ description }) => description.toLowerCase());

  return [
    ...people.map(({ firstName, slug, income }) => ({
      id: `doc-payslips-${slug}`,
      title: `${firstName}'s payslips, ${income.employment.value.employer}`,
      shows: `Income of ${formatAud(income.annualIncome.value, { approx: true })} a year, as stated on the call`,
      verifies: [`income-${slug}`],
    })),
    ...people
      .filter(({ identity }) => identity.status === "pending")
      .map(({ firstName, slug }) => ({
        id: `doc-id-consent-${slug}`,
        title: `${firstName}'s ID and credit-check consent, uploaded`,
        shows: `Photo ID and a signed consent to a credit check, uploaded by ${firstName}`,
        verifies: [`identity-${slug}`, `consent-${slug}`],
      })),
    {
      id: "doc-bank-statements",
      title: "Three months of joint bank statements",
      shows: listed([
        "Day-to-day spending",
        ...repayments.map((debt) => `${debt} repayments`),
        "Afterpay repayments",
      ]),
      verifies: ["living-expenses", "debts-and-commitments"],
    },
    {
      id: "doc-savings-statement",
      title: "Savings statement",
      shows: `Savings of ${formatAud(view["property-goal"].deposit.value)}, the deposit stated on the call`,
      verifies: ["deposit-savings"],
    },
    {
      id: "doc-credit-report",
      title: "Credit report",
      shows: debtsAnd(view, `an Afterpay account, ${closed ? "closed" : "open"}`),
      verifies: ["debts-and-commitments"],
    },
    ...(closed
      ? [
          {
            id: "doc-afterpay-closure",
            title: "Afterpay closure letter",
            shows: "The Afterpay account is closed",
            verifies: ["debts-and-commitments"],
          },
        ]
      : []),
  ];
}
