import { aud } from "./money";

/**
 * The only borrowing figures the demo script quotes. The indicative formula gives exactly
 * these from the script's answers, and there is deliberately no re-checked figure after the
 * Afterpay account closes.
 */
export const SCRIPT_FIGURES = {
  borrowingBeforeAfterpay: {
    amount: aud(810_000),
    label: "Indicative borrowing, before the Afterpay commitment is found",
  },
  borrowingAfterAfterpay: {
    amount: aud(760_000),
    label: "Indicative borrowing, after the Afterpay commitment is found",
  },
  amountNeeded: { amount: aud(790_000), label: "What the couple need" },
} as const;
