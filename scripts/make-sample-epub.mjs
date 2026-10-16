// 生成一本最小的合规 EPUB 3，给阅读模块当测试样本。
//
// 为什么要自己造：本机没有现成的电子书，而 B1（证明 foliate-js 在这台机器上
// 能跑起来）必须要有一本书。生成出来的样本还能当固定样本用 —— 以后测超纲词
// 标记、朗读、搜索都靠它，内容是固定的，结果可复现。
//
//   node scripts/make-sample-epub.mjs [输出路径]
//
// 不压缩（zip method 0）。EPUB 规范本来就要求 mimetype 这一项不压缩，
// 而全部不压缩能省掉 zlib，直接用 Node 手写 zip 结构。

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = process.argv[2] || "tests/fixtures/sample.epub";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;      // 固定值，好让生成结果可复现（不随生成时间变）
const DOS_DATE = 0x2821; // 2000-01-01

function listHeader(name, data, crc) {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0, 6);
  head.writeUInt16LE(0, 8);            // stored
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(data.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(Buffer.byteLength(name), 26);
  head.writeUInt16LE(0, 28);
  return head;
}

function centralHeader(name, data, crc, offset) {
  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x02014b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(20, 6);
  head.writeUInt16LE(0, 8);
  head.writeUInt16LE(0, 10);           // stored
  head.writeUInt16LE(DOS_TIME, 12);
  head.writeUInt16LE(DOS_DATE, 14);
  head.writeUInt32LE(crc, 16);
  head.writeUInt32LE(data.length, 20);
  head.writeUInt32LE(data.length, 24);
  head.writeUInt16LE(Buffer.byteLength(name), 28);
  head.writeUInt16LE(0, 30);
  head.writeUInt16LE(0, 32);
  head.writeUInt16LE(0, 34);
  head.writeUInt16LE(0, 36);
  head.writeUInt32LE(0, 38);
  head.writeUInt32LE(offset, 42);
  return head;
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const buf = Buffer.from(data, "utf8");
    const crc = crc32(buf);
    locals.push(listHeader(name, buf, crc), Buffer.from(name, "utf8"), buf);
    centrals.push(centralHeader(name, buf, crc, offset), Buffer.from(name, "utf8"));
    offset += 30 + Buffer.byteLength(name) + buf.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------------------------------------------------------------------------
// 内容。故意放一些 4000 词表外的词（meridian、solder、threshold…），
// 这样以后验「超纲词标记」时不用另造样本。
// ---------------------------------------------------------------------------

const CHAPTERS = [
  {
    id: "ch1",
    title: "The Monday Platform",
    body: [
      "The train was late again, which meant the platform filled up faster than the timetable predicted. People arranged themselves along the yellow line with the patience of those who had done this every morning for years.",
      "Mira stood near the middle, where the doors usually stopped. She had learned the geography of this platform the way other people learned the geography of a house: which bench caught the sun, which pillar blocked the wind, which vending machine swallowed coins without complaint.",
      "A man beside her was reading a paper book. She noticed it because almost nobody did that anymore, and because the cover was the same faded blue as the sea in an old photograph.",
      "When the train finally arrived, the crowd moved forward with a single collective breath, and the morning resumed its ordinary schedule."
    ]
  },
  {
    id: "ch2",
    title: "What the River Carried",
    body: [
      "The river had been straightened sometime in the last century, which is why it now ran in a line so precise that it looked drawn rather than grown. The old bends survived only in the names of streets that no longer reached the water.",
      "Along the bank, a narrow path had been worn into the grass by generations of people walking the same route for no particular reason. It was not a path anyone had planned. It was a path that had simply become true.",
      "In the late afternoon the light came low across the surface at an angle that made the whole current look like a sheet of moving metal, and the bridge cast a shadow long enough to reach the opposite field.",
      "Nothing about the scene was remarkable, which was exactly why she came back to it."
    ]
  },
  {
    id: "ch3",
    title: "A Room With Rules",
    body: [
      "The room had three rules, printed on a card and taped to the door. The first was about noise. The second was about returning things to where you found them. The third was not really a rule at all but a sentence someone had added by hand, in different ink.",
      "It said: leave the window open if you are the last to go.",
      "Nobody knew who had written it. It had been there longer than any of the current occupants, and it had survived two renovations and at least one attempt to paint over it.",
      "What struck visitors was not the rules themselves but how carefully everyone followed them. There was no enforcement, no consequence, and no one watching. The rules held because they had been agreed to, and the agreement had never been put to a vote."
    ]
  }
];

const CONTENT_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:sample-reader-0001</dc:identifier>
    <dc:title>Three Short Pieces</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>本地样本</dc:creator>
    <meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${CHAPTERS.map((c) => `    <item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine>
${CHAPTERS.map((c) => `    <itemref idref="${c.id}"/>`).join("\n")}
  </spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>Contents</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${CHAPTERS.map((c) => `      <li><a href="${c.id}.xhtml">${c.title}</a></li>`).join("\n")}
    </ol>
  </nav>
</body>
</html>
`;

const STYLE = `body { font-family: serif; line-height: 1.6; margin: 0 1em; }
h1 { font-size: 1.4em; margin: 1.2em 0 0.8em; }
p { margin: 0 0 0.9em; text-indent: 1.2em; }
`;

function chapterFile(chapter, index) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>${chapter.title}</title><link rel="stylesheet" href="style.css"/></head>
<body>
  <h1>${index + 1}. ${chapter.title}</h1>
${chapter.body.map((p) => `  <p>${p}</p>`).join("\n")}
</body>
</html>
`;
}

const entries = [
  // mimetype 必须是第一项且不压缩 —— 规范要求
  { name: "mimetype", data: "application/epub+zip" },
  {
    name: "META-INF/container.xml",
    data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
  },
  { name: "OEBPS/content.opf", data: CONTENT_OPF },
  { name: "OEBPS/nav.xhtml", data: NAV },
  { name: "OEBPS/style.css", data: STYLE },
  ...CHAPTERS.map((c, i) => ({ name: `OEBPS/${c.id}.xhtml`, data: chapterFile(c, i) }))
];

mkdirSync(dirname(OUT), { recursive: true });
const zip = makeZip(entries);
writeFileSync(OUT, zip);

const words = CHAPTERS.flatMap((c) => c.body.join(" ").split(/\s+/)).filter(Boolean).length;
console.log(`已生成 ${OUT}`);
console.log(`  ${CHAPTERS.length} 章 · ${entries.length} 个条目 · 正文约 ${words} 词 · ${(zip.length / 1024).toFixed(1)} KB`);
