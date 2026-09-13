import test from "node:test";
import assert from "node:assert/strict";
import { fontKey } from "../../src/shared/protocol";

test("font identity cannot collide on family/style separators", () =>
  assert.notEqual(
    fontKey({ family: "a/b", style: "c" }),
    fontKey({ family: "a", style: "b/c" }),
  ));
