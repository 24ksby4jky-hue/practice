// Vite 的入口，也是 index.html 里唯一的脚本。
//
// 顺序是有意义的，不是随便排的：
//   1. typing/app.js          在模块求值时就把打字台准备好（applyArticle(0)）
//   2. dictation/dictation.js 画好听写的 DOM，并把自己注册进 View
//   3. home.js                建首页格子，最后落到首页
// 阅读模块以后也挂在这里。
import "./typing/app.js";
import "./dictation/dictation.js";
import "./home.js";
