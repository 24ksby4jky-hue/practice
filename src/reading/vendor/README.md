# vendor/foliate —— 第三方阅读引擎

`foliate/` 里的文件**不是我们写的**，是 [foliate-js](https://github.com/readest/foliate-js)
的副本，用来渲染 EPUB / MOBI / FB2 / CBZ。

**来源**

| | |
| --- | --- |
| 仓库 | `https://github.com/readest/foliate-js`（Readest 的 fork，不是上游） |
| commit | `a1319f4b3535bd9fff14b01078409b0f645edd4e` |
| 许可 | **MIT**，Copyright (c) 2022 John Factotum（见 `foliate/LICENSE`） |

钉这个 commit 是为了和 Readest 用的那份一致。要更新：重新 clone 那个仓库、
checkout 新 commit，然后按下面的清单重新拷一遍。

**为什么用 Readest 的 fork 而不是上游**：它的 `paginator.js` 带着真实生产环境的修复，
而且多一个 `section-chunks.js` 用来切分过大的 spine 项（大 EPUB 会碰到）。

**拷了哪些**（依赖闭包，见 `view.js` 顶部的 import 和里面的动态 import）：

```
view.js  epub.js  epubcfi.js  mobi.js  fb2.js  comic-book.js
paginator.js  progress.js  overlayer.js  text-walker.js  section-chunks.js
search.js  tts.js  vendor/zip.js  vendor/fflate.js  LICENSE
```

**故意没拷的**：

- `pdf.js`、`fixed-layout.js` —— PDF 和固定版式，这一版不支持。它们的实现和 Readest
  自己的构建绑死（`@pdfjs` 是他们的 Vite 别名，还有 `/vendor/pdfjs/` 绝对路径和一整套
  拷 worker / WASM 的 npm 脚本），`fixed-layout.js` 第一行还是个裸导入。
  这两个说明符由 `vite.config.js` 重定向到 `../unsupported-format.js`（会明确报错），
  好让 `foliate/` 这棵树保持和上游逐字一致，将来能直接覆盖。
- `vendor/pdfjs/`（12MB）、`rollup/`、`tests/`、`ui/`、`reader.html`、`reader.js`、
  `package.json`、`eslint.config.js`
- `footnotes.js`、`dict.js`、`uri-template.js`、`opds.js`、`quote-image.js` ——
  独立的工具模块，`view.js` 这条链路里没有任何东西 import 它们。

**不要改这里的文件。** 要打补丁就打到我们自己的代码里，或者升级时重新拷
（改动会在下次覆盖时丢掉）。唯一的例外已经用别的方式解决了：上面那两个说明符走
`vite.config.js` 的 alias。
