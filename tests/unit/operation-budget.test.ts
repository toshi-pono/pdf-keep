import test from "node:test";
import assert from "node:assert/strict";
import { operationBudget } from "../../src/shared/operation-budget";
test("an unresponsive Figma call times out with the current stage", async () => {
  const stages: string[] = [];
  const budget = operationBudget(
    () => {},
    20,
    (s) => stages.push(s),
  );
  await assert.rejects(
    budget.run("フォントを準備中", () => new Promise(() => {})),
    /制限時間.*フォントを準備中/,
  );
  assert.deepEqual(stages, ["フォントを準備中"]);
});
test("cancellation interrupts an unresolved external call; late completion is ignored", async () => {
  let cancelled = false;
  let resolve!: (value: number) => void;
  const budget = operationBudget(() => {
    if (cancelled) throw Error("cancelled");
  }, 1000);
  const pending = budget.run(
    "render",
    () =>
      new Promise<number>((r) => {
        resolve = r;
      }),
  );
  cancelled = true;
  await assert.rejects(pending, /cancelled/);
  resolve(1);
});
test("the deadline is shared across stages and late results cannot be accepted", async () => {
  const budget = operationBudget(() => {}, 20);
  assert.equal(await budget.run("first", async () => 5), 5);
  await assert.rejects(
    budget.run("second", () => new Promise((r) => setTimeout(() => r(2), 40))),
    /制限時間/,
  );
});
