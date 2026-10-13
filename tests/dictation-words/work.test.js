const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/work.js");
const { assertBoard } = require("../dictation-words-support.js");

const REMOVED = [
  "insubordination", "telemarketer", "flexitime", "boardroom", "headquarters", "subsidiary", "conglomerate", "startup", "enterprise", "franchise",
  "joint-venture", "merger", "takeover", "buyout", "spinoff", "cooperative", "cartel", "divest", "liquidate", "insolvent",
  "ledger", "accrual", "overhead", "outlay", "disbursement", "remittance", "rebate", "surcharge", "write-off", "windfall",
  "variance", "opening", "crew", "report", "replace", "chase", "stamp", "warning", "table", "funnel",
  "culture", "remote", "target", "output", "rung", "pipeline", "dun", "docket", "copyist", "preceptor",
  "underling", "surety", "millwright", "turner", "lexicographer", "quartermaster", "agronomist", "gamekeeper", "comp-time", "whistleblow",
  "maternity", "paternity", "clock-in", "clock-out", "sign-off", "wind-up"
];

test("work board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "work", name: "工作与职业" });
});

test("work board does not bring back the words removed in review", () => {
  const words = new Set(board.units.flatMap((unit) => unit.words.map((entry) => entry.word)));
  const back = REMOVED.filter((word) => words.has(word));
  assert.deepEqual(back, []);
});
