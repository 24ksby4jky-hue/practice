// 七种论证方法的唯一来源。领域层用它校验块的合法性，AI 层用它拼提示词，
// UI 用它渲染选择菜单 —— 三处都读这里，衔接词不在别处再抄一遍。
export const ARGUMENT_METHODS = [
  { id: "cause", name: "因果", en: "cause and effect",
    connectives: ["This is because", "As a result", "Consequently", "This, in turn, leads to"],
    note: "解释现象为什么发生，以及会产生什么结果。" },
  { id: "example", name: "举例", en: "example",
    connectives: ["For example", "For instance", "A typical example of this is", "To illustrate"],
    note: "举一个具体例子；不要为了显得专业而编造精确数据或研究结论。" },
  { id: "contrast", name: "对比", en: "contrast",
    connectives: ["Unlike", "In contrast", "Compared with", "Whereas", "While"],
    note: "比较两种方案、现象或结果，突出其中一方。" },
  { id: "hypothesis", name: "假设", en: "hypothetical",
    connectives: ["If", "Suppose that", "Without", "Otherwise", "Were it not for"],
    note: "用合理的假设推出某种做法可能的结果。" },
  { id: "concession", name: "让步", en: "concession",
    connectives: ["Admittedly", "Although", "Nevertheless", "However", "Despite this"],
    note: "先承认对立观点有一定道理，最后必须回到自己的立场。" },
  { id: "classification", name: "分类", en: "classification",
    connectives: ["From an economic perspective", "For individuals", "At the societal level", "Another important aspect is"],
    note: "从不同群体、角度或维度分析，宜选两三个能展开的角度。" },
  { id: "rebuttal", name: "反驳", en: "rebuttal",
    connectives: ["This argument overlooks", "However, this view fails to consider", "This assumption is questionable because"],
    note: "指出对立观点的逻辑缺陷、适用限制或被忽略的因素。" }
];

export const METHOD_IDS = new Set(ARGUMENT_METHODS.map((item) => item.id));

export function methodById(id) {
  return ARGUMENT_METHODS.find((item) => item.id === id) || null;
}
