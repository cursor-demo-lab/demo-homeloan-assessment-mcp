import { MIA_AND_DAN_AFTER_CALL } from "@/domain/fixtures/mia-and-dan";
import { creditAssessmentEvents } from "./credit-assessment-bot";
import { closeAfterpay, sendBack, withEvents } from "./reply";

/** Mia and Dan through the demo's loop: more info, the Afterpay account closed, then the re-check. */
export const landed = MIA_AND_DAN_AFTER_CALL;
export const assessed = withEvents(landed, creditAssessmentEvents(landed));
export const answered = closeAfterpay(sendBack(assessed));
export const reassessed = withEvents(answered, creditAssessmentEvents(answered));
