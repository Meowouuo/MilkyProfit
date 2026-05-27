# MEMORY.md - MilkyProfit 项目长期记忆

## 项目信息

- **仓库**：https://github.com/Meowouuo/MilkyProfit（GitHub 账号：Meowouuo）
- **本地路径**：`D:/IdeaProjects/Double/MilkyProfit`
- **框架**：Vue 3 + TypeScript + Element Plus + Pinia + Vue Router

## 网络配置

- GitHub HTTPS 访问需通过本地代理：`http://127.0.0.1:10808`
- 推送命令示例：`git -c http.proxy="http://127.0.0.1:10808" push origin main`

## 项目约定

- 页面目录：`src/pages/<页面名>/index.vue`
- 路由配置：`src/router/routes/public.ts`（公开路由）、`private.ts`（私有路由）
- 持久化 key 命名：`<页面名>-<功能>-<类型>`，如 `myDashboard-leaderboard-pagination`
- 子组件复用 `dashboard/components` 下的公共组件，不重复拷贝
- 代码注释覆盖率要求：~80%

## 已完成功能

- `2026-05-27`：新增 `/myDashboard` 路由和页面（参照首页 dashboard，独立状态 key）
