import { dictionaryShard } from "../../src/reading/dictionary-model.js";

// 原创小词典，完整释义使用多个义项和双语例句验证展开行为。
export const dictionary = {
  children: [{ word: "children", html: '<p>Children is the plural of <span>child</span>.</p>' }],
  child: [{ word: "child", html: '<div class="C1_word_header"><span class="C1_word_header_word">child</span></div><div class="C1_explanation_item"><div class="C1_explanation_box">儿童；a young person.</div><ul><li><p class="C1_sentence_en">The child reads a book.</p><p>这个孩子读一本书。</p></li></ul></div>' }],
  book: [{ word: "book", html: '<div class="C1_word_header"><span class="C1_word_header_word">book</span></div><div class="C1_explanation_item"><div class="C1_explanation_box">书；a written work.</div><ul><li><p class="C1_sentence_en">I chose a new book.</p><p>我选了一本新书。</p></li></ul></div><div class="C1_explanation_item"><div class="C1_explanation_box">预订；to reserve a place.</div><ul><li><p class="C1_sentence_en">We book a room.</p><p>我们预订一个房间。</p></li></ul><script>window.dictionaryAttack=true</script><img src="https://invalid.example/track" onerror="window.dictionaryAttack=true"></div>' }]
};

export async function fulfillDictionary(route) {
  const filename = new URL(route.request().url()).pathname.split("/").pop();
  if (filename === "manifest.json") return route.fulfill({ json: { version: 1, count: 3, fingerprint: "test", title: "测试英汉词典" } });
  const shard = filename.replace(".json", "");
  const rows = Object.fromEntries(Object.entries(dictionary).filter(([word]) => dictionaryShard(word) === shard));
  return route.fulfill({ json: rows });
}

export async function dictionaryRoutes(page) { await page.route("**/dictionaries/collins/**", fulfillDictionary); }
