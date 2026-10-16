import { MDX } from "js-mdict";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { dictionaryShard, normalizeDictionaryKey } from "../src/reading/dictionary-model.js";

const source = process.argv[2] || process.env.COLLINS_MDX;
if (!source) {
  console.error('用法：npm run dictionary:import -- "词库文件夹或 .mdx 文件路径"');
  process.exit(1);
}
let path = resolve(source);
if (statSync(path).isDirectory()) {
  const files = readdirSync(path).filter((name) => /\.mdx$/i.test(name));
  if (files.length !== 1) throw new Error("文件夹内需要恰好一个 MDX 文件，也可以直接指定文件路径。");
  path = join(path, files[0]);
}
const dictionary = new MDX(path);
const output = resolve("public/dictionaries/collins");
mkdirSync(output, { recursive: true });
const shards = Array.from({ length: 256 }, () => Object.create(null));
let count = 0;
try {
  for (const item of dictionary.keywordList) {
    const key = normalizeDictionaryKey(item.keyText);
    if (!key) continue;
    const entry = dictionary.fetch(item);
    if (!entry.definition) continue;
    const html = entry.definition.replace(/\u0000/g, "").trim();
    const shard = shards[parseInt(dictionaryShard(key), 16)];
    (shard[key] ||= []).push({ word: item.keyText, html });
    count += 1;
    if (count % 5000 === 0) console.log(`已转换 ${count} 个词条…`);
  }
} finally { dictionary.close(); }
const fingerprint = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
for (let index = 0; index < shards.length; index += 1) {
  writeFileSync(join(output, `${index.toString(16).padStart(2, "0")}.json`), JSON.stringify(shards[index]));
}
// 最后写清单，避免导入中途被浏览器误认为已完成。
writeFileSync(join(output, "manifest.json"), JSON.stringify({ version: 1,
  title: "柯林斯高阶英汉双解学习词典", count, fingerprint, shards: 256 }, null, 2));
console.log(`完成：${count} 个词条，输出 ${output}`);
