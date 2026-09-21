import { isMessage, msg, type Message } from "./messages";

/** Keep localization data intact until the UI renders the error. */
export class AppError extends Error {
  constructor(readonly detail: Message) {
    super(
      typeof detail === "string"
        ? detail
        : detail.kind === "message"
          ? detail.key
          : "Application error",
    );
  }
}
/** Figma VM errors are often plain objects rather than host Error instances. */
export function errorMessage(error: unknown): Message {
  if (isMessage(error)) return error;
  if (typeof error === "string" && error !== "[object Object]") return error;
  if (error && typeof error === "object") {
    const value = error as {
      detail?: unknown;
      message?: unknown;
      reason?: unknown;
    };
    if (typeof value.detail === "string" || isMessage(value.detail))
      return value.detail;
    if (typeof value.message === "string") return value.message;
    if (typeof value.reason === "string" || isMessage(value.reason))
      return value.reason;
    try {
      const json = JSON.stringify(error);
      if (json !== "{}") return json;
    } catch {
      /* fallback */
    }
  }
  return msg("errors.operationFailed");
}
