# GBA RANGERS CloudBase 接入交接总结

> 状态说明（2026-07-31）：本文保留此前排查过程，文中的“7 个云函数”和“身份认领尚未实现”等结论已经过时。当前实施状态、9 个云函数、迁移包和控制台步骤以 [CLOUD_COLLABORATION_DEPLOYMENT.md](./CLOUD_COLLABORATION_DEPLOYMENT.md) 为准。

## 一、用户真正要实现的业务流程

球队已经存在，球员名单和姓名已经预录入数据库。

新用户第一次进入小程序时，不创建球队，也不让用户手动填写姓名。正确流程是：

1. 小程序读取预录入的球员名单。
2. 用户使用微信进入小程序。
3. 用户从名单中认领自己的姓名。
4. 系统将当前微信身份的 `openid` 与被认领的球员记录绑定。
5. 后续通过微信身份自动识别该球员。
6. 一名球员只能认领一个姓名；一个姓名只能绑定一个微信身份。
7. 队长、管理员权限由后台或已有队长在小程序内设置，不要求用户自行创建球队。

如果需要两名队长，已有队长在小程序成员管理中将另一名已认领的球员设置为队长即可。

## 二、当前 CloudBase 环境

### 当前正式使用环境

- 环境名称：`cloud1`
- 环境 ID：`cloud1-d4g1nl8yx26d1f3f2`
- 套餐：免费开发环境
- 地域：上海
- 微信开发者工具当前环境：`cloud1`

### 不再使用的环境

- 环境名称：`gba-rangers-prod`
- 环境 ID：`gba-rangers-prod-d0ejz8cdc455cfd`
- 该环境属于另一个腾讯云账号，当前小程序账号无法直接导入。

此前还出现过错误环境 ID：`tnt-hjv0rph86`，项目源码、构建产物和导入包中已清除。

## 三、代码和云函数当前状态

代码任务已经完成以下工作：

- 生产配置已切换到 `cloud1-d4g1nl8yx26d1f3f2`。
- 前端构建产物已包含：

  ```js
  cloud.init({ env: "cloud1-d4g1nl8yx26d1f3f2" })
  ```

- 导入包目录：`D:\Codex项目\小程序\微信开发者工具导入包`
- 7 个云函数已经在 `cloud1` 中部署成功：

  ```text
  public-query
  membership
  match
  stats
  media
  notifications
  team
  ```

- 类型检查通过。
- 27 项测试通过。

## 四、当前数据库状态

`cloud1` 中已经创建了 18 个集合：

```text
users
teams
players
team_memberships
seasons
matches
signups
appearances
player_match_stats
media_assets
media_links
yearbook_entries
migration_batches
migration_issues
notification_jobs
team_notices
notice_recipients
audit_logs
```

集合权限目前按项目设计使用 `ADMINONLY`，前端通过云函数访问数据库，前端不直接读写集合。

当前 `teams` 集合已有一条球队文档：

- `inviteCode`：`GBARANGERS2026`
- 球队文档 `_id`：`698a4c596a69ed84010a7c2e27709c78`

## 五、已经出现的问题

为了测试队长权限，曾经在 `team_memberships` 中手动创建了错误记录：

- 一条只有 `openid` 的文档；
- 一条只有 `role: owner` 的文档；
- 一条只有 `status: approved` 的文档。

这三条字段被拆成了三条独立文档，不能作为正式数据使用。后续应删除这些测试记录，避免影响权限查询。

曾经尝试用 CloudBase 控制台手动添加完整成员文档，但该方式不应成为正式业务流程。

## 六、当前项目实际权限逻辑

云函数 `common.js` 中的 `getAccess()` 会根据当前微信 `openid` 查询：

```text
team_memberships.openid == 当前微信 openid
deletedAt 不存在
```

然后返回该成员的：

```text
role
status
playerId
openid
```

当前代码中的角色包括：

```text
owner
admin
player
visitor
```

当前 `membership` 云函数已有加入球队和成员审核相关接口，但还没有完整实现“预录入球员认领姓名”的正式流程。

## 七、下一步真正应该改造的内容

不要继续让用户在 CloudBase 控制台手动填写 `team_memberships`。

应由代码实现以下能力：

### 1. 预录入球员名单

在 `players` 集合中保存球员基本信息，例如姓名、号码、位置、状态等。

### 2. 小程序内认领姓名

新增“认领我的姓名”页面：

- 展示尚未绑定微信的球员姓名；
- 用户选择自己的姓名；
- 云函数校验该姓名是否已经被认领；
- 将当前微信 `openid` 写入该球员记录；
- 同时创建或更新对应的 `team_memberships` 记录。

### 3. 防止重复认领

云函数必须校验：

- 一个 `openid` 不能认领多个球员；
- 一个球员不能被多个 `openid` 认领；
- 已认领球员不能再次被普通用户认领；
- 认领操作需要事务或等价的并发保护。

### 4. 队长设置

已有队长或管理员在小程序的成员管理页面中：

- 审核认领申请；
- 将指定成员设置为 `owner` 或队长角色；
- 可设置多名队长；
- 普通用户不能自行设置队长。

### 5. 首次管理员问题

因为球队已经存在，不能用“创建球队”作为初始化入口。需要设计一种安全的初始认领方式，例如：

- 由预置的球队管理者账号首次认领；
- 或使用一次性后台认领码；
- 或由已有后台管理账号在小程序内完成首次确认。

普通邀请码只能用于申请加入，不能直接让任何人获得队长权限。

## 八、官方文档结论

- CloudBase 文档型数据库支持 JSON 文档，每次“添加文档”对应一条完整文档；控制台也支持 JSON 编辑和批量导入。[官方文档](https://cloud.tencent.com/document/product/876/46897)
- `_id` 通常由系统自动生成。
- 控制台或云函数创建的文档不会自动生成 `_openid`，因此当前项目应自行保存业务字段 `openid`，并由云函数校验。[官方说明](https://cloud.tencent.com/document/product/876/19369)
- `ADMINONLY` 表示仅管理端可读写，适合当前“前端只调用云函数”的架构。[权限说明](https://cloud.tencent.com/document/product/876/34819)
- 腾讯云侧创建的环境如果要在微信开发者工具中使用，需要转换为小程序环境；当前已经改用微信开发者工具创建的 `cloud1` 环境。[环境说明](https://cloud.tencent.com/document/product/876/18438)

## 九、新对话开始后的工作重点

请先阅读本文件，不要继续指导用户手动创建球队或手动拆分添加成员文档。

优先检查代码中现有的：

- `players` 数据结构；
- `team_memberships` 数据结构；
- `membership` 云函数接口；
- 小程序“我的球队”和成员管理页面；
- 是否已有认领姓名相关页面或接口。

目标是把流程改成：

```text
预录入球员名单 → 用户微信进入 → 认领自己的姓名 → 自动绑定 openid → 队长在小程序内审核和设置队长
```
