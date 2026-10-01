import type { AuditEvent, IsoDateTime } from "./application";

const OFFSET = /(Z|[+-]\d{2}:\d{2})$/u;
const WORKDAY = { starts: 9 * 60, ends: 17 * 60 } as const;

const isWeekday = (local: Date) => local.getUTCDay() !== 0 && local.getUTCDay() !== 6;

/**
 * The story clock: `minutes` after the application's last event, in that event's own
 * UTC offset. New events are stamped with this, never with the wall clock.
 */
export function storyTimeAfter(
  application: { readonly audit: readonly AuditEvent[] },
  minutes: number,
): IsoDateTime {
  const last = application.audit.at(-1);
  if (!last) {
    throw new Error("An application always has at least one audit event.");
  }
  const { offset, offsetMs } = offsetOf(last.at);
  const local = new Date(Date.parse(last.at) + minutes * 60_000 + offsetMs);
  return `${local.toISOString().slice(0, 19)}${offset}`;
}

/**
 * `storyTimeAfter` for a person at the bank, who works 9am to 5pm on weekdays. A time outside
 * those hours moves to their next working morning, the same `minutes` after 9am.
 */
export function storyWorkingTimeAfter(
  application: { readonly audit: readonly AuditEvent[] },
  minutes: number,
): IsoDateTime {
  const at = storyTimeAfter(application, minutes);
  const { offset, offsetMs } = offsetOf(at);
  const local = new Date(Date.parse(at) + offsetMs);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (isWeekday(local) && minuteOfDay >= WORKDAY.starts && minuteOfDay < WORKDAY.ends) {
    return at;
  }
  const morning = new Date(local);
  morning.setUTCHours(0, WORKDAY.starts + minutes, 0, 0);
  if (minuteOfDay >= WORKDAY.starts) {
    morning.setUTCDate(morning.getUTCDate() + 1);
  }
  while (!isWeekday(morning)) {
    morning.setUTCDate(morning.getUTCDate() + 1);
  }
  return `${morning.toISOString().slice(0, 19)}${offset}`;
}

function offsetOf(iso: IsoDateTime): { offset: string; offsetMs: number } {
  const offset = OFFSET.exec(iso)?.[1];
  if (!offset) {
    throw new Error(`Story times carry a UTC offset: ${iso}`);
  }
  if (offset === "Z") {
    return { offset: "+00:00", offsetMs: 0 };
  }
  const sign = offset.startsWith("-") ? -1 : 1;
  return {
    offset,
    offsetMs: sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60_000,
  };
}
