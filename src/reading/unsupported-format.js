// 桩模块 —— 只为满足 Vite 的 import-analysis 而存在。见 vite.config.js。
//
// foliate-js 的 view.js 里有两个懒加载分支我们故意不支持：
//   ./pdf.js           PDF。它的实现写死了 Readest 自己的构建：`@pdfjs` 是他们的
//                      Vite 别名，还有 `/vendor/pdfjs/` 绝对路径和一整套拷 worker /
//                      WASM / cmaps 的 npm 脚本。
//   ./fixed-layout.js  固定版式 EPUB。第一行是裸导入 construct-style-sheets-polyfill。
//
// 这两个模块正常情况下永远不会被 import 到（只有真去打开 PDF / 固定版式才会走到），
// 但 Vite 在**转换期**就会解析动态 import 的说明符，文件不存在直接整个模块 500。
// 所以用 vite.config.js 把它们重定向到这里。
//
// 放在模块顶层抛错是有意的：真打开这类书时，错误会沿着
// `view.open()` → reader.js 的 catch 冒上来，显示成「打不开这本书：…」，
// 而不是悄悄渲染出一片空白让人以为是坏了。
throw new Error("这个版本只支持重排版的 EPUB / MOBI / FB2 / CBZ，不支持 PDF 和固定版式的书。");
