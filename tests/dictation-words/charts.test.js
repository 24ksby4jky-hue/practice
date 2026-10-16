import test from "node:test";
import assert from "node:assert/strict";
import board from "../../src/dictation/words/charts.js";
import campus from "../../src/dictation/words/campus.js";
import academic from "../../src/dictation/words/academic-writing.js";
import { assertBoard } from "../dictation-words-support.js";

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

test("charts stays on the band and on 升降、比例、波动、对比、趋势", () => {
  const words = new Set(wordsOf(board));
  const keptCollocates = ["sharp", "steep", "steady", "sudden", "slight", "gradual", "double"];
  for (const word of keptCollocates) {
    assert.equal(words.has(word), true, `${word} is a chart collocate and should stay`);
  }
  const tooBasic = [
    "entire", "exact", "rough", "grim", "gentle", "enormous", "vast", "equal", "constant",
    "lower", "reduce", "climb", "narrow", "widen", "shift", "immense", "massive", "tremendous",
    "colossal", "ease", "tilt", "tighten", "loosen", "soften", "dismal", "bleak", "gloomy",
    "upbeat", "stellar", "spectacular", "phenomenal"
  ];
  const tooRare = [
    "apex", "zenith", "nadir", "plethora", "manifold", "copious", "inordinate", "exorbitant",
    "modicum", "tailspin", "preponderance", "meteoric", "precipitous"
  ];
  const causeAndProcess = [
    "hamper", "impede", "hinder", "stifle", "stunt", "dampen", "stimulate", "spur", "propel",
    "monitor", "compute", "undercut", "displace", "align", "linger", "zigzag"
  ];
  const evaluative = ["lucrative", "mediocre", "respectable", "typical", "bumper"];
  const eventAndMetaphor = [
    "outset", "aftermath", "fallout", "pendulum", "seesaw", "breakthrough", "watershed",
    "juncture", "comeback", "tide", "fad", "craze", "vogue", "inertia", "barometer", "metric"
  ];
  const generalWords = ["ubiquitous", "pervasive", "rife", "commonplace", "chiefly", "altogether"];
  const economicsSubjects = [
    "recession", "boom", "glut", "dearth", "influx", "exodus", "inflow", "outflow", "deficit"
  ];
  const relatedForms = ["subtotal"];
  for (const word of [
    ...tooBasic, ...tooRare, ...causeAndProcess, ...evaluative, ...eventAndMetaphor,
    ...generalWords, ...economicsSubjects, ...relatedForms
  ]) {
    assert.equal(words.has(word), false, `${word} should not be on this board`);
  }
});

test("charts drops broad everyday words and keeps drop, jump, share, total, range, vary", () => {
  const words = new Set(wordsOf(board));
  for (const word of ["drop", "jump", "share", "total", "range", "vary"]) {
    assert.equal(words.has(word), true, `${word} describes charts and should stay`);
  }
  const tooBroad = [
    "remain", "minor", "major", "fixed", "sink", "edge", "crawl", "smooth", "floor", "lately",
    "overnight", "afterwards", "onwards", "grid", "layer", "chunk", "healthy", "solid",
    "comfortable", "mixed", "faint", "slim", "phase", "extent", "spell", "episode", "stretch",
    "gulf", "divide", "upside", "downside", "uplift"
  ];
  for (const word of tooBroad) {
    assert.equal(words.has(word), false, `${word} should not be on this board`);
  }
  assert.equal(words.has("remainder"), true);
});

test("charts leaves out finance and everyday words and keeps the controller-approved collocates", () => {
  const words = new Set(wordsOf(board));
  for (const word of ["depreciate", "accrue", "compound", "day-to-day", "series", "pale"]) {
    assert.equal(words.has(word), false, `${word} should not be on this board`);
  }
  const kept = [
    "drop", "jump", "share", "total", "range", "vary",
    "sharp", "steep", "steady", "sudden", "slight", "gradual", "double"
  ];
  for (const word of kept) {
    assert.equal(words.has(word), true, `${word} should stay on this board`);
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
