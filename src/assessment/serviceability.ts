import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import type { Aud } from "@/domain/money";
import { aud, formatAud } from "@/domain/money";
import { afterpayClosed } from "./documents";

export const INDICATIVE = "Indicative, not lender policy";
export const BASIS = "The demo script's figures. Nothing is calculated.";
export const CALL_BASIS =
  "Worked out from the call's answers, with the demo script's values for anything the call didn't capture.";

/** What the Afterpay account on the documents takes off. No Afterpay amount is ever quoted. */
const AFTERPAY_EFFECT = 50_000;

export interface Borrowing {
  readonly beforeAfterpay: Aud;
  readonly withAfterpay: Aud;
  readonly amountNeeded: Aud;
}

const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);

/**
 * 4 × the couple's yearly income, less 125 × their declared monthly repayments, to the nearest
 * A$10,000 and never below 0. The script's answers give its figures exactly.
 */
export function indicativeBorrowing(application: Application): Borrowing {
  const view = viewFor("credit-assessment", application);
  const income = sum(view.income.map(({ annualIncome }) => annualIncome.value));
  const monthly = sum(view.commitments.value.map(({ monthlyRepayment }) => monthlyRepayment));
  const before = Math.max(0, Math.round((4 * income - 125 * monthly) / 10_000) * 10_000);
  return {
    beforeAfterpay: aud(before),
    withAfterpay: aud(Math.max(0, before - AFTERPAY_EFFECT)),
    amountNeeded: view["property-goal"].loanAmountSought,
  };
}

export interface IndicativeServiceability {
  readonly label: typeof INDICATIVE;
  readonly basis: typeof BASIS | typeof CALL_BASIS;
  readonly amountNeeded: number;
  readonly beforeAfterpay: number | null;
  readonly withAfterpay: number | null;
  readonly fallsShort: boolean;
  readonly summary: string;
}

const about = (amount: Aud) => formatAud(amount, { approx: true });

export function firstNamesOf(application: Application): string {
  return viewFor("credit-assessment", application)
    .identity.map((applicant) => applicant.firstName)
    .join(" and ");
}

export function indicativeServiceability(
  application: Application,
  { figuresChanged = false }: { readonly figuresChanged?: boolean } = {},
): IndicativeServiceability {
  const names = firstNamesOf(application);
  const { beforeAfterpay, withAfterpay, amountNeeded } = indicativeBorrowing(application);
  const labelled = {
    label: INDICATIVE,
    basis: figuresChanged ? CALL_BASIS : BASIS,
    amountNeeded,
  } as const;
  const need = `${names} need (${about(amountNeeded)}). ${INDICATIVE}.`;

  if (afterpayClosed(application)) {
    const fallsShort = beforeAfterpay < amountNeeded;
    return {
      ...labelled,
      beforeAfterpay: null,
      withAfterpay: null,
      fallsShort,
      summary: fallsShort
        ? `Even without the Afterpay commitment, the indicative borrowing falls short of what ${need}`
        : `Without the Afterpay commitment, the indicative borrowing no longer falls short of what ${need}`,
    };
  }
  const fallsShort = withAfterpay < amountNeeded;
  return {
    ...labelled,
    beforeAfterpay,
    withAfterpay,
    fallsShort,
    summary: `Indicative borrowing is ${about(beforeAfterpay)} before the Afterpay commitment and ${about(withAfterpay)} with it, which ${fallsShort ? "falls short of" : "covers"} what ${need}`,
  };
}
