import { type Message, msg } from "./messages";
import { AppError } from "./errors";
/** Bound external waits and let cancellation run while Figma is rendering. */
export function operationBudget(
  check: () => void,
  milliseconds = 15000,
  notify: (stage: Message) => void = () => {},
  timeoutMessage = (stage: Message) =>
    msg("errors.truncationTimeout", { stage }),
) {
  const deadline = Date.now() + milliseconds;
  const verify = (stage: Message) => {
    check();
    if (Date.now() >= deadline) {
      const error = new AppError(timeoutMessage(stage));
      error.name = "OperationTimeoutError";
      throw error;
    }
  };
  return {
    check: verify,
    async run<T>(stage: Message, start: () => Promise<T>): Promise<T> {
      verify(stage);
      notify(stage);
      return new Promise<T>((resolve, reject) => {
        let finished = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (fn: () => void) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          fn();
        };
        const poll = () => {
          try {
            verify(stage);
          } catch (e) {
            finish(() => reject(e));
            return;
          }
          timer = setTimeout(
            poll,
            Math.max(1, Math.min(100, deadline - Date.now())),
          );
        };
        poll();
        if (finished) return;
        try {
          start().then(
            (value) =>
              finish(() => {
                try {
                  verify(stage);
                  resolve(value);
                } catch (e) {
                  reject(e);
                }
              }),
            (error) => finish(() => reject(error)),
          );
        } catch (e) {
          finish(() => reject(e));
        }
      });
    },
  };
}
