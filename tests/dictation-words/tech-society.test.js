import test from "node:test";
import assert from "node:assert/strict";
import board from "../../src/dictation/words/tech-society.js";
import { assertBoard } from "../dictation-words-support.js";

test("tech-society board has 25 units of 20 valid words", () => {
  const sides = Array.from({ length: 25 }, (_, i) => (i < 12 ? "tech" : "society"));
  assertBoard(board, { id: "tech-society", name: "科技与社会", sides });
});
