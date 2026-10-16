import education from "./topics/education.js";
import environment from "./topics/environment.js";
import technology from "./topics/technology.js";
import health from "./topics/health.js";
import work from "./topics/work.js";
import government from "./topics/government.js";
import crime from "./topics/crime.js";
import media from "./topics/media.js";
import culture from "./topics/culture.js";
import family from "./topics/family.js";
import transport from "./topics/transport.js";
import globalisation from "./topics/globalisation.js";
import { EXERCISES as legacy } from "./legacy-exercises.js";

// 按常见 IELTS Task 2 议题编排的原创材料，不是官方真题或固定题目清单。
export const TOPICS = [
  { id: "education", name: "教育与学习" }, { id: "environment", name: "环境与能源" },
  { id: "technology", name: "科技与互联网" }, { id: "health", name: "健康与生活方式" },
  { id: "work", name: "工作与就业" }, { id: "government", name: "政府与公共服务" },
  { id: "crime", name: "犯罪与法律" }, { id: "media", name: "媒体与广告" },
  { id: "culture", name: "文化、艺术与旅游" }, { id: "family", name: "家庭与社会" },
  { id: "transport", name: "城市、住房与交通" }, { id: "globalisation", name: "全球化与发展" }
];
export const LEVELS = [{ id: "basic", name: "基础", note: "常用词汇，短语扩写" },
  { id: "advanced", name: "进阶", note: "自然搭配，尝试从句" }];

function append(sentence, fragment) {
  return `${sentence.replace(/\.$/, "")}${fragment.startsWith(",") ? "" : " "}${fragment}.`;
}

// 每行：基础句 | 中文意思 | 细节 | 方式或情境 | 原因、目的、影响或让步。
// 参考句逐步叠加，确保后一步保留前一步的信息。
function buildExercises(rows, topic) {
  return rows.map((row, index) => {
    const [core, meaning, detail, context, logic] = row.split("|");
    if (!core || !meaning || !detail || !context || !logic) throw new Error(`题库条目缺少字段：${topic}-${index + 1}`);
    const first = append(core, detail);
    const second = append(first, context);
    const final = append(second, logic);
    const method = /^(by |through |using |with )/.test(context);
    const purpose = logic.startsWith("to ");
    const cause = logic.startsWith("because ");
    const concession = /^(although |even though |even if |unless |when )/.test(logic);
    const mechanism = logic.startsWith("by ");
    const contrast = /^(rather than |without |while )/.test(logic);
    return { id: topic === "education" && index === 0 ? "campus-books" : `${topic}-${String(index + 1).padStart(2, "0")}`,
      topic, core, meaning,
      steps: [
        { goal: "补充具体对象、范围或特征，让核心观点更明确。", hint: `可以考虑这个表达：${detail}。`, reference: first },
        { goal: method ? "保留已有信息，补充具体做法或实现方式。" : "保留已有信息，补充适用条件或具体情境。",
          hint: `可以考虑这个表达：${context}。`, reference: second },
        { goal: purpose ? "说明这一做法的目的。" : cause ? "解释这一观点成立的原因。"
          : concession ? "补充让步或条件，说明观点的适用边界。"
          : mechanism ? "补充作用机制，说明这一做法如何产生影响。"
          : contrast ? "补充对照或限制，让论述更严谨。" : "说明可能的影响或结果，使论述更完整。",
          hint: `可以尝试用 ${purpose ? "to + 动词" : cause ? "because" : mechanism ? "by + 动词的 -ing 形式" : concession ? logic.split(" ")[0] : logic.startsWith(",") ? "which 引导的补充说明" : logic.split(" ").slice(0, 2).join(" ")} 连接后半句。`, reference: final }
      ] };
  });
}

const banks = { education, environment, technology, health, work, government, crime, media, culture, family, transport, globalisation };
export const EXERCISES = TOPICS.flatMap((topic) => buildExercises(banks[topic.id], topic.id));
const lookup = new Map(EXERCISES.map((task) => [task.id, task]));
// 旧题不出现在新列表，已有草稿和完成记录仍然可查、可回顾。
const legacyTopics = { campus: "education", daily: "family", work: "work", society: "technology" };
for (const task of legacy) {
  if (!lookup.has(task.id)) lookup.set(task.id, { ...task, topic: legacyTopics[task.topic] });
}
export const exerciseById = (id) => lookup.get(id) || null;
