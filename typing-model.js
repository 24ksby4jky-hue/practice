(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TypingModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function normalizeText(text) {
    return text.replace(/[\u2018\u2019\u201A\u201B\u2032\uFF07]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033\uFF02]/g, '"');
  }

  function layout(text, maxChars) {
    const source = normalizeText(text);
    const paragraphs = source.split("\n").map((line) => line.trim()).filter(Boolean);
    const lines = [];
    let bucket = [];
    let width = 0;
    let lineNo = 0;
    let index = 0;
    const flush = () => {
      if (!bucket.length) return;
      lines.push(bucket);
      bucket = [];
      width = 0;
      lineNo += 1;
    };
    const push = (char) => {
      bucket.push({ char, index, line: lineNo });
      index += 1;
    };
    paragraphs.forEach((paragraph, pIndex) => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      const lastParagraph = pIndex === paragraphs.length - 1;
      words.forEach((word, wIndex) => {
        const need = word.length + 1;
        if (width > 0 && width + need > maxChars) flush();
        [...word].forEach(push);
        width += need;
        const lastWord = wIndex === words.length - 1;
        if (!lastWord || lastParagraph) push(" ");
        else {
          push("\n");
          flush();
        }
      });
    });
    if (bucket.length) lines.push(bucket);
    return {
      lines,
      chars: lines.flat(),
      totalCount: index,
      wordsCount: source.trim().split(/\s+/).filter(Boolean).length
    };
  }

  function wordCount(input) {
    return input.trim() ? input.trim().split(/\s+/).filter(Boolean).length : 0;
  }

  function wpm(input, elapsedSecond) {
    const elapsed = Math.floor(elapsedSecond);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    const words = wordCount(input);
    if (words <= 0) return 0;
    return Math.round(words / (elapsed / 60));
  }

  function emptyPracticeStat() {
    return {
      practiceCount: 0,
      bestWpm: 0,
      wpmSum: 0,
      wpmSamples: 0,
      bestAccuracy: 0,
      accuracySum: 0
    };
  }

  function applyPracticeStat(prev, sample) {
    const base = prev || emptyPracticeStat();
    const elapsed = Math.floor(sample.elapsedSecond);
    const countWpm = Number.isFinite(elapsed) && elapsed >= 1;
    return {
      practiceCount: base.practiceCount + 1,
      bestWpm: countWpm ? Math.max(base.bestWpm, sample.wpm) : base.bestWpm,
      wpmSum: countWpm ? base.wpmSum + sample.wpm : base.wpmSum,
      wpmSamples: countWpm ? base.wpmSamples + 1 : base.wpmSamples,
      bestAccuracy: Math.max(base.bestAccuracy, sample.accuracy),
      accuracySum: base.accuracySum + sample.accuracy
    };
  }

  function averageWpm(stat) {
    if (!stat || !stat.wpmSamples) return 0;
    return Math.round(stat.wpmSum / stat.wpmSamples);
  }

  return { layout, wpm, emptyPracticeStat, applyPracticeStat, averageWpm };
});
