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

// 按常见 IELTS Task 2 议题编排的原创材料，不是官方真题或固定题目清单。
export const TOPICS = [
  { id: "education", name: "教育与学习" }, { id: "environment", name: "环境与能源" },
  { id: "technology", name: "科技与互联网" }, { id: "health", name: "健康与生活方式" },
  { id: "work", name: "工作与就业" }, { id: "government", name: "政府与公共服务" },
  { id: "crime", name: "犯罪与法律" }, { id: "media", name: "媒体与广告" },
  { id: "culture", name: "文化、艺术与旅游" }, { id: "family", name: "家庭与社会" },
  { id: "transport", name: "城市、住房与交通" }, { id: "globalisation", name: "全球化与发展" }
];

// 每行：基础论点 | 中文意思。练习从这里起步：学生自己把这一句写得更正式，
// 再从七种论证方法里选着展开，最后把勾中的句子融合成一段。
// 只取前两段，所以题库行里多出来的旧字段不会影响这里 —— 题目重排可以独立做。
function buildExercises(rows, topic) {
  return rows.map((row, index) => {
    const [claim, meaning] = String(row).split("|");
    if (!claim?.trim() || !meaning?.trim()) throw new Error(`题库条目缺少字段：${topic}-${index + 1}`);
    return { id: topic === "education" && index === 0 ? "campus-books" : `${topic}-${String(index + 1).padStart(2, "0")}`,
      topic, claim: claim.trim(), meaning: meaning.trim() };
  });
}

const banks = { education, environment, technology, health, work, government, crime, media, culture, family, transport, globalisation };
export const EXERCISES = TOPICS.flatMap((topic) => buildExercises(banks[topic.id], topic.id));
const lookup = new Map(EXERCISES.map((task) => [task.id, task]));
export const exerciseById = (id) => lookup.get(id) || null;
