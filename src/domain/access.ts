import type { Application } from "./application";
import type { ApplicationSection, StageId } from "./stages";
import { STAGE_BY_ID } from "./stages";

/**
 * The parts of an application this demo holds, split into the sections stages are
 * granted. Sections it has no data for (documents, credit report, contract and so on)
 * are absent.
 */
function sectionsOf(application: Application) {
  return {
    identity: application.applicants.map(({ id, role, firstName, lastName, identity }) => ({
      id,
      role,
      firstName,
      lastName,
      identity,
    })),
    contact: application.applicants.map(({ id, mobile, email }) => ({ id, mobile, email })),
    household: application.household,
    income: application.applicants.map(({ id, employment, annualIncome }) => ({
      id,
      employment,
      annualIncome,
    })),
    commitments: application.commitments,
    "property-goal": application.goal,
    consent: application.applicants.map(({ id, consent }) => ({ id, consent })),
    appointment: application.appointment,
    assessment: application.audit.filter(
      (event) => event.kind === "bot-output" && event.stage === "credit-assessment",
    ),
    decision: application.audit.filter((event) => event.kind === "human-decision"),
  } satisfies Partial<Record<ApplicationSection, unknown>>;
}

type Sections = ReturnType<typeof sectionsOf>;
type Granted<S extends StageId> = Extract<
  (typeof STAGE_BY_ID)[S]["dataAccess"][number],
  keyof Sections
>;

export type StageView<S extends StageId> = { readonly id: Application["id"] } & Pick<
  Sections,
  Granted<S>
>;

/** Everything a stage's bot or person may read, and nothing else. */
export function viewFor<S extends StageId>(stage: S, application: Application): StageView<S> {
  const sections = sectionsOf(application);
  const granted: readonly ApplicationSection[] = STAGE_BY_ID[stage].dataAccess;
  const view: Record<string, unknown> = { id: application.id };
  for (const section of granted) {
    if (section in sections) {
      view[section] = sections[section as keyof Sections];
    }
  }
  return view as StageView<S>;
}
