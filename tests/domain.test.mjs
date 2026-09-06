import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRecords,
  validateRecords,
  TEMPLATES,
} from "../server/domain.mjs";

const ft = TEMPLATES[0];
const r = (completed, seconds, reps, noReps = 0) => ({
  userId: "a",
  completed,
  seconds,
  reps,
  noReps,
  note: "",
  videoSecond: 0,
});
test("For Time compares completion, unfinished reps, and completed times; ties remain ties", () => {
  assert.equal(compareRecords(ft, [r(true, 599, 90)], [r(false, 600, 89)]), 1);
  assert.equal(
    compareRecords(ft, [r(false, 600, 40)], [r(false, 600, 50)]),
    -1,
  );
  assert.equal(compareRecords(ft, [r(true, 100, 90)], [r(true, 120, 90)]), 1);
  assert.equal(compareRecords(ft, [r(false, 600, 50)], [r(false, 600, 50)]), 0);
});
test("team3 ordering counts finishers before unfinished reps before completed time sums", () => {
  const a = [r(true, 500, 90), r(true, 500, 90), r(false, 600, 1)];
  const b = [r(true, 20, 90), r(false, 600, 89), r(false, 600, 89)];
  assert.equal(compareRecords(ft, a, b), 1);
  assert.equal(
    compareRecords(ft, a, [
      r(true, 100, 90),
      r(true, 100, 90),
      r(false, 600, 2),
    ]),
    -1,
  );
  assert.equal(
    compareRecords(ft, a, [
      r(true, 499, 90),
      r(true, 500, 90),
      r(false, 600, 1),
    ]),
    -1,
  );
});
test("AMRAP sums valid reps without subtracting no-reps twice; roster and inconsistent records rejected", () => {
  assert.equal(
    compareRecords(
      TEMPLATES[2],
      [r(false, 480, 40, 10), r(false, 480, 20)],
      [r(false, 480, 59)],
    ),
    1,
  );
  assert.equal(
    compareRecords(TEMPLATES[2], [r(false, 480, 40)], [r(false, 480, 40)]),
    0,
  );
  assert.throws(() => validateRecords(ft, ["a"], [r(true, 100, 89)]), /완료/);
  assert.throws(() => validateRecords(ft, ["a"], [r(false, 100, 89)]), /완료/);
  assert.throws(
    () => validateRecords(ft, ["a", "b"], [r(true, 100, 90), r(true, 100, 90)]),
    /명단/,
  );
  assert.throws(() => validateRecords(ft, ["a"], [r(true, -1, 90)]), /시간/);
  assert.throws(
    () => validateRecords(TEMPLATES[2], ["a"], [r(false, 400, 20)]),
    /시간/,
  );
  assert.equal(validateRecords(ft, ["a"], [r(false, 600, 89)])[0].reps, 89);
});
