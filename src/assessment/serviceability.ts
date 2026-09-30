import { viewFor } from "@/domain/access";
import type { Application } from "@/domain/application";
import { SCRIPT_FIGURES } from "@/domain/figures";
import type { Aud } from "@/domain/money";
import { formatAud } from "@/domain/money";
import { afterpayClosed } from "./documents";

export const INDICATIVE = "Indicative, not lender policy";
export const BASIS = "The demo script's figures. Nothing is calculated.";

export interface IndicativeServiceability {
  readonly label: typeof INDICATIVE;
  readonly basis: typeof BASIS;
  readonly amountNeeded: number;
  readonly beforeAfterpay: number | null;
  readonly withAfterpay: number | null;
  readonly fallsShort: boolean;
  readonly summary: string;
}

const about = (amount: Aud) => formatAud(amount, { approx: true });

export function indicativeServiceability(application: Application): IndicativeServiceability {
  const names = viewFor("credit-assessment", application)
    .identity.map((applicant) => applicant.firstName)
    .join(" and ");
  const needed = SCRIPT_FIGURES.amountNeeded.amount;
  const labelled = { label: INDICATIVE, basis: BASIS, amountNeeded: needed } as const;

  if (afterpayClosed(application)) {
    return {
      ...labelled,
      beforeAfterpay: null,
      withAfterpay: null,
      fallsShort: false,
      summary: `Without the Afterpay commitment, the indicative borrowing no longer falls short of what ${names} need (${about(needed)}). ${INDICATIVE}.`,
    };
  }
  const before = SCRIPT_FIGURES.borrowingBeforeAfterpay.amount;
  const withAfterpay = SCRIPT_FIGURES.borrowingAfterAfterpay.amount;
  return {
    ...labelled,
    beforeAfterpay: before,
    withAfterpay,
    fallsShort: true,
    summary: `Indicative borrowing is ${about(before)} before the Afterpay commitment and ${about(withAfterpay)} with it, which falls short of what ${names} need (${about(needed)}). ${INDICATIVE}.`,
  };
}
