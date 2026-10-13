const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/daily-life.js");
const { assertBoard } = require("../dictation-words-support.js");

// Words removed in review: too basic, too rare as single objects, off theme, or not a lemma.
const REMOVED = [
  "pork", "beef", "cheese", "butter", "cream", "honey", "jam", "lemon", "lime", "peach",
  "plum", "cherry", "fig", "crab", "soda", "mug", "jar", "tray", "oven", "stove",
  "dish", "stir", "peel", "fry", "bake", "chew", "ripe", "sour", "skirt", "belt",
  "glove", "cotton", "wool", "jacket", "price", "gift", "tip", "bill", "tag", "fog",
  "mud", "dew", "frost", "melt", "freeze", "soap", "nail", "ladder", "paint", "pillow",
  "shallot", "chive", "guava", "lychee", "persimmon", "zucchini", "turnip", "beetroot", "leek", "griddle",
  "goblet", "trowel", "kennel", "colander", "sieve", "ladle", "poncho", "parasol", "visor", "windbreaker",
  "earmuffs", "cobweb", "grime", "smudge", "scour", "darn", "wring", "lint", "peg", "assemble",
  "repair", "unclog", "screwdriver", "hammer", "drill", "toolbox", "bulb", "fuse", "socket", "leak",
  "drip", "faucet", "glue", "wrench", "carpet", "curtain", "cushion", "blanket", "vase", "ornament",
  "closet", "cabinet", "drawer", "storage", "doormat", "lawn", "mow", "weed", "hose", "rake",
  "shovel", "flowerbed", "fence", "hedge", "prune", "soil", "wheelbarrow", "microwave", "refrigerator", "flashlight",
  "lantern", "barcode", "thermometer", "barometer", "meteorologist", "chef", "waiter", "hostess", "cashier", "florist",
  "butcher", "courier", "vendor", "retailer", "invoice", "debit", "installment", "surcharge", "wholesale", "shipment",
  "warranty", "promotion", "loyalty", "dawn", "dusk", "twilight", "horizon", "equinox", "solstice", "celsius",
  "booking", "warning", "padded", "unsettled", "scorching",
];

test("daily-life board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "daily-life", name: "日常生活" });
});

test("daily-life board does not bring back the words removed in review", () => {
  const words = new Set(board.units.flatMap((unit) => unit.words.map((entry) => entry.word)));
  const back = REMOVED.filter((word) => words.has(word));
  assert.deepEqual(back, []);
});
