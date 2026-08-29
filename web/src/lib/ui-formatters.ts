function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatDistanceKm(value: unknown): string {
  const number = numericValue(value);
  return number === null ? "—" : `${Math.round(number)} km`;
}

export function formatActivityDateTime(value: unknown, timezone: unknown): string {
  if (typeof value !== "string" || !value || typeof timezone !== "string" || !timezone) return "—";
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "—";
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(instant).filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch {
    return "—";
  }
}
