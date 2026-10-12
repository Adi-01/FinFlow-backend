/**
 * Date utility helpers for UTC month-bounded calculations
 */

export interface UTCMonthRange {
  year: number;
  month: number;
  monthStr: string;
  startOfMonth: Date;
  endOfMonth: Date;
}

/**
 * Returns current UTC month formatted as YYYY-MM
 */
export const getCurrentUTCMonth = (): string => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

/**
 * Calculates start and end timestamps in UTC for a given YYYY-MM string
 * startOfMonth: YYYY-MM-01T00:00:00.000Z
 * endOfMonth:   YYYY-MM-lastDayT23:59:59.999Z
 */
export const getUTCMonthRange = (monthStr: string): UTCMonthRange => {
  const parts = monthStr.split("-");
  const year = Number.parseInt(parts[0] ?? "", 10);
  const month = Number.parseInt(parts[1] ?? "", 10);

  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month string: "${monthStr}". Expected YYYY-MM format.`);
  }

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  // Day 0 of next month is the last day of the current month in UTC
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  return {
    year,
    month,
    monthStr,
    startOfMonth,
    endOfMonth,
  };
};

/**
 * Formats a Date object into a YYYY-MM string based on UTC components
 */
export const getMonthStrFromDate = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

/**
 * Parses query date string supporting both YYYY-MM-DD and ISO 8601 strings into a UTC Date.
 * If isEndOfDay is true, sets time to 23:59:59.999Z for YYYY-MM-DD dates.
 */
export const parseQueryDate = (dateStr: string, isEndOfDay = false): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const parts = dateStr.split("-");
    const y = Number.parseInt(parts[0] ?? "", 10);
    const m = Number.parseInt(parts[1] ?? "", 10);
    const d = Number.parseInt(parts[2] ?? "", 10);

    return isEndOfDay
      ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
      : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  }
  return new Date(dateStr);
};

