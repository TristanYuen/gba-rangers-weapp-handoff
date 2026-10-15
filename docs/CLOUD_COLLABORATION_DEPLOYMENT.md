# GBA RANGERS 云端协同与身份绑定部署手册

更新日期：2026-07-31  
目标上线日期：2026-08-08  
CloudBase 环境：`cloud1-d4g1nl8yx26d1f3f2`

## 2026-08-01 增量部署记录

- 已按 `8.1名单（已更新年份）(1).xlsx` 同步 50 名现役球员的号码、位置、入队年份和会费档案，空位置统一归为“未分类”。
- 已恢复卢华杰 7 号董事长历史档案，效力年份为 2020—2025，两项历史金额为 37,263 元和 197,042.15 元。
- 已新增 `player_add_requests` 集合、审核队列索引、待审核唯一索引和现役号码索引；集合权限为 `ADMINONLY`。
- `team` 和 `match` 云函数已部署并确认为 `Active`，比赛报名人数已按确认到场口径回填。
- 1.0.7 体验版已上传，尚未提交微信审核或发布。
- 回归结果：TypeScript 类型检查通过，9 个测试文件共 42 项测试通过，微信小程序生产构建和 9 个云函数构建通过。

## 2026-08-01 图片合规与审批增量

- 个人头像、管理人员代传头像和比赛相册图片均在选择图片前展示法律合规确认弹窗。
- 云函数强制校验合规确认标记，并保存确认版本与确认时间。
- 新上传头像和相册图片统一进入 `pending_review`，队长批准后才会公开展示。
- 待审或被驳回的图片只返回给队长和上传者，管理员无法批准待审图片。
- 已关闭球员头像地址、比赛封面地址和年鉴封面地址的管理接口直写字段，公开图片只能通过已批准的媒体记录产生。
- `media` 和 `team` 云函数已部署并确认为 `Active`；1.0.8 体验版已上传，尚未提交微信审核或发布。
- 回归结果：TypeScript 类型检查通过，10 个测试文件共 45 项测试通过，生产构建和云函数构建通过。

## 1. 已完成的代码能力

- CloudBase 是生产模式的唯一权威数据源。写操作等待云函数成功后才刷新本机缓存。
- 云端请求失败时，页面显示失败信息，本机不会保留一条“看似成功”的业务修改。
- 未绑定、待审核、被拒绝、已停用的微信身份只能进入“我的球队”身份页面。
- 普通成员通过球队邀请码读取 49 名正式球员中的未认领名单，选择本人姓名后进入待审核状态。
- 6 名试训球员和 2 名客串球员不参与身份认领。
- 黄震杰使用单独的一次性队长邀请码完成首次绑定。
- 队长和管理员可审核身份；队长可任命管理员、任命其他队长、解绑成员。
- 最后一名队长受服务端事务保护，无法被降级或解绑。
- 比赛、报名、赛后统计、球员档案、年鉴、照片、通知、会费均已接入云端写入。
- 会费调整支持管理员提交、队长审核；队长可直接使调整生效。
- 两场历史异常比赛保留“待核对”状态，并暂停计入球员汇总统计。
- 待定报名提醒由 `notification-worker` 每 5 分钟扫描一次，处理过程可重入。
- 数据库客户端读写全部关闭。照片原文件不允许客户端直接读取，页面通过云函数取得临时地址。

## 2. 本地验证结果

- TypeScript 类型检查：通过。
- 云函数 JavaScript 语法检查：通过。
- 自动化测试：4 个测试文件、27 项测试全部通过。
- 生产版微信小程序构建：通过。
- 云函数构建：9 个函数构建成功。
- 历史迁移包：11 个集合文件、627 条文档，主键和外键检查通过。
- 历史数据合计：57 名球员、14 场比赛、235 次出场、94 个进球、76 次助攻。
- 身份认领名单：49 名正式球员。
- 历史异常：2 场比赛。
- 会费资料待核对：梁子谦仅存在于会费资料，未出现在权威 Excel 球员名单中，因此暂未导入其会费档案。

## 3. 当前云端状态

截至 2026-07-31，已通过 CloudBase CLI 3.7.0 和腾讯云官方 API 完成：

- 目标环境为 `cloud1-d4g1nl8yx26d1f3f2`，套餐为个人版，环境状态正常。
- 个人版权益到期时间为 2027-01-29 23:59:59，未开启自动续费；当前计费周期截至 2026-08-29 23:59:59。
- 25 个集合均已创建，客户端权限均为 `ADMINONLY`。
- 11 个初始化文件已导入；云端数量与迁移清单一致，共 627 条文档。
- `team_memberships` 已清空错误测试记录，当前为 0 条。
- 12 个协同与身份业务索引均已创建并逐项核验。
- 9 个云函数均为 `Active`、`Available`。
- 8 个交互函数超时上限为 15 秒；`notification-worker` 为 60 秒。
- `pending-signup-reminders` 定时触发器已启用，每 5 分钟运行一次。
- 定时任务已通过一次空队列调用，结果为 `scanned: 0`、`completed: 0`、`cancelled: 0`。
- 云函数安全规则已生效：普通函数仅允许已登录、非匿名用户调用，`notification-worker` 禁止客户端调用。
- 云存储保持 `PRIVATE`；照片通过 `team.getSnapshot` 在服务端换取临时地址。
- 当前版本仍在继续优化，未上传新的体验版，也未提交微信审核。

首次队长绑定和双设备验收尚未执行，必须在下一次体验版上传后完成。

## 4. 部署前文件

- 数据结构定义：[001-initial.json](../cloudbase/migrations/001-initial.json)
- 协同功能增量定义：[002-cloud-collaboration.json](../cloudbase/migrations/002-cloud-collaboration.json)
- 数据库规则：[database.rules.json](../cloudbase/database.rules.json)
- 云存储规则：[storage.rules.json](../cloudbase/storage.rules.json)
- 云函数调用规则：[function.rules.json](../cloudbase/function.rules.json)
- 云函数源码：`cloudfunctions-src`
- 云函数部署目录：`cloudfunctions-dist`
- 迁移包：`.codex_tmp/cloud-import`
- 队长码与球队邀请码：`.codex_tmp/cloud-import/deployment-secrets.local.json`

`.codex_tmp` 已加入 `.gitignore`。邀请码明文禁止提交到 Git、群聊或公开文档。

## 5. 控制台执行顺序

执行时严格按以下顺序操作。每一步完成后先核对结果，再进入下一步。

### 第一步：确认环境和套餐

1. 在微信开发者工具中确认当前项目 AppID 为 `wx5ded6945b59deb10`。
2. 打开云开发，确认环境 ID 为 `cloud1-d4g1nl8yx26d1f3f2`。
3. 在“套餐用量”中检查 6 个月个人版权益是否已领取并绑定当前环境。
4. 若没有可用权益，升级个人版。当前官方资源点计费 FAQ 标示个人版为 19.9 元／月。
5. 截图保存套餐名称、到期日和环境 ID。

### 第二步：核对并清理测试成员文档

1. 打开 `team_memberships` 集合。
2. 导出当前集合，保存为部署前备份。
3. 核对交接记录提到的 3 条错误测试文档：
   - 只有 `openid`；
   - 只有 `role: owner`；
   - 只有 `status: approved`。
4. 仅删除已确认属于上述错误测试的文档。
5. 此时正式上线前的 `team_memberships` 应为空。若存在字段完整的真实成员记录，暂停操作并重新评估，避免覆盖真实绑定。

### 第三步：创建新增集合

在现有 18 个集合基础上新增：

1. `identity_claim_locks`
2. `identity_invites`
3. `fee_plans`
4. `player_fee_assignments`
5. `fee_change_requests`
6. `fee_payments`
7. `notification_preferences`

完成后应有 25 个集合。

### 第四步：导入初始化数据

控制台选择“文档型数据库 → 集合管理 → 导入”。文件格式统一选择 JSON。

按 `.codex_tmp/cloud-import/manifest.json` 的顺序导入：

1. `teams.json`：选择 Upsert。
2. 其余 10 个文件：首次部署选择 Insert。

各文件的目标集合、模式和期望数量都记录在 `manifest.json`。每个文件导入后核对成功数，失败数必须为 0。

### 第五步：创建索引

根据 `cloudbase/migrations/001-initial.json` 和 `002-cloud-collaboration.json` 创建索引。

重点唯一索引：

- `players.sourceKey`
- `matches.sourceKey`
- `team_memberships.uniqueKey`
- `team_memberships.openidKey`
- `team_memberships.playerKey`
- `identity_invites.codeHash`
- `fee_change_requests.pendingKey`
- `fee_payments.paymentKey`

`team_memberships` 错误测试文档必须在唯一索引创建前清理完成。

### 第六步：部署 9 个云函数（已完成）

从 `cloudfunctions-dist` 上传并部署：

1. `public-query`
2. `membership`
3. `match`
4. `stats`
5. `media`
6. `notifications`
7. `notification-worker`
8. `team`
9. `fees`

函数依赖选择“云端安装依赖”。部署后逐一确认状态正常。

2026-07-31 已通过微信开发者工具 CLI 部署到环境
`cloud1-d4g1nl8yx26d1f3f2`，9 个函数均已核验为 `Active`。本机 CLI
自动读取项目 AppID 时返回 `getCloudAPISignedHeader ret=41002`，显式传入
`--appid wx5ded6945b59deb10` 后部署成功。后续命令继续显式传入 AppID，避免
重复触发该问题。

`notification-worker` 目录内包含 `config.json`。部署函数后，在微信开发者工具中右键该函数并执行“上传触发器”。期望触发器：

```json
{
  "name": "pending-signup-reminders",
  "type": "timer",
  "config": "0 */5 * * * * *"
}
```

### 第七步：设置安全规则

数据库自定义规则使用 `cloudbase/database.rules.json`：

```json
{
  "read": false,
  "write": false
}
```

云存储自定义规则使用 `cloudbase/storage.rules.json`。修改云存储规则后等待 1 至 3 分钟再测试。

云函数权限控制使用 `cloudbase/function.rules.json`。普通函数只允许已登录、
非匿名用户调用；`notification-worker` 只由定时触发器执行，禁止客户端直接
调用。业务角色和数据范围继续由每个云函数内部校验。

### 第八步：首次队长绑定

1. 打开 `.codex_tmp/cloud-import/deployment-secrets.local.json`。
2. 由黄震杰本人使用体验版进入小程序。
3. 在“队长专属初始化”输入 `bootstrapOwner.code`。
4. 成功后检查：
   - `team_memberships` 新增 1 条 `approved + owner` 文档；
   - `identity_claim_locks` 新增黄震杰的有效认领锁；
   - `identity_invites` 中该邀请码变为 `active: false` 并出现 `usedAt`；
   - `teams.ownerCount` 变为 1。

该队长码使用一次后立即失效。

### 第九步：双设备验收

使用黄震杰设备 A 和普通球员设备 B：

1. B 使用 `teamInviteCode` 读取名单。
2. B 选择自己的姓名并提交。
3. B 在审核前尝试进入首页、比赛、球员、通知，均应被送回身份页面。
4. A 在运营中心通过申请。
5. B 重新进入后可以访问球队业务数据。
6. B 修改自己的比赛报名，A 刷新后看到相同结果。
7. A 修改比赛、球员或通知，B 刷新后看到相同结果。
8. 断网后尝试修改报名，页面应提示失败，恢复网络后不应出现一条本机独有的数据。
9. 使用另一个微信尝试认领同一球员，服务端应拒绝。
10. 队长任命一名管理员，再验证管理员审核申请和提交会费调整。
11. 管理员提交会费调整后，队长审核通过，双方看到相同档案。
12. 验证最后一名队长无法降级或解绑。

### 第十步：历史数据核对

确认以下两场仍显示“待核对”，且未计入球员汇总：

- 2026-01-25 GBA 年会活动：15 球、17 助攻。
- 2026-02-09 VS 聚梦青年：2 球、3 助攻。

梁子谦的会费资料继续保留为待核对事项。确认其是否属于正式名单后，再单独补录。

### 第十一步：体验版与上线

1. 上传新的体验版。
2. 完成至少一次队长、管理员、普通球员三角色真机验收。
3. 检查隐私接口声明，项目使用了定位与相册／相机能力。
4. 检查云开发套餐到期日、告警联系人和资源用量提醒。
5. 提交微信审核。
6. 审核通过后发布。
7. 发布后保留旧体验版与迁移前备份，至少观察 7 天。

## 6. 回退原则

- 发布前数据导入失败：停止后续导入，按 `migrationBatchId` 定位本批记录，核对后处理。
- 云函数部署失败：保留上一个可用版本，禁止发布新体验版。
- 真机验收失败：继续使用当前内测版本，修复后重新构建。
- 已产生真实成员绑定后，禁止整库删除或重建。
- 回退前先导出 `teams`、`players`、`team_memberships`、`identity_claim_locks`、`matches`、`signups` 和会费集合。

## 7. 官方资料依据

- CloudBase 数据导入采用 UTF-8 JSON Lines，每行一个 JSON 对象，首次导入可用 Insert，增量可用 Upsert：<https://docs.cloudbase.net/database/manage>
- CloudBase 服务端事务支持 ACID 和 `runTransaction`，适合身份绑定与角色不变量保护：<https://docs.cloudbase.net/database/transaction>
- 云存储安全规则只约束客户端，服务端仍可读取文件并生成临时地址：<https://docs.cloudbase.net/storage/security-rules>
- 定时触发器使用 7 段 Cron；函数目录可通过 `config.json` 配置，部署后需上传触发器：<https://docs.cloudbase.net/cloud-function/timer-trigger>
- 资源点套餐与个人版价格：<https://docs.cloudbase.net/quick-start/resource-point>
- 2026 小程序成长计划包含 6 个月个人版环境或相关权益，实际领取资格以当前账号控制台为准：<https://docs.cloudbase.net/solutions/wechat-miniprogram-ai/>
