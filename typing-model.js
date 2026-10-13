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

  function pruneWrongRecords(records, inputLength) {
    return records.filter((record) => record.index < inputLength);
  }

  function trailingCombo(chars, input) {
    let count = 0;
    for (let i = input.length - 1; i >= 0; i -= 1) {
      if (chars[i]?.char !== input[i]) break;
      count += 1;
    }
    return count;
  }

  function maxCombo(chars, input) {
    let run = 0;
    let best = 0;
    [...input].forEach((char, index) => {
      if (chars[index]?.char === char) {
        run += 1;
        best = Math.max(best, run);
      } else run = 0;
    });
    return best;
  }

  function shouldPersist(input) {
    if (input.totalCount > 0 && input.inputLength === input.totalCount) return true;
    return Boolean(input.timedExpired && input.typingViewVisible);
  }

  function elapsedMs(clock, now) {
    const base = clock.accumulatedMs;
    if (!clock.running || clock.segmentStartedAt == null) return base;
    return base + Math.max(0, now - clock.segmentStartedAt);
  }

  function pauseTimer(clock, now) {
    return { accumulatedMs: elapsedMs(clock, now), running: false, segmentStartedAt: null };
  }

  function resumeTimer(clock, now) {
    if (clock.running) return clock;
    return { accumulatedMs: clock.accumulatedMs, running: true, segmentStartedAt: now };
  }

  function shouldResume(input) {
    if (input.finished) return false;
    if (input.mode === "timed") return input.timedApplied;
    return input.typingStarted;
  }

  function timedRemainSeconds(durationSeconds, elapsedMsValue) {
    return Math.max(0, durationSeconds - Math.floor(elapsedMsValue / 1000));
  }

  function nextCustomId(serial) {
    const next = Math.max(0, Math.floor(serial)) + 1;
    return { id: `custom-${next}`, serial: next };
  }

  function storageKeys(id) {
    return {
      errors: "typingCumulativeErrors:guest",
      stats: "typingArticleStats:guest",
      review: `typingReview:${id}:guest`,
      done: `typingExercise:${id}:guest`,
      customSerial: "typingCustomSerial:guest"
    };
  }

  function articleStatsFromStorage(raw) {
    if (!raw || typeof raw !== "object" || !raw.byId || typeof raw.byId !== "object") {
      return { byId: {} };
    }
    return { byId: raw.byId };
  }

  function writeJson(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function isTypingView(view) {
    return view !== "dictation";
  }

  return {
    layout, wpm, emptyPracticeStat, applyPracticeStat, averageWpm,
    pruneWrongRecords, trailingCombo, maxCombo, shouldPersist,
    elapsedMs, pauseTimer, resumeTimer, shouldResume, timedRemainSeconds,
    nextCustomId, storageKeys, articleStatsFromStorage, writeJson, isTypingView
  };
});
