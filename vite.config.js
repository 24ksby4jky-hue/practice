import { fileURLToPath } from "node:url";

const unsupported = fileURLToPath(new URL("./src/reading/unsupported-format.js", import.meta.url));

// foliate-js 的 view.js 有两个我们不支持的懒加载分支（PDF、固定版式 EPUB）。
// Vite 的 import-analysis 在**转换期**就会解析动态 import 的说明符 —— 文件解析不到
// 就让整个模块 500，哪怕那行代码运行时根本不会执行。所以把这两个说明符重定向到桩模块。
//
// 为什么用 alias 而不是直接往 vendor/foliate/ 里放同名文件：vendor 那棵树要保持和上游
// 逐字一致，将来 foliate-js 更新时才能直接覆盖。桩模块是我们自己的东西，不该混进去。
//
// 这两个说明符只出现在 view.js 里，全局 alias 不会误伤别的文件。
export default {
  resolve: {
    alias: [
      { find: /^\.\/pdf\.js$/, replacement: unsupported },
      { find: /^\.\/fixed-layout\.js$/, replacement: unsupported }
    ]
  }
};
