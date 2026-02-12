/**
 * Parses an error of any type into a human-readable string message.
 * Handles Error instances, Tauri error objects, plain objects, and primitives.
 *
 * @param err - The error to parse (can be any type)
 * @returns A string representation of the error message
 */
export function parseErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }

  if (typeof err === "object" && err !== null) {
    // Handle Tauri/backend error objects that have a message property
    if ("message" in err && typeof (err as { message: unknown }).message === "string") {
      return (err as { message: string }).message;
    }

    // Handle objects with error property
    if ("error" in err && typeof (err as { error: unknown }).error === "string") {
      return (err as { error: string }).error;
    }

    // Fallback to JSON stringification for other objects
    try {
      return JSON.stringify(err);
    } catch {
      return "[Unable to parse error object]";
    }
  }

  // Handle primitives (string, number, etc.)
  return String(err);
}
