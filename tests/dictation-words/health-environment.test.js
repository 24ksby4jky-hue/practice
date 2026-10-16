import test from "node:test";
import assert from "node:assert/strict";
import board from "../../src/dictation/words/health-environment.js";
import { assertBoard } from "../dictation-words-support.js";

test("health-environment board has 25 units of 20 valid words", () => {
  const sides = Array.from({ length: 25 }, (_, i) => (i < 12 ? "health" : "environment"));
  assertBoard(board, { id: "health-environment", name: "健康与环境", sides });
});
