import type { PropertyAgentConfig, StoredAgentState } from "./types";

const UK_TIME_ZONE = "Europe/London";
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zonedFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: UK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function computeNextRunAt(config: PropertyAgentConfig, from: Date): Date {
  if (config.update_frequency_minutes % MINUTES_PER_DAY !== 0 || !config.run_time_uk) {
    return new Date(from.getTime() + config.update_frequency_minutes * MS_PER_MINUTE);
  }

  const cadenceDays = config.update_frequency_minutes / MINUTES_PER_DAY;
  const londonDate = getZonedParts(from);
  const targetDate = addDaysToCivilDate(londonDate, cadenceDays);
  const [hour, minute] = config.run_time_uk.split(":").map(Number);

  return zonedTimeToUtc({
    ...targetDate,
    hour,
    minute,
    second: 0,
  });
}

export function isDueForRun(state: StoredAgentState | null, now = new Date()): boolean {
  if (!state?.next_run_at) {
    return true;
  }

  const nextRunAt = Date.parse(state.next_run_at);
  return Number.isNaN(nextRunAt) || nextRunAt <= now.getTime();
}

function getZonedParts(date: Date): ZonedParts {
  const partMap = new Map(zonedFormatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(partMap.get("year")),
    month: Number(partMap.get("month")),
    day: Number(partMap.get("day")),
    hour: Number(partMap.get("hour")),
    minute: Number(partMap.get("minute")),
    second: Number(partMap.get("second")),
  };
}

function addDaysToCivilDate(parts: ZonedParts, days: number): Pick<ZonedParts, "year" | "month" | "day"> {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * MS_PER_DAY);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedTimeToUtc(parts: ZonedParts): Date {
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  const firstOffset = getTimeZoneOffsetMs(guess);
  const firstCandidate = new Date(guess.getTime() - firstOffset);
  const secondOffset = getTimeZoneOffsetMs(firstCandidate);

  if (firstOffset !== secondOffset) {
    return new Date(guess.getTime() - secondOffset);
  }

  return firstCandidate;
}

function getTimeZoneOffsetMs(date: Date): number {
  const parts = getZonedParts(date);
  const equivalentUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return equivalentUtc - date.getTime();
}
