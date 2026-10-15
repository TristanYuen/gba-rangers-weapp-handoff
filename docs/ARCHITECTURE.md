# GBA RANGERS V1.0 工程说明

## 运行模式

- `TARO_APP_DATA_MODE=local`：开发模式，使用本地 fixtures，适合云函数部署前预览和功能验收。
- `TARO_APP_DATA_MODE=cloudbase`：生产默认模式，当前生产环境 ID 为 `cloud1-d4g1nl8yx26d1f3f2`，需要将七个云函数部署到该环境。
- `project.config.json` 默认使用 `touristappid`。正式 AppID 写入微信开发者工具生成的 `project.private.config.json`，该文件已忽略。

## 数据边界

公开页面只消费公开 DTO。精确地点、集合时间、费用、报名名单、微信身份、内部备注和未审核媒体不会进入公开响应。数据库规则关闭客户端直接读写，云函数通过微信上下文识别成员身份。

单场 `appearances` 与 `player_match_stats` 是统计事实源。球员累计字段只能通过 `stats/recalculateAggregates` 重建。赛事修改、成员审核、媒体审核和统计发布均写入 `audit_logs`。

## CloudBase 接入步骤

1. 创建开发和生产两个 CloudBase 环境，并将小程序 AppID 分别关联到对应环境。
2. 根据 `cloudbase/migrations/001-initial.json` 创建集合及索引。
3. 为集合设置 `cloudbase/database.rules.json` 中的拒绝直连策略。
4. 运行 `pnpm build:cloudfunctions`，在微信开发者工具中上传 `cloudfunctions-dist` 下的六个函数并选择“云端安装依赖”。
5. 生产构建从 `.env.production` 读取 `TARO_APP_DATA_MODE=cloudbase` 与环境 ID；本地联调可在 `.env.local` 中覆盖。
6. 初始化唯一球队、2026 赛季和 Owner 成员关系，再执行历史数据 dry-run。

## 历史数据命令

```powershell
pnpm migrate:legacy -- --dry-run "D:\path\2026大湾区流浪者数据.xlsx"
pnpm migrate:legacy -- --commit "D:\path\2026大湾区流浪者数据.xlsx"
pnpm migrate:legacy -- --rollback legacy-2026-<hash>
```

当前 `--commit` 写入本地迁移存储，用于验证幂等和回滚。CloudBase 环境启用后，将同一批次 JSON 通过管理员迁移函数提交；源 Excel 始终保持只读。
