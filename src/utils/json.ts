/** Small boundary guards for data received from JSON and browser evaluation. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
