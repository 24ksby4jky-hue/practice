# 阅读工作台与本地词典

阅读页使用全屏工作台。顶部可返回书架或收起侧栏；左侧有“页面 / 目录 / 词典”。
点击英文单词会自动展开词典，保留当前阅读位置；拖动选择文字不会触发查词。
开启电子书“朗读”模式后，点击句子用于朗读；关闭朗读面板后恢复单词查询。
PDF 需要具备文字层，纯扫描件暂不支持点词。PDF 缩略图按可见区域按需生成。

## 导入用户自己的 MDX 词典

安装依赖后，在项目目录运行：

```powershell
npm run dictionary:import -- "D:\BaiduNetdiskDownload\欧路词库文件\柯林斯双解学习词典"
```

也可以直接传入 `.mdx` 文件路径。导入器使用 `js-mdict` 6.x（MIT）读取词条，
生成 `public/dictionaries/collins/manifest.json` 和 256 个 JSON 分片。
页面按需读取分片，不依赖外部翻译 API。定义、中文翻译和例句均来自导入词库。
MDD 的原始脚本、样式和媒体不进入阅读页面，词条 HTML 会经过清理。

生成数据留在本机并被 Git 忽略。克隆仓库到新电脑后需要重新导入自己的词典。

## 构建与部署

```powershell
npm run build
```

Vite 会将 `public/dictionaries/collins/` 原样拷贝到 `dist/dictionaries/collins/`。
部署时发布完整 `dist/`，包括词典分片与 PDF 字体、解码器等资源。
仅推送代码不会把本机词库同步到服务器。

## 验证

```powershell
npm test
npm run test:browser
```

自动化使用原创小型词条测试取词、词形变化、安全渲染和侧栏操作，
不需要访问用户的本地词库。实际词库可用 `read`、`book`、`child` 手动检查。
