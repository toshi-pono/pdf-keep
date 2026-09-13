/** Figma VM errors are often plain objects rather than host Error instances. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string" && error !== "[object Object]") return error;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; reason?: unknown };
    if (typeof value.message === "string") return value.message;
    if (typeof value.reason === "string") return value.reason;
    try {
      const json = JSON.stringify(error);
      if (json !== "{}") return json;
    } catch {
      /* fallback */
    }
  }
  return "処理に失敗しました。再試行してください。";
}
