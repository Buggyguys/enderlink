export interface TimeRange {
  start: number;
  end: number;
}

export type TickUnit =
  "second" | "minute" | "hour" | "day" | "week" | "month" | "year";
export interface TickStep {
  unit: TickUnit;
  count: number;
  seconds: number;
}
export interface TimeTick {
  time: number;
  label: string;
  context: string;
}

const minute = 60;
const hour = minute * 60;
const day = hour * 24;
const steps: TickStep[] = [
  ...[1, 5, 15, 30].map((count) => ({
    unit: "second" as const,
    count,
    seconds: count,
  })),
  ...[1, 5, 15, 30].map((count) => ({
    unit: "minute" as const,
    count,
    seconds: count * minute,
  })),
  ...[1, 3, 6, 12].map((count) => ({
    unit: "hour" as const,
    count,
    seconds: count * hour,
  })),
  ...[1, 2].map((count) => ({
    unit: "day" as const,
    count,
    seconds: count * day,
  })),
  ...[1, 2].map((count) => ({
    unit: "week" as const,
    count,
    seconds: count * 7 * day,
  })),
  ...[1, 3, 6].map((count) => ({
    unit: "month" as const,
    count,
    seconds: count * 30.4375 * day,
  })),
  ...[1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].map((count) => ({
    unit: "year" as const,
    count,
    seconds: count * 365.25 * day,
  })),
];

export function timelineDomain(createdAt: number, now: number): TimeRange {
  const end = Number.isFinite(now) ? Math.max(0, now) : Date.now() / 1000;
  const start = Number.isFinite(createdAt)
    ? Math.max(0, Math.min(createdAt, end))
    : end;
  return { start, end };
}

export function minimumSpan(domain: TimeRange): number {
  return Math.min(60, Math.max(0, domain.end - domain.start));
}

export function clampRange(range: TimeRange, domain: TimeRange): TimeRange {
  const full = Math.max(0, domain.end - domain.start);
  if (!full || !Number.isFinite(range.start) || !Number.isFinite(range.end))
    return { ...domain };
  const span = Math.max(
    minimumSpan(domain),
    Math.min(full, range.end - range.start),
  );
  const start = Math.max(
    domain.start,
    Math.min(domain.end - span, range.start),
  );
  return { start, end: start + span };
}

export function timePosition(time: number, range: TimeRange): number {
  const span = range.end - range.start;
  return span > 0 ? (time - range.start) / span : 0.5;
}

export function zoomRange(
  range: TimeRange,
  domain: TimeRange,
  factor: number,
  anchor = 0.5,
): TimeRange {
  const current = clampRange(range, domain);
  const span = current.end - current.start;
  const ratio = Math.max(0, Math.min(1, anchor));
  const nextSpan = Math.max(
    minimumSpan(domain),
    Math.min(domain.end - domain.start, span * factor),
  );
  const fixedTime = current.start + span * ratio;
  return clampRange(
    {
      start: fixedTime - nextSpan * ratio,
      end: fixedTime + nextSpan * (1 - ratio),
    },
    domain,
  );
}

export function panRange(
  range: TimeRange,
  domain: TimeRange,
  seconds: number,
): TimeRange {
  return clampRange(
    { start: range.start + seconds, end: range.end + seconds },
    domain,
  );
}

export function chooseTickStep(range: TimeRange, width: number): TickStep {
  const desiredTicks = Math.max(2, Math.min(12, Math.floor(width / 100)));
  const target = Math.max(0, range.end - range.start) / desiredTicks;
  return (
    steps.find((step) => step.seconds >= target) ?? steps[steps.length - 1]
  );
}

function serialDay(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
  );
}

function fromSerialDay(serial: number): Date {
  const utc = new Date(serial * 86400000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

function floorTick(time: number, step: TickStep): Date {
  const date = new Date(time * 1000);
  if (step.unit === "year")
    return new Date(
      Math.floor(date.getFullYear() / step.count) * step.count,
      0,
      1,
    );
  if (step.unit === "month") {
    const month =
      Math.floor((date.getFullYear() * 12 + date.getMonth()) / step.count) *
      step.count;
    return new Date(Math.floor(month / 12), month % 12, 1);
  }
  if (step.unit === "week") {
    // Local calendar Mondays, anchored to Monday 5 January 1970.
    const serial = serialDay(date);
    return fromSerialDay(
      4 + Math.floor((serial - 4) / (7 * step.count)) * 7 * step.count,
    );
  }
  if (step.unit === "day")
    return fromSerialDay(Math.floor(serialDay(date) / step.count) * step.count);
  // The local UTC offset also aligns clocks with half-/quarter-hour offsets.
  // Advancing in elapsed seconds keeps repeated DST hours distinct.
  const offset = -date.getTimezoneOffset() * 60;
  return new Date(
    (Math.floor((time + offset) / step.seconds) * step.seconds - offset) * 1000,
  );
}

function nextTick(date: Date, step: TickStep): Date {
  const next = new Date(date);
  switch (step.unit) {
    case "year":
      next.setFullYear(next.getFullYear() + step.count);
      break;
    case "month":
      next.setMonth(next.getMonth() + step.count);
      break;
    case "week":
      next.setDate(next.getDate() + step.count * 7);
      break;
    case "day":
      next.setDate(next.getDate() + step.count);
      break;
    default:
      next.setTime(next.getTime() + step.seconds * 1000);
  }
  return next;
}

function tickText(
  date: Date,
  step: TickStep,
  first: boolean,
): Pick<TimeTick, "label" | "context"> {
  if (step.unit === "year")
    return { label: String(date.getFullYear()), context: "" };
  if (step.unit === "month")
    return {
      label: date.toLocaleDateString(undefined, { month: "short" }),
      context: first || date.getMonth() === 0 ? String(date.getFullYear()) : "",
    };
  if (step.unit === "day" || step.unit === "week")
    return {
      label: date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      }),
      context:
        first || (date.getMonth() === 0 && date.getDate() <= 7)
          ? String(date.getFullYear())
          : "",
    };
  return {
    label: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      ...(step.unit === "second" ? { second: "2-digit" as const } : {}),
      hour12: false,
    }),
    context:
      first ||
      (date.getHours() === 0 &&
        date.getMinutes() === 0 &&
        date.getSeconds() === 0)
        ? date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
        : "",
  };
}

/** Calendar ticks are constructed as local dates, never by treating a month or year as a fixed duration. */
export function timelineTicks(
  range: TimeRange,
  width: number,
): { step: TickStep; ticks: TimeTick[] } {
  const step = chooseTickStep(range, width);
  const ticks: TimeTick[] = [];
  if (range.end <= range.start) return { step, ticks };
  let date = floorTick(range.start, step);
  for (let attempt = 0; attempt < 64; attempt++) {
    const time = date.getTime() / 1000;
    if (!Number.isFinite(time) || time > range.end) break;
    if (time >= range.start)
      ticks.push({ time, ...tickText(date, step, ticks.length === 0) });
    const next = nextTick(date, step);
    if (next.getTime() <= date.getTime()) break;
    date = next;
  }
  // Repeated local clock labels during a DST fallback need their actual zone.
  if (["second", "minute", "hour"].includes(step.unit)) {
    const clockKeys = ticks.map(
      (tick) => `${new Date(tick.time * 1000).toDateString()} ${tick.label}`,
    );
    ticks.forEach((tick, index) => {
      if (
        clockKeys.indexOf(clockKeys[index]) !==
        clockKeys.lastIndexOf(clockKeys[index])
      ) {
        tick.context =
          new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
            .formatToParts(new Date(tick.time * 1000))
            .find((part) => part.type === "timeZoneName")?.value ??
          tick.context;
      }
    });
  }
  return { step, ticks };
}

export function tickStepLabel(step: TickStep): string {
  return step.count === 1
    ? `${step.unit[0].toUpperCase()}${step.unit.slice(1)}s`
    : `${step.count}-${step.unit} steps`;
}

export interface TimelinePoint {
  id: string;
  createdAt: number;
}
export interface PointGroup<T extends TimelinePoint> {
  points: T[];
  position: number;
}

/** Group only within a bounded hit area; the SVG still draws every dot at its real time. */
export function groupTimelinePoints<T extends TimelinePoint>(
  points: T[],
  range: TimeRange,
  width: number,
  pixels = 28,
): PointGroup<T>[] {
  const sorted = points
    .filter(
      (point) => point.createdAt >= range.start && point.createdAt <= range.end,
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  const groups: PointGroup<T>[] = [];
  const safeWidth = Math.max(1, width);
  for (const point of sorted) {
    const position = timePosition(point.createdAt, range);
    const last = groups.at(-1);
    if (
      last &&
      (position - timePosition(last.points[0].createdAt, range)) * safeWidth <
        pixels
    ) {
      last.points.push(point);
      last.position =
        (timePosition(last.points[0].createdAt, range) + position) / 2;
    } else groups.push({ points: [point], position });
  }
  return groups;
}
