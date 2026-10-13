const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/charts.js");
const campus = require("../../dictation/words/campus.js");
const academic = require("../../dictation/words/academic-writing.js");
const { assertBoard } = require("../dictation-words-support.js");

const wordsOf = (b) => b.units.flatMap((unit) => unit.words.map((entry) => entry.word.toLowerCase()));

test("charts board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "charts", name: "图表描述" });
});

test("charts unit 1 keeps the original six words in order", () => {
  assert.deepEqual(board.units[0].words.slice(0, 6), [
    { word: "increase", pos: "v.", phonetic: "/ɪnˈkriːs/", meaning: "增加", example: "Sales increase after the new lane opens." },
    { word: "decline", pos: "n.", phonetic: "/dɪˈklaɪn/", meaning: "下降", example: "The chart shows a steady decline in car use." },
    { word: "stable", pos: "adj.", phonetic: "/ˈsteɪbl/", meaning: "稳定的", example: "The figure stays stable for three weeks." },
    { word: "proportion", pos: "n.", phonetic: "/prəˈpɔːʃn/", meaning: "比例", example: "A large proportion of students walk to school." },
    { word: "fluctuate", pos: "v.", phonetic: "/ˈflʌktʃueɪt/", meaning: "波动", example: "Prices fluctuate from month to month." },
    { word: "trend", pos: "n.", phonetic: "/trend/", meaning: "趋势", example: "The overall trend is upward." }
  ]);
});

test("charts does not reuse campus or academic-writing words, and increase appears once", () => {
  const used = new Set([...wordsOf(campus), ...wordsOf(academic)]);
  const words = wordsOf(board);
  assert.deepEqual(words.filter((word) => used.has(word)), []);
  assert.equal(words.filter((word) => word === "increase").length, 1);
});

test("charts describes figures and leaves out chart-subject nouns and basic words", () => {
  const words = new Set(wordsOf(board));
  const subjectNouns = [
    "revenue", "expenditure", "income", "output", "demand", "supply", "consumption",
    "unemployment", "turnover", "profit", "earnings", "wage", "salary", "export", "import",
    "tourism", "commodity", "tariff", "subsidy", "invest", "capital", "asset", "liability",
    "debt", "currency", "pension", "levy", "dividend", "mortgage", "retail", "wholesale",
    "agriculture", "harvest", "crop", "fuel", "emission", "rainfall", "temperature", "drought",
    "literacy", "longevity", "mortality", "fertility", "migration", "urban", "rural", "elderly",
    "adolescent", "infant", "workforce", "payroll", "occupation", "headcount", "sector",
    "crisis", "bubble", "windfall", "backlog", "stockpile", "buffer", "quota", "attrition",
    "shortage", "shortfall"
  ];
  const belowBand = [
    "gap", "index", "average", "quarter", "foreign", "domestic", "nationwide", "worldwide",
    "brief", "mild", "nearly", "hardly", "alike", "digit", "numeral", "integer", "decimal",
    "dozen", "trillion", "fiscal", "interim", "net", "gross", "raw", "fortnight", "epoch",
    "millennium", "biennial", "era", "pace", "progress", "wave", "spreadsheet", "dataset"
  ];
  for (const word of [...subjectNouns, ...belowBand]) {
    assert.equal(words.has(word), false, `${word} should not be on this board`);
  }
});

test("charts keeps one entry per word family and stays off other topics", () => {
  const words = new Set(wordsOf(board));
  const derivedForms = [
    "increased", "increasing", "increasingly", "decreased", "decreasing", "declined", "declining",
    "fluctuation", "fluctuating", "proportional", "proportionally", "stability", "stabilize",
    "trending", "diminished", "growing", "dropping", "rising", "falling", "recovery", "growing"
  ];
  const offTopic = [
    "comma", "colon", "semicolon", "hyphen", "apostrophe", "bracket", "personality", "emotion",
    "traffic", "thesis", "argue", "premise", "rebut", "evidence", "essay"
  ];
  for (const word of [...derivedForms, ...offTopic]) {
    assert.equal(words.has(word), false, `${word} should not be on this board`);
  }
});
