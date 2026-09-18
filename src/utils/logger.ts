/** Minimal structured logger used to avoid an additional runtime dependency. */
export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

function write(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  fields?: Record<string, unknown>,
): void {
  const suffix = fields ? ` ${JSON.stringify(fields)}` : "";
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Create a logger whose debug output is explicitly opt-in. */
export function createLogger(debugEnabled = false): Logger {
  return {
    debug: (message, fields) => {
      if (debugEnabled) write("debug", message, fields);
    },
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
