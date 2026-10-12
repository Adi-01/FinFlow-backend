import { env } from "@/config/env.js";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  message: string;
  method?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  [key: string]: unknown;
}

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const getStatusColor = (status?: number): string => {
  if (!status) return colors.reset;
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  if (status >= 300) return colors.cyan;
  return colors.green;
};

const getLevelColor = (level: LogLevel): string => {
  switch (level) {
    case "ERROR":
      return colors.red;
    case "WARN":
      return colors.yellow;
    case "DEBUG":
      return colors.gray;
    default:
      return colors.cyan;
  }
};

const formatDevLog = (entry: LogEntry): string => {
  let time: string;
  try {
    const tz = env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(new Date(entry.timestamp));
  } catch {
    time = new Date(entry.timestamp).toLocaleTimeString("en-GB", {
      hour12: false,
    });
  }

  const reqId = entry.requestId
    ? `${colors.gray}[${entry.requestId.slice(0, 8)}]${colors.reset} `
    : "";

  // Compact HTTP request log
  if (entry.method && entry.route) {
    const statusColor = getStatusColor(entry.status);
    const duration =
      entry.durationMs !== undefined
        ? ` ${colors.dim}${entry.durationMs}ms${colors.reset}`
        : "";

    return `${colors.gray}${time}${colors.reset} ${reqId}${colors.magenta}${entry.method}${colors.reset} ${entry.route} ${statusColor}${entry.status ?? ""}${colors.reset}${duration}`;
  }

  // General application logs
  const levelBadge = `${getLevelColor(entry.level)}${entry.level.padEnd(5)}${colors.reset}`;
  let extra = "";

  const extraKeys = Object.keys(entry).filter(
    (k) =>
      ![
        "timestamp",
        "level",
        "requestId",
        "message",
        "method",
        "route",
        "status",
        "durationMs",
        "error",
        "stack",
      ].includes(k),
  );

  if (extraKeys.length > 0) {
    const extraObj = extraKeys.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = entry[key];
      return acc;
    }, {});
    extra = ` ${colors.dim}${JSON.stringify(extraObj)}${colors.reset}`;
  }

  let logLine = `${colors.gray}${time}${colors.reset} ${levelBadge} ${reqId}${entry.message}${extra}`;

  if (entry.error) {
    logLine += `\n  ${colors.red}${String(entry.error)}${colors.reset}`;
  }
  if (entry.stack) {
    logLine += `\n  ${colors.dim}${String(entry.stack)}${colors.reset}`;
  }

  return logLine;
};

const formatLog = (entry: LogEntry): string => {
  // In production or when explicitly requested via LOG_FORMAT=json, output single-line JSON
  if (env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json") {
    return JSON.stringify(entry);
  }

  // In development, output clean, human-readable terminal formatting
  return formatDevLog(entry);
};

export const logger = {
  info: (
    message: string,
    context: Partial<Omit<LogEntry, "timestamp" | "level" | "message">> = {},
  ) => {
    console.log(
      formatLog({
        timestamp: new Date().toISOString(),
        level: "INFO",
        message,
        ...context,
      }),
    );
  },
  warn: (
    message: string,
    context: Partial<Omit<LogEntry, "timestamp" | "level" | "message">> = {},
  ) => {
    console.warn(
      formatLog({
        timestamp: new Date().toISOString(),
        level: "WARN",
        message,
        ...context,
      }),
    );
  },
  error: (
    message: string,
    context: Partial<Omit<LogEntry, "timestamp" | "level" | "message">> = {},
  ) => {
    console.error(
      formatLog({
        timestamp: new Date().toISOString(),
        level: "ERROR",
        message,
        ...context,
      }),
    );
  },
  debug: (
    message: string,
    context: Partial<Omit<LogEntry, "timestamp" | "level" | "message">> = {},
  ) => {
    if (!env.ENABLE_VERBOSE_LOGS) return;
    console.debug(
      formatLog({
        timestamp: new Date().toISOString(),
        level: "DEBUG",
        message,
        ...context,
      }),
    );
  },
};
