/** Bound external waits and let cancellation run while Figma is rendering. */
export function operationBudget(
  check: () => void,
  milliseconds = 15000,
  notify: (stage: string) => void = () => {},
  timeoutMessage = (stage: string) =>
    `省略文字の変換が制限時間を超えました（${stage}）。処理を中止しました。`,
) {
  const deadline = Date.now() + milliseconds;
  const verify = (stage: string) => {
    check();
    if (Date.now() >= deadline) {
      const error = new Error(timeoutMessage(stage));
      error.name = "OperationTimeoutError";
      throw error;
    }
  };
  return {
    check: verify,
    async run<T>(stage: string, start: () => Promise<T>): Promise<T> {
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
