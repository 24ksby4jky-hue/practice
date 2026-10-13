const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/academic-writing.js");
const campus = require("../../dictation/words/campus.js");
const { assertBoard } = require("../dictation-words-support.js");

test("academic-writing board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "academic-writing", name: "学术写作" });
});

test("academic-writing unit 1 keeps the original six words in order", () => {
  assert.deepEqual(board.units[0].words.slice(0, 6), [
    { word: "analyze", pos: "v.", phonetic: "/ˈænəlaɪz/", meaning: "分析", example: "Analyze the results before you draw a conclusion." },
    { word: "evidence", pos: "n.", phonetic: "/ˈevɪdəns/", meaning: "证据", example: "The essay needs evidence from more than one source." },
    { word: "contrast", pos: "n.", phonetic: "/ˈkɒntrɑːst/", meaning: "对比", example: "The contrast between the two cities is sharp." },
    { word: "significant", pos: "adj.", phonetic: "/sɪɡˈnɪfɪkənt/", meaning: "显著的", example: "There was a significant rise in bicycle trips." },
    { word: "approach", pos: "n.", phonetic: "/əˈprəʊtʃ/", meaning: "方法", example: "A slower approach produced fewer spelling errors." },
    { word: "conclusion", pos: "n.", phonetic: "/kənˈkluːʒn/", meaning: "结论", example: "The conclusion should answer the question directly." }
  ]);
});

test("academic-writing keeps one entry per word family and stays on topic and level", () => {
  const words = new Set(board.units.flatMap((unit) => unit.words.map((entry) => entry.word)));
  const offTopic = [
    "clause", "copyright", "reprint", "ellipsis", "parenthesis", "bracket", "hyphen", "colon",
    "semicolon", "apostrophe", "italic", "indent", "caption", "label", "preface", "afterword",
    "style", "tone", "vivid", "wordy", "verbose", "succinct", "redundant", "repetitive",
    "outline", "theme", "topic", "focus", "jargon", "coin", "digress",
    "rarely", "seldom", "scarcely", "barely", "virtually", "strictly", "broadly", "narrowly",
    "loosely", "merely", "solely", "exclusively"
  ];
  const tooBasicOrRare = [
    "although", "unless", "despite", "besides", "throughout", "unlike", "beyond", "however",
    "therefore", "thus", "hence", "wherever", "error", "apply", "judge", "article", "author",
    "clue", "witness", "index", "degree", "extent", "briefly", "typically", "generally",
    "particularly", "whilst", "albeit", "doubtless", "purportedly", "notwithstanding", "cogent",
    "tenable", "monograph", "treatise", "relic", "remnant"
  ];
  const derivedForms = [
    "partially", "citation", "quotation", "validate", "validity", "comparison", "comparable",
    "assertion", "controversial", "contradiction", "inconsistent", "reliability", "credibility",
    "persuasive", "hypothetical", "theoretical", "deduction", "statistical", "correlate",
    "causal", "anecdote", "inaccurate", "investigation", "scrutiny", "evaluation",
    "interpretation", "criticism", "criticize", "critic", "publish", "authoritative", "summary",
    "attribution", "implication", "implicit", "significance", "insignificant", "signify",
    "disprove", "proof", "comprise", "indication", "misrepresent", "documentary", "testify",
    "verifiable", "quantify", "vary", "variation", "differentiate", "resemblance", "similarity",
    "divergence", "alternative", "paradoxical", "ironic", "conclude", "conclusive",
    "inconclusive", "resolution", "recommendation", "prediction", "generalization", "relevance",
    "irrelevant", "applicable", "consequently", "ultimate", "reaffirm", "opposite", "coherence",
    "ambiguity", "emphasis", "definition", "define", "evidently", "presumably", "arguably",
    "primarily", "unquestionably"
  ];
  for (const word of [...offTopic, ...tooBasicOrRare, ...derivedForms]) {
    assert.equal(words.has(word), false, `${word} should not be on this board`);
  }
});

test("academic-writing does not reuse campus words and leaves out increase", () => {
  const campusWords = new Set(
    campus.units.flatMap((unit) => unit.words.map((entry) => entry.word.toLowerCase()))
  );
  const words = board.units.flatMap((unit) => unit.words.map((entry) => entry.word.toLowerCase()));
  assert.deepEqual(words.filter((word) => campusWords.has(word)), []);
  assert.equal(words.includes("increase"), false);
});
