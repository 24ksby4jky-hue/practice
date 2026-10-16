import campus from "./campus.js";
import academicWriting from "./academic-writing.js";
import charts from "./charts.js";
import dailyLife from "./daily-life.js";
import cityTravel from "./city-travel.js";
import work from "./work.js";
import healthEnvironment from "./health-environment.js";
import techSociety from "./tech-society.js";

// 8 个板块的顺序就由这个数组决定。
//
// 以前这个顺序是隐式的：index.html 里 <script> 标签的先后，决定每个文件
// 往 globalThis.DictationWords 里推的顺序。迁到 ES 模块之后全局没有了，
// 所以把顺序写成显式的一处 —— 听写和生词本都从这里取，不再各写一份。
//
// 顺序必须和 dictation-model.js 的 BOARDS 一致，tests/dictation-words.test.js 会钉住。
const boards = [
  campus, academicWriting, charts, dailyLife,
  cityTravel, work, healthEnvironment, techSociety
];

export default boards;
