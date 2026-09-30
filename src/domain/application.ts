import type { Aud } from "./money";
import type { StaffId, StaffIdFor } from "./people";
import type { DECIDER, DecisionOutcome, HumanStageId, StageId } from "./stages";

declare const applicationIdBrand: unique symbol;
export type ApplicationId = string & { readonly [applicationIdBrand]: true };

declare const applicantIdBrand: unique symbol;
export type ApplicantId = string & { readonly [applicantIdBrand]: true };

/** ISO 8601 with offset, e.g. "2026-10-12T19:42:00+11:00". */
export type IsoDateTime = string;

export type EvidenceSource = "voice-call" | "document-upload" | "bot-check";

/** A fact about the customer and whether anyone has checked it yet. */
export type Captured<T> =
  | { readonly status: "stated"; readonly value: T; readonly source: EvidenceSource }
  | {
      readonly status: "verified";
      readonly value: T;
      readonly source: EvidenceSource;
      readonly verifiedAt: IsoDateTime;
    };

export type IdentityCheck =
  | { readonly status: "pending" }
  | {
      readonly status: "verified";
      readonly method: "sms-code" | "document-upload";
      readonly at: IsoDateTime;
    };

export type Consent =
  | { readonly status: "pending" }
  | {
      readonly status: "given";
      readonly scope: "credit-check";
      readonly channel: "voice-call" | "document-upload";
      readonly at: IsoDateTime;
    };

export interface Employment {
  readonly basis: "full-time" | "part-time" | "casual" | "self-employed";
  readonly occupation: string;
  readonly employer: string;
  readonly yearsInRole: number;
}

export interface Applicant {
  readonly id: ApplicantId;
  readonly role: "primary" | "co-applicant";
  readonly firstName: string;
  readonly lastName: string;
  readonly mobile: string;
  readonly email: string;
  readonly employment: Captured<Employment>;
  readonly annualIncome: Captured<Aud>;
  readonly identity: IdentityCheck;
  readonly consent: Consent;
}

export interface Commitment {
  readonly kind: "credit-card" | "car-loan" | "personal-loan" | "buy-now-pay-later" | "hecs-help";
  readonly description: string;
  readonly limitOrBalance: Aud;
  readonly monthlyRepayment: Aud;
}

export interface PropertyGoal {
  readonly purpose: "owner-occupier";
  readonly firstHomeBuyers: boolean;
  readonly targetArea: string;
  readonly purchasePrice: Captured<Aud>;
  readonly deposit: Captured<Aud>;
  readonly loanAmountSought: Aud;
}

export interface Appointment {
  readonly hle: StaffIdFor<"home-lending-executive">;
  readonly mode: "video";
  readonly startsAt: IsoDateTime;
  readonly confirmationSentBy: "sms";
}

/** Something the call captured that a later stage must still check. */
export interface CheckItem {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly checkedAt: StageId;
}

declare const auditEventIdBrand: unique symbol;
export type AuditEventId = string & { readonly [auditEventIdBrand]: true };

export function eventId(id: string): AuditEventId {
  return id as AuditEventId;
}

declare const decisionReasonBrand: unique symbol;
/** Non-empty, trimmed text. Only `decisionReason()` makes one. */
export type DecisionReason = string & { readonly [decisionReasonBrand]: true };

export function decisionReason(text: string): DecisionReason {
  const trimmed = text.trim();
  if (trimmed === "") {
    throw new Error("A decision needs a reason.");
  }
  return trimmed as DecisionReason;
}

/** Status updates sent automatically. Anything else is a `customer-messaged` event a person approved. */
export const NOTIFICATION_TEMPLATES = [
  "appointment-confirmation",
  "documents-requested",
  "more-info-requested",
  "loan-approved",
  "loan-settled",
] as const;
export type NotificationTemplateId = (typeof NOTIFICATION_TEMPLATES)[number];

interface EventBase {
  /** Unique across the store, so appending the same event twice can be ignored. */
  readonly id: AuditEventId;
  readonly applicationId: ApplicationId;
  readonly at: IsoDateTime;
}

export type AuditEvent =
  | (EventBase & { readonly kind: "stage-entered"; readonly stage: StageId })
  | (EventBase & { readonly kind: "bot-output"; readonly stage: StageId; readonly summary: string })
  | HumanDecisionEvent
  | (EventBase & {
      readonly kind: "customer-notified";
      readonly channel: "sms" | "chat";
      readonly template: NotificationTemplateId;
    })
  | (EventBase & {
      readonly kind: "customer-messaged";
      readonly channel: "sms" | "chat";
      readonly message: string;
      readonly approvedBy: StaffId;
    });

export type HumanDecisionEvent = {
  readonly [S in HumanStageId]: EventBase & {
    readonly kind: "human-decision";
    readonly stage: S;
    readonly outcome: DecisionOutcome<S>;
    readonly by: StaffIdFor<(typeof DECIDER)[S]>;
    readonly reason: DecisionReason;
  };
}[HumanStageId];

export interface Application {
  readonly id: ApplicationId;
  readonly reference: string;
  readonly applicants: readonly [Applicant, ...Applicant[]];
  readonly household: { readonly relationship: "partners"; readonly dependants: number };
  readonly commitments: Captured<readonly Commitment[]>;
  readonly goal: PropertyGoal;
  readonly appointment: Appointment;
  readonly callStartedAt: IsoDateTime;
  readonly toCheck: readonly CheckItem[];
  /** Oldest first, and never empty: every application starts with `stage-entered` at voice intake. */
  readonly audit: readonly [AuditEvent, ...AuditEvent[]];
}

/** The stage an application is in is whatever its audit last entered. */
export function currentStage(application: Pick<Application, "audit">): StageId {
  for (let index = application.audit.length - 1; index >= 0; index--) {
    const event = application.audit[index];
    if (event?.kind === "stage-entered") {
      return event.stage;
    }
  }
  return "voice-intake";
}
