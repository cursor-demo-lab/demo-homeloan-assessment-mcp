import type { StaffRole } from "./people";

/** The demo's six-stage home loan flow. `name`, `role` and `tasks` are its on-screen wording. */

export type StageActor = "ai" | "human" | "automated";

/** What a stage is allowed to read. Each bot sees only its own stage's list. */
export type ApplicationSection =
  | "identity"
  | "contact"
  | "household"
  | "income"
  | "commitments"
  | "property-goal"
  | "consent"
  | "appointment"
  | "documents"
  | "credit-report"
  | "assessment"
  | "decision"
  | "contract"
  | "valuation"
  | "insurance"
  | "settlement";

interface StageDefinition {
  readonly id: string;
  readonly number: 1 | 2 | 3 | 4 | 5 | 6;
  readonly name: string;
  readonly actor: StageActor;
  readonly role: string;
  readonly tasks: readonly string[];
  readonly dataAccess: readonly ApplicationSection[];
}

export const STAGES = [
  {
    id: "voice-intake",
    number: 1,
    name: "Voice intake",
    actor: "ai",
    role: "AI · Voice chat",
    tasks: [
      "Customer asks by voice",
      "Captures details, ID and consent",
      "Builds a structured application",
    ],
    dataAccess: [
      "identity",
      "contact",
      "household",
      "income",
      "commitments",
      "property-goal",
      "consent",
      "appointment",
      "decision",
    ],
  },
  {
    id: "credit-assessment",
    number: 2,
    name: "Credit Assessment",
    actor: "ai",
    role: "AI bot",
    tasks: [
      "Credit report",
      "Income and expense verification",
      "Serviceability and responsible-lending checks",
      "Valuation estimate and LVR",
      "Recommendation with reasons",
    ],
    dataAccess: [
      "identity",
      "household",
      "income",
      "commitments",
      "property-goal",
      "consent",
      "documents",
      "credit-report",
    ],
  },
  {
    id: "credit-decision",
    number: 3,
    name: "Credit decision",
    actor: "human",
    role: "Assessor",
    tasks: [
      "Credit assessor approves, declines or asks for more info",
      "Decision and reason logged",
    ],
    dataAccess: [
      "identity",
      "household",
      "income",
      "commitments",
      "property-goal",
      "documents",
      "credit-report",
      "assessment",
      "decision",
    ],
  },
  {
    id: "fulfilment",
    number: 4,
    name: "Fulfilment",
    actor: "ai",
    role: "AI bot",
    tasks: [
      "Loan contract and disclosures",
      "E-signing",
      "Valuation order",
      "LMI and insurance checks",
      "Settlement conditions",
    ],
    dataAccess: [
      "identity",
      "contact",
      "property-goal",
      "decision",
      "contract",
      "valuation",
      "insurance",
    ],
  },
  {
    id: "fulfilment-check",
    number: 5,
    name: "Fulfilment check",
    actor: "human",
    role: "Officer",
    tasks: ["Officer confirms conditions met and documents complete", "Releases to settlement"],
    dataAccess: ["decision", "contract", "valuation", "insurance", "documents"],
  },
  {
    id: "settlement",
    number: 6,
    name: "Settlement",
    actor: "automated",
    role: "Automated",
    tasks: [
      "Loan booked in core banking",
      "PEXA lodgement",
      "Funds disbursed",
      "Customer notified in chat",
    ],
    dataAccess: ["identity", "contact", "decision", "contract", "settlement"],
  },
] as const satisfies readonly StageDefinition[];

export type Stage = (typeof STAGES)[number];
export type StageId = Stage["id"];
export type HumanStageId = Extract<Stage, { actor: "human" }>["id"];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as {
  readonly [S in Stage as S["id"]]: S;
};

/** Where a stage goes when its work is done without a human decision. */
export const NEXT_STAGE = {
  "voice-intake": "credit-assessment",
  "credit-assessment": "credit-decision",
  fulfilment: "fulfilment-check",
  settlement: null,
} as const satisfies Record<Exclude<StageId, HumanStageId>, StageId | null>;

/** Each human decision and the stage it sends the application to. */
export const DECISIONS = {
  "credit-decision": {
    approve: { label: "Approve", to: "fulfilment" },
    "more-info": { label: "Ask for more info", to: "voice-intake" },
    decline: { label: "Decline", to: "voice-intake" },
  },
  "fulfilment-check": {
    release: { label: "Release to settlement", to: "settlement" },
    "send-back": { label: "Fix issues", to: "fulfilment" },
  },
} as const satisfies Record<HumanStageId, Record<string, { label: string; to: StageId }>>;

export type DecisionOutcome<S extends HumanStageId> = keyof (typeof DECISIONS)[S];

/** The only role that may decide each human stage. */
export const DECIDER = {
  "credit-decision": "credit-assessor",
  "fulfilment-check": "officer",
} as const satisfies Record<HumanStageId, StaffRole>;
