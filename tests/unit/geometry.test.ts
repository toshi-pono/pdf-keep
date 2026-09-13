import test from "node:test";
import assert from "node:assert/strict";
import {
  contains,
  intersects,
  nearbyPosition,
} from "../../src/shared/geometry";

test("geometry uses area overlap, contains boundaries", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };
  assert(contains(a, a));
  assert(!intersects(a, { ...a, x: 10 }));
  assert(intersects(a, { ...a, x: 9 }));
});
test("placement stays near source, avoids occupied areas and negative coordinates", () => {
  const source = { x: -500, y: -100, width: 300, height: 200 };
  const obstacles = [
    source,
    { x: 10000, y: 0, width: 500, height: 500 },
    { x: -136, y: -100, width: 300, height: 200 },
  ];
  const pos = nearbyPosition(source, 300, 200, obstacles);
  assert(Math.abs(pos.x - source.x) < 1000);
  assert(Math.abs(pos.y - source.y) < 1000);
  for (const b of obstacles)
    assert(!intersects({ ...pos, width: 300, height: 200 }, b));
});
