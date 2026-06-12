export function getErrorMessage(error: unknown, fallback = "Unbekannter Fehler"): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "details", "body", "statusText"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (value && typeof value === "object") {
        const nested = getErrorMessage(value, "");
        if (nested) return nested;
      }
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore circular or non-serializable error objects.
    }
  }

  return fallback;
}

export const parseErrorMessage = getErrorMessage;
