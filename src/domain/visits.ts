import type { Application } from "./application";
import type { StageId } from "./stages";

/**
 * How many times the application has entered `stage`, counting the current visit: 0 if it
 * never has. Events written for a visit take its number in their ids, so a stage the
 * application comes back to writes new events instead of colliding with the last visit's.
 */
export function visitsTo(application: Pick<Application, "audit">, stage: StageId): number {
  return application.audit.filter(
    (event) => event.kind === "stage-entered" && event.stage === stage,
  ).length;
}
