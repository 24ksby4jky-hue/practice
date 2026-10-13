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

  return { layout };
});
