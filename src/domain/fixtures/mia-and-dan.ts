import type {
  Applicant,
  ApplicantId,
  Application,
  ApplicationId,
  AuditEvent,
  AuditEventId,
  IsoDateTime,
} from "../application";
import { SCRIPT_FIGURES } from "../figures";
import { aud } from "../money";
import { STAFF } from "../people";

function applicationId(id: string): ApplicationId {
  return id as ApplicationId;
}

function applicantId(id: string): ApplicantId {
  return id as ApplicantId;
}

/** Monday evening, after the home loan phone line closes at 7pm. */
const CALL_STARTED_AT: IsoDateTime = "2026-10-12T19:42:00+11:00";

/** Keeps the call's own UTC offset so every call-time stamp moves with `CALL_STARTED_AT`. */
function minutesAfterCall(minutes: number): IsoDateTime {
  const start = CALL_STARTED_AT;
  const offset = start.slice(-6);
  const sign = offset.startsWith("-") ? -1 : 1;
  const offsetMs = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60_000;
  const local = new Date(Date.parse(start) + minutes * 60_000 + offsetMs);
  return `${local.toISOString().slice(0, 19)}${offset}`;
}

export const MIA: Applicant = {
  id: applicantId("applicant-mia"),
  role: "primary",
  firstName: "Mia",
  lastName: "Castellano",
  mobile: "0491 570 156",
  email: "mia.castellano@example.com",
  employment: {
    status: "stated",
    source: "voice-call",
    value: {
      basis: "full-time",
      occupation: "Physiotherapist",
      employer: "Merri Creek Physiotherapy",
      yearsInRole: 6,
    },
  },
  annualIncome: { status: "stated", source: "voice-call", value: aud(112_000) },
  identity: { status: "verified", method: "sms-code", at: minutesAfterCall(2) },
  consent: {
    status: "given",
    scope: "credit-check",
    channel: "voice-call",
    at: minutesAfterCall(3),
  },
};

export const DAN: Applicant = {
  id: applicantId("applicant-dan"),
  role: "co-applicant",
  firstName: "Dan",
  lastName: "Okafor",
  mobile: "0491 570 157",
  email: "dan.okafor@example.com",
  employment: {
    status: "stated",
    source: "voice-call",
    value: {
      basis: "full-time",
      occupation: "Secondary school teacher",
      employer: "Coburg Hills College",
      yearsInRole: 4,
    },
  },
  annualIncome: { status: "stated", source: "voice-call", value: aud(98_000) },
  identity: { status: "pending" },
  consent: { status: "pending" },
};

const APPLICATION_ID = applicationId("app-mia-dan");

type WithoutIds<E> = E extends AuditEvent ? Omit<E, "id" | "applicationId"> : never;
type EventFields = WithoutIds<AuditEvent>;

function event(sequence: number, fields: EventFields): AuditEvent {
  return {
    ...fields,
    id: `${APPLICATION_ID}-${String(sequence).padStart(2, "0")}` as AuditEventId,
    applicationId: APPLICATION_ID,
  };
}

/** Mia and Dan's application as the call lands it: at Credit Assessment, on its first visit. */
export const MIA_AND_DAN_AFTER_CALL: Application = {
  id: APPLICATION_ID,
  reference: "HL-26-104471",
  applicants: [MIA, DAN],
  household: { relationship: "partners", dependants: 0 },
  commitments: {
    status: "stated",
    source: "voice-call",
    value: [
      {
        kind: "credit-card",
        description: "Credit card",
        limitOrBalance: aud(8000),
        monthlyRepayment: aud(240),
      },
    ],
  },
  goal: {
    purpose: "owner-occupier",
    firstHomeBuyers: true,
    targetArea: "Coburg, VIC",
    purchasePrice: { status: "stated", source: "voice-call", value: aud(950_000) },
    deposit: { status: "stated", source: "voice-call", value: aud(160_000) },
    loanAmountSought: SCRIPT_FIGURES.amountNeeded.amount,
  },
  appointment: {
    hle: STAFF.sarah.id,
    mode: "video",
    startsAt: "2026-10-14T12:30:00+11:00",
    confirmationSentBy: "sms",
  },
  callStartedAt: CALL_STARTED_AT,
  toCheck: [
    {
      id: "income-mia",
      label: "Mia's income",
      reason: "Mia stated her income on the call, so her payslips need to confirm it.",
      checkedAt: "credit-assessment",
    },
    {
      id: "income-dan",
      label: "Dan's income",
      reason: "Mia stated Dan's income on the call, so his payslips need to confirm it.",
      checkedAt: "credit-assessment",
    },
    {
      id: "identity-dan",
      label: "Dan's identity",
      reason: "Dan was not on the call, so his identity is checked when he uploads his documents.",
      checkedAt: "credit-assessment",
    },
    {
      id: "consent-dan",
      label: "Dan's consent",
      reason: "Dan gives his own consent to a credit check when he uploads his documents.",
      checkedAt: "credit-assessment",
    },
    {
      id: "living-expenses",
      label: "Living expenses",
      reason: "The call did not cover day-to-day spending, so bank statements need to show it.",
      checkedAt: "credit-assessment",
    },
    {
      id: "debts-and-commitments",
      label: "All debts and commitments",
      reason:
        "Only what Mia mentioned on the call is recorded, so bank statements need to show every debt.",
      checkedAt: "credit-assessment",
    },
    {
      id: "deposit-savings",
      label: "Deposit savings",
      reason:
        "The deposit was stated on the call, so account statements need to confirm the savings.",
      checkedAt: "credit-assessment",
    },
  ],
  audit: [
    event(1, { kind: "stage-entered", at: minutesAfterCall(0), stage: "voice-intake" }),
    event(2, {
      kind: "bot-output",
      at: minutesAfterCall(0),
      stage: "voice-intake",
      summary: "Said it is a virtual assistant and that Mia can ask for a person at any time.",
    }),
    event(3, {
      kind: "bot-output",
      at: minutesAfterCall(2),
      stage: "voice-intake",
      summary: "Verified Mia's identity with a text-message code.",
    }),
    event(4, {
      kind: "bot-output",
      at: minutesAfterCall(3),
      stage: "voice-intake",
      summary: "Recorded Mia's consent to a credit check.",
    }),
    event(5, {
      kind: "bot-output",
      at: minutesAfterCall(4),
      stage: "voice-intake",
      summary:
        "Mia asked how much they can borrow. Did not give a figure; explained a Home Lending Executive will work it out properly.",
    }),
    event(6, {
      kind: "bot-output",
      at: minutesAfterCall(5),
      stage: "voice-intake",
      summary:
        "Booked a video appointment with Sarah Whitfield for Wednesday 14 October at 12:30pm.",
    }),
    event(7, {
      kind: "customer-notified",
      at: minutesAfterCall(5),
      channel: "sms",
      template: "appointment-confirmation",
    }),
    event(8, { kind: "stage-entered", at: minutesAfterCall(5), stage: "credit-assessment" }),
  ],
};
