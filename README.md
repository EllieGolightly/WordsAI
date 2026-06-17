# 记忆温室

一个面向手机日用的轻量背单词 PWA。应用本身是纯前端，学习记录保存在当前浏览器的 IndexedDB 中；AI 用用户自己填写的 API Key 调用，不需要额外后端或数据库。

## 功能

- 今日任务：展示新词、复习、完成进度和今日小结。
- 背词：点击卡片显示中文释义和例句，用叉/勾完成反馈。
- AI 生词：优先根据历史记录生成每日新词，本地词库只作为兜底。
- AI 例句：词条没有例句时按需生成并保存到本地。
- AI 小结：根据今日新词、复习词、答对/答错和错误词生成自然段学习小结。
- 统计：周/月/年复习量、记住率、连续天数和完成热力概览。
- 设置：AI Base URL、Model、API Key、数据导出/导入、Markdown 小结复制。
- PWA：支持安装到手机主屏，首次加载后可离线打开已缓存页面和本地学习记录。

## 技术栈

- React
- TypeScript
- Vite
- Dexie / IndexedDB
- vite-plugin-pwa
- React Router

## 本地开发

```bash
npm install
npm run dev
```

常用命令：

```bash
npm run lint
npm run build
npm run preview
```

## 免费部署方案：Vercel

推荐用 Vercel 部署这个项目，因为它对 Vite 静态应用支持直接，HTTPS 自动配置，PWA 可以正常安装到手机主屏。

项目已包含 [vercel.json](./vercel.json)，其中配置了：

- `buildCommand`: `npm run build`
- `outputDirectory`: `dist`
- SPA 路由回退：所有深链接回到 `index.html`

### 部署步骤

1. 把 `word-memo-pwa` 作为项目根目录推到 GitHub。
2. 在 Vercel 新建项目，导入这个 GitHub 仓库。
3. Framework Preset 选择 `Vite`。
4. Build Command 使用 `npm run build`。
5. Output Directory 使用 `dist`。
6. 不需要配置环境变量。
7. 部署完成后，用 Vercel 提供的 HTTPS 地址在手机浏览器打开。
8. iPhone 用 Safari 分享按钮选择“添加到主屏幕”；Android 用 Chrome 菜单选择“添加到主屏幕”或“安装应用”。

如果你把整个 `WordsAI` 文件夹作为仓库根目录上传，而不是只上传 `word-memo-pwa`，需要在 Vercel 的 Root Directory 设置为 `word-memo-pwa`。

## AI 配置

部署后进入“设置”页填写：

- API Key
- Base URL，默认是 `https://api.openai.com/v1`
- Model，默认是 `gpt-4o-mini`

这些设置只保存在当前浏览器本地，不会提交到 GitHub，也不会存到 Vercel。前端会直接从浏览器请求对应 AI 服务，因此所填的 Base URL 需要允许浏览器跨域请求。

## 数据会不会丢

正常使用不会每次打开都清空。学习历史、词库、卡片状态、AI 小结和设置会保存在当前设备、当前浏览器、当前域名下的 IndexedDB 中。

需要注意：

- 换手机不会自动同步。
- 换浏览器不会自动同步。
- 换部署域名会被视为另一份本地数据。
- 清除浏览器站点数据、使用无痕模式、卸载浏览器，可能导致数据被删除。
- iOS/Android 在极端存储压力下理论上可能清理站点数据。

建议在“设置”页定期导出备份 JSON。换设备或换域名时，先导出，再到新环境导入。

## PWA 与离线

首次在线打开后，应用壳会被 Service Worker 缓存。离线时可以继续打开已缓存页面、查看本地数据和完成本地复习记录；AI 生词、AI 例句和 AI 小结需要网络恢复后才能调用。

## 当前部署检查清单

- `npm run lint` 通过。
- `npm run build` 通过。
- 已配置 Vercel SPA fallback，刷新 `/review`、`/stats`、`/settings` 不会 404。
- 已同步浅米色 PWA theme color 和离线页风格。
- 不依赖付费后端、数据库或服务器环境变量。
