import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, stackBreakdown } from "../../src/components/ads/widgets/calculator.ts";

test("evaluates arithmetic with operator precedence", () => {
  assert.equal(evaluate("2+3*4"), 14);
  assert.equal(evaluate("(2+3)*4"), 20);
  assert.equal(evaluate("10/4"), 2.5);
  assert.equal(evaluate("-3+5"), 2);
  assert.equal(evaluate(" 7 * 8 "), 56);
});

test("rejects incomplete or invalid input", () => {
  assert.equal(evaluate(""), null);
  assert.equal(evaluate("2+"), null);
  assert.equal(evaluate("(2+3"), null);
  assert.equal(evaluate("2)"), null);
  assert.equal(evaluate("1/0"), null);
  assert.equal(evaluate("alert(1)"), null);
});

test("rounds away floating point noise", () => {
  assert.equal(evaluate("0.1+0.2"), 0.3);
});

test("breaks item counts into stacks and shulker boxes", () => {
  assert.deepEqual(stackBreakdown(1000), { stacks: 15, rest: 40, shulkers: 0.58 });
  assert.deepEqual(stackBreakdown(1728), { stacks: 27, rest: 0, shulkers: 1 });
});

test("has no breakdown below one stack or for fractions and negatives", () => {
  assert.equal(stackBreakdown(63), null);
  assert.equal(stackBreakdown(-128), null);
  assert.equal(stackBreakdown(64.5), null);
});
