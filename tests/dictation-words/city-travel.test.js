const test = require("node:test");
const assert = require("node:assert/strict");
const board = require("../../dictation/words/city-travel.js");
const { assertBoard } = require("../dictation-words-support.js");

const REMOVED = [
  "lodgings", "wanderlust", "vigil", "patrol", "surveillance", "checkpoint", "barricade", "cordon", "siren", "evacuate",
  "graffiti", "trespass", "loiter", "vandalism", "protest", "mob", "stampede", "riot", "pickpocket", "bystander",
  "launderette", "chemist", "jet-lag", "sewage", "wiring", "compass", "sanitation", "stride", "dash", "amble",
  "saunter", "jostle", "clamber", "lurch", "weave", "zigzag", "dodge", "pedal", "belfry", "citadel",
  "esplanade", "emporium", "tavern", "rotunda", "parapet", "banister", "eaves", "dormer", "gondola", "turnpike",
  "sidings", "cloverleaf", "gantry", "tumbledown", "guildhall", "lido", "maisonette", "nearside", "bandstand", "hamlet",
  "shack", "ramshackle", "passport", "visa", "helicopter", "palace", "temple", "fountain", "anchor", "lively",
  "remote", "convenient", "historic",
  "lintel", "gable", "colonnade", "cloister", "vestibule", "mews", "crypt", "alcove", "bridleway", "pillion",
  "chicane", "switchback", "leeward", "punt", "pontoon", "pantheon", "mausoleum", "obelisk", "minaret", "pagoda",
  "basilica", "piazza", "souk", "bullring", "velodrome", "contiguous", "abut", "hearth", "barracks", "senate",
];

test("city-travel board has 25 units of 20 valid words", () => {
  assertBoard(board, { id: "city-travel", name: "城市与出行" });
});

test("city-travel board does not bring back the words removed in review", () => {
  const words = new Set(board.units.flatMap((unit) => unit.words.map((entry) => entry.word)));
  const back = REMOVED.filter((word) => words.has(word));
  assert.deepEqual(back, []);
});
