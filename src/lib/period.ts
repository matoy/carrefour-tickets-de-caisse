export type TimePeriod = "1w" | "1m" | "1y" | "all";

export const DEFAULT_TIME_PERIOD: TimePeriod = "1y";

export const TIME_PERIOD_OPTIONS: ReadonlyArray<{
  value: TimePeriod;
  label: string;
  shortLabel: string;
}> = [
  { value: "1w", label: "1 semaine", shortLabel: "1 sem." },
  { value: "1m", label: "1 mois", shortLabel: "1 mois" },
  { value: "1y", label: "1 an", shortLabel: "1 an" },
  { value: "all", label: "Tout", shortLabel: "Tout" },
];

export function parseTimePeriod(
  raw: string | null | undefined,
  fallback: TimePeriod = DEFAULT_TIME_PERIOD
): TimePeriod {
  if (raw === "1w" || raw === "1m" || raw === "1y" || raw === "all") {
    return raw;
  }
  return fallback;
}

export function getPeriodStartDate(
  period: TimePeriod,
  now: Date = new Date()
): Date | null {
  if (period === "all") return null;
  if (period === "1w") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  const d = new Date(now.getTime());
  if (period === "1m") {
    d.setMonth(d.getMonth() - 1);
    return d;
  }
  d.setFullYear(d.getFullYear() - 1);
  return d;
}
