# 大湾区流浪者微信小程序：2.1.5完整接力开发仓库

本仓库公开，朋友和下一位AI可以直接下载或克隆。交付日期：2026-10-15。前端2.1.5已于2026-10-14通过微信开发者工具上传成功；审核及正式发布状态未核实。这里保存当前开发快照，包含此前没有提交到旧仓库的改动，不沿用旧仓库中的依赖缓存、浏览器临时资料和庞大历史。

**下一位AI先完整阅读本README和AGENTS.md，再操作代码。普通接手不需要重新初始化数据库，也不需要重跑历史数据迁移。**

## 1. 下载后先做什么

```sh
git clone https://github.com/TristanYuen/gba-rangers-weapp-handoff.git
cd gba-rangers-weapp-handoff
```

没有Git也可以在本页选择Code→Download ZIP，解压后进入含package.json的目录。Release中的“完整接力开发包”同时包含源码和现成导入包；“最新前端发布包”只供微信开发者工具导入，不能替代源码仓库。

最快查看当前小程序：打开微信开发者工具，导入仓库内的“微信开发者工具导入包”目录，使用已获得该小程序开发权限的微信账号登录。包内生产配置连接真实CloudBase；若只想离线演示，按第3节重新构建本地模式。

## 2. 已确认的版本与环境

| 项目 | 值或状态 |
| --- | --- |
| 微信上传版本 | 2.1.5，开发者工具显示Upload Successfully |
| 小程序AppID | wx5ded6945b59deb10 |
| 生产CloudBase环境 | cloud1-d4g1nl8yx26d1f3f2 |
| 数据同步脚本使用的球队ID | 698a4c596a69ed84010a7c2e27709c78 |
| 前端框架 | Taro4.2.1、React、TypeScript、Webpack5 |
| 本机验证的Node.js | 26.7.0 |
| 依赖管理 | pnpm，原工作流固定11.22.0，pnpm-lock.yaml已保存 |
| 云函数SDK | wx-server-sdk3.0.1，由构建脚本生成package.json |
| 上次重点云函数部署核对 | 2026-10-01，stats、match、team、membership |
| 2026-10-15验证 | 17个测试文件、76项测试、类型检查、微信构建、9个云函数构建和跨平台同步通过 |
| 前端发布包核对 | 2026-10-14重新构建，89个文件与导入包和ZIP一致 |
| 当前正式版本、线上最新数据 | 本次没有重新查询，不能从源码推断 |
| worker附带行为 | 会扫描过期赛事并自动结束状态，具体见notification-worker源码 |

这些ID是客户端标识，不是凭据。仓库不提供个人微信登录态、云平台密钥、真实数据库导出或微信上传私钥。朋友要操作真实环境，需分别获得微信小程序开发者身份及CloudBase权限。

## 3. 安装依赖与运行

在机器上准备Node.js；本次通过验证的版本为26.7.0。若没有pnpm，可自行安装项目工作流使用的固定版本：

```sh
npm install --global pnpm@11.22.0
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm exec vitest run
```

依赖声明与锁文件已检查一致。未在另一台全新电脑执行安装，因此遇到原生依赖问题时，应保留错误并检查Node版本、架构及pnpm安装日志，不要直接升级所有依赖或删除锁文件。

### 微信生产构建

```sh
pnpm exec taro build --type weapp --no-check
```

产物是dist/。仓库根目录project.config.json的miniprogramRoot指向dist/，构建后可直接把根目录导入微信开发者工具。不要把src/直接当成微信小程序目录。

macOS曾出现Taro检查器阻塞，因此采用--no-check，TypeScript检查单独运行；--no-check不意味着省略类型检查。

### 微信本地演示构建

Mac或Linux：

```sh
TARO_APP_DATA_MODE=local pnpm exec taro build --type weapp --no-check
```

Windows PowerShell：

```powershell
$env:TARO_APP_DATA_MODE = 'local'
pnpm exec taro build --type weapp --no-check
Remove-Item Env:TARO_APP_DATA_MODE
```

本地模式使用src/data/fixtures.ts和本机存储，演示角色切换不会成为生产权限。fixtures含原有名册及历史示例，不代表最新云端数据库。修改fixtures不会同步真实球员数据。

### 浏览器演示

```sh
TARO_APP_DATA_MODE=local pnpm build:h5
pnpm preview:h5
```

预览地址http://127.0.0.1:4173。H5无法替代微信原生云调用、隐私接口或手机验收；浏览器演示应按需显式设置TARO_APP_DATA_MODE=local。开发命令pnpm dev:h5对应127.0.0.1:10086。

### 运行模式配置

.env.development和.env.test使用local；.env.production使用cloudbase。config/index.ts把模式编译为__DATA_MODE__，把环境ID编译为__CLOUDBASE_ENV_ID__。改变变量后必须重新构建，旧dist不会自动变更模式。

构建默认读取生产环境；src/services/index.ts据此选择localStore或createCloudStore。不要为了临时演示修改公共生产配置并提交。

## 4. 文件与修改入口

| 路径 | 用途及修改方式 |
| --- | --- |
| src/app.config.ts | 页面注册、Tab栏、微信权限声明 |
| src/pages/matches/ | 比赛首页、详情、报名、编辑及赛后录入 |
| src/pages/account/index.tsx | 我的球队、个人数据、身份与头像 |
| src/pages/leaderboard/index.tsx | 球队出场、进球、助攻榜单 |
| src/pages/players/ | 球员名册、资料与编辑 |
| src/pages/yearbook/ | 年鉴及比赛相册 |
| src/pages/notices/ | 通知记录、发布与已读 |
| src/pages/admin/、src/pages/fees/ | 审核、管理与会费 |
| src/components/、src/app.scss | 公共组件与全局样式 |
| src/custom-tab-bar-native/ | 原生自定义Tab栏，构建时复制 |
| src/domain/ | 类型、校验、业务规则 |
| src/services/cloudService.ts | 云初始化、调用、超时与错误处理 |
| src/services/cloudStore.ts | 写入云端后刷新本机缓存的适配层 |
| src/services/localStore.ts | 本地演示、缓存和hydrateFromCloud |
| src/hooks/useCloudPageRefresh.ts | 页面显示、定时及下拉刷新 |
| src/utils/avatar.ts、mediaUpload.ts、mediaCompliance.ts | 头像、批量图片和合规弹窗 |
| cloudfunctions-src/ | 云函数唯一开发入口 |
| cloudfunctions-dist/ | 本地生成的部署包，Git忽略 |
| cloudrun-src/ | 消息回调服务准备代码，线上部署状态另查 |
| cloudbase/ | 集合迁移定义及数据库、存储、函数调用规则 |
| 微信开发者工具导入包/ | 可直接导入的构建产物，不作为手工修复入口 |
| tests/ | 自动化回归 |
| docs/ | 历史方案、验收和修复记录 |
| docs/archive/team-unpublished-changes.patch | 未上线的team额外改动归档，普通开发无需应用 |
| HANDOFF-MANIFEST.json | 交付文件SHA256与云函数一致性记录 |

**src/与cloudfunctions-src/是修改入口。不要只改导入包中的压缩代码。**

## 5. 云函数：使用一套源码，不需要挑版本

交付包内9个云函数的index.js、common.js与cloudfunctions-src对应文件逐字节一致。team以本次修复已部署的稳定代码为接力基线，本机额外未上线改动以补丁保存，不影响直接开发。stats、match两份原差异是格式，已一并对齐。

```sh
node scripts/build-cloudfunctions.mjs
```

该脚本从cloudfunctions-src复制9个index.js，给每个函数复制common.js，生成依赖wx-server-sdk3.0.1的package.json，并复制存在的config.json。输出cloudfunctions-dist/。不要在dist内直接修改源码。

| 云函数 | 职责 |
| --- | --- |
| public-query | 已审核成员可调用的公开资料DTO查询，过滤内部资料 |
| membership | 微信身份、档案认领、成员审核、角色和个人首页接口 |
| match | 赛事、报名、特殊报名审核、状态及删除 |
| stats | publishMatchStats、recalculateAggregates，单场与累计统计 |
| team | 成员快照、球员资料、新增球员审核、年鉴设置 |
| media | 图片元数据、头像提交、队长审核 |
| fees | 会费状态、变更申请与审核 |
| notifications | 站内通知、已读、订阅记录、投递状态 |
| notification-worker | 后台投递与待定提醒，带定时器配置 |

旧docs里“六个/七个云函数”“touristappid”和“清空成员后初始化”等内容是早期记录，不能覆盖当前代码和本README，也不能照搬到现有生产环境。数据库集合定义分布于cloudbase/migrations/的三个文件，代码引用还包含后续增加的通知订阅集合；新建测试环境前应结合当前全部云函数检查，不能假定最早迁移文件已覆盖所有集合。

### 同步给开发者工具

本仓库补充了跨平台同步脚本，只处理本地产物，不上传或部署：

```sh
# 修改前端后
pnpm exec taro build --type weapp --no-check
node scripts/sync-import-package.mjs --frontend

# 修改云函数后
node scripts/build-cloudfunctions.mjs
node scripts/sync-import-package.mjs --cloud
```

需要两者时使用--all，前提是两个构建目录都存在。脚本会重建导入包对应的miniprogram/或cloudfunctions/目录，不修改外层project.config.json；不要在产物目录保存手工代码或独有文件。原pnpm package:weapp调用Windows专用PowerShell脚本，Mac应使用上述跨平台命令。

### 部署真实云函数

1. 明确任务是否要求部署；先用现有权限查看目标环境、当前函数代码、运行时、依赖安装选项和触发器，保存可恢复的原代码。
2. 构建cloudfunctions-dist/并只同步任务涉及的改动。普通维护不需要初始化、清空或导入整库。
3. 在开发者工具导入“微信开发者工具导入包”，选择真实目标云环境，对需更新的单个函数使用“上传并部署：云端安装依赖”。本说明不要求批量部署9个函数。
4. 保留现有运行时、内存、超时、环境变量、权限及触发器。10月1日重点4函数使用Nodejs16.13、15秒、256MB；这只是上次部署记录，不是要求把其他函数都改为同一配置。notification-worker有独立配置和定时器。
5. 部署后下载代码核对，再从实际微信入口验证权限、写入和读取。CLI返回成功、编译成功和手机验收是不同结果。

本仓库不含完整CloudBase一键配置或登录凭据。没有权限时，先在local模式开发；不要用模拟返回值冒充线上验证，不要把生产权限改为公开直读。

## 6. 数据流与必须保留的规则

### 身份与接口

cloudService通过Taro.cloud.callFunction调用{name,action,payload,requestId}，前端超时15秒。成功响应包含ok、data、requestId，失败包含error.code和error.message。

common.js从cloud.getWXContext().OPENID识别调用者，在team_memberships查角色及审核状态。requireApproved、requireManager、requireOwner和requireSameTeam是服务端权限边界；前端隐藏按钮不能替代这些检查。普通成员、管理员和队长权限分别由具体云函数执行，媒体审批需队长。

### 单场、个人与榜单统计

主事实记录为player_match_stats，出场关联保存在appearances，球员累计存于players.stats。seasonStats保留用于旧前端兼容，当前与累计一起维护。当前数据和界面使用2026赛季口径，代码尚未实现完整跨年赛季/生涯分离；新增2027赛季前需先明确口径并加测试。

保存赛果调用stats.publishMatchStats：检查身份、球队、球员和expectedVersion，事务写单场及赛事结果，再更新出场、重建球员累计并更新年鉴。expectedVersion冲突时需刷新核对后重提，不能去掉版本检查强行覆盖。

只有countInStats为true且未删除的单场统计参与汇总。试训、客串以及明确单场展示的记录不计入正式榜单。取消已移出名册球员的历史出场允许保存；新增无效正式球员仍应拒绝。不要为了满足校验凭空新建正式档案，也不要擅自把临时球员的进球转给他人。

个人首页、球员资料页和榜单读取同一stats；team快照还给旧前端生成seasonStats，membership个人接口同样兼容。保存、更正赛果和删除赛事后的累计都维护两个字段。不能单改榜单显示或手工调整某个累计字段作为常规功能修复。

### 云端刷新

生产数据以云端为准，localStore承担缓存和演示。cloudStore写操作成功后同步team快照，再hydrate本机。useCloudPageRefresh在页面进入时同步，默认8秒轮询，隐藏时停止，并支持已配置页面的下拉刷新。个人首页还会读取membership.getAccountOverview；修改统计接口时要同时检查这条路径，避免旧数据覆盖新值。

### 通知

左上角红色数字来自站内通知未读数量，0不显示，超过99显示99+。通知页面读取记录后标记已读，返回页面再刷新。站内未读、微信订阅授权、notification-worker投递结果是三个状态，不要把其中一个的成功当成另两个成功。工作流手动触发不会自动提交审核或发布。

### 图片

必须保留：上传须知→选择图片→可选压缩/裁剪→云存储→media待审核→队长审核→公开显示。未审核图片不能直接写为公开头像。取消选图、隐私声明未生效、权限拒绝、云存储失败和元数据失败需分别处理；不能统一报“已取消选择”。

微信隐私指南中的“选中的照片或视频信息”与“相册写入”不是同一声明。当前app.config.ts还保留scope.userLocation与chooseLocation声明；此前文档有清理多余声明的建议，尚未在本快照执行，需核对实际后台审批再改。

### 会费与审计

会费调整有申请和队长审批流程；不要把前端演示金额当成云端真值。关键写入保留audit_logs，不要删除最后一名队长保护、成员认领唯一性与球队隔离。数据同步脚本可写真实生产，见第9节。

## 7. 测试、构建和验收

```sh
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm exec eslint --ext .ts,.tsx src scripts tests
pnpm exec taro build --type weapp --no-check
node scripts/build-cloudfunctions.mjs
```

本次确认类型检查、76项测试和云函数构建通过；曾对相关文件运行ESLint，不把全仓ESLint描述成已全量通过。旧文档里的测试数和数据量是当时快照。

关键回归：tests/stats-cloud-function.test.ts、team-stats-snapshot.test.ts、account-stats-overview.test.ts、notice-unread.test.ts、media-upload.test.ts、media-cloud-store.test.ts。云函数测试加载JavaScript并模拟数据库，不能替代真实CloudBase及手机验收。

涉及统计时，至少验证正式球员累计、客串排除、已移出名册球员、重复保存、版本冲突、榜单和个人页一致；删除赛事需确认累计回退。涉及媒体时，测试实际选图、待审、审批后展示及取消后恢复按钮。涉及权限时，用对应真实角色验证，不能只用队长账号走通就结束。

## 8. 已知限制与未完成事项

| 项目 | 交付状态与后续动作 |
| --- | --- |
| 头像 | 开发者工具实际上传为pending_review成功，测试记录已软删除；真机和审批后展示仍需验证 |
| 比赛照片 | 能打开系统选择器，测试PNG/JPEG的Open按钮禁用，完整上传待真机复验 |
| 个人数据联动 | 云端26份过期个人数据已修复，读回差异0，接口与测试通过；补修后手机显示需确认 |
| 聚合上限 | 名册及汇总当前200名，超过后要分页 |
| 计入统计开关 | 编辑赛事开关后对既有单场记录的同步需补端到端验证；保存赛果会按当前开关写countInStats |
| 消息回调 | cloudrun-src为准备代码，不能推断已部署 |
| 线上状态 | 本次不重新导出数据或核实所有云函数；旧套餐价格、到期时间和集合数量不能当作今天状态 |
| 跨年统计 | 尚未完整分离赛季与生涯口径 |
| public-query旧汇总路径 | getPlayerAggregates尚无显式limit，存在默认20组截断风险；当前主同步入口为team.getSnapshot，接手时不要直接复用旧汇总路径 |

这些限制保留在公开交接中。不要向下一位维护者宣称照片问题、所有线上状态或正式发布已完成。

## 9. 数据脚本和历史文档的使用边界

scripts/sync-roster-cloud.ts、sync-yearbook-cloud.ts含生产环境及球队ID，--commit会产生真实写入。它们服务于特定历史导入，普通开发不需要运行。使用前先读脚本，核对数据来源、输出计划、备份路径和目标环境。

roster脚本的GBA_CLOUDBASE_CLI指向供Node执行的CLI入口，默认是原Windows路径；yearbook脚本调用可执行文件，默认/opt/homebrew/bin/cloudbase。两者参数含义不同，不能只把同一个命令路径复制给两者。

不要执行旧部署手册中的“清空team_memberships”“首次Insert全量历史数据”等步骤。现有生产环境已有人使用。原维护者本机备份不在仓库，需要时单独向维护者取得并确认用途。

历史资料阅读顺序：本README→AGENTS.md→docs/HANDOFF-2026-10-15.md→docs/2026-10-01-赛事榜单上传与通知修复记录.md→相关源码和测试。其他docs是带日期的背景资料，冲突时以当前源码及实测线上结果为准。

## 10. 微信上传、审核与正式发布

1. 明确本次要上传的源码，完成类型检查、相关测试和微信构建。
2. 同步前端导入包，使用有开发权限的账号登录微信开发者工具。
3. 点击Upload，填写新的版本号和真实改动说明。当前已确认上传的是2.1.5；下次版本需先查看后台，避免复用冲突号。
4. 等待Upload Successfully，再到https://mp.weixin.qq.com/的版本管理核对版本、上传时间和备注。
5. 上传开发版、设为体验版、提交审核、审核通过、正式发布分别记录。当前交接只确认2.1.5上传成功。
6. 新前端不自动部署云函数；部署云函数也不自动更新用户手机里的前端。

.github/workflows/upload-wechat-experience.yml在接力仓库仅允许workflow_dispatch手动触发。仓库不配置上传私钥，推送代码不会自动上传微信。以后若启用CI，需要所有者自行配置MINIPROGRAM_PRIVATE_KEY与微信IP要求；该工作流尚未在接力仓库验收，不能视为现成可用的一键发布。

## 11. 故障定位顺序

| 现象 | 先查 |
| --- | --- |
| 界面改了但手机没变化 | 实际上传目录、版本号、体验/正式入口，不能只看本地dist |
| 榜单与个人数据不同 | 单场countInStats→stats汇总→team快照→membership个人接口→缓存与刷新 |
| 云端禁止操作 | OPENID、team_memberships审核状态、角色及teamId，不能改前端角色绕过 |
| 保存历史赛果失败 | 原始error.code、球员是否已删除、match-only元数据、expectedVersion |
| 上传图片失败 | errMsg、隐私声明、选图取消、云存储权限、media元数据及审核状态 |
| 构建卡住 | 独立tsc，然后Taro加--no-check；检查Node和本机架构 |
| pnpm安装失败 | 固定版本、锁文件、依赖安装日志，不随意全量升级 |
| 云端部署成功但行为旧 | 下载该环境该函数代码核对，确认调用环境和前端缓存 |

## 12. 交付文件与协作

完整源码、已构建前端、9个一致的云函数部署包、规则、测试、锁文件和说明都在仓库及完整ZIP中。node_modules、缓存、密钥、微信登录态、浏览器资料和真实云端数据备份不在包里。下载后install生成依赖即可。

下载后可先执行`node scripts/verify-handoff.mjs`核对文件和云函数一致性。HANDOFF-MANIFEST.json用于验证交付基线；正常修改源码后哈希会改变，发布新接力包时应更新清单和Release文件，不能继续用旧清单宣称一致。源码文件与压缩包应以同一提交为准。

朋友可直接下载公开仓库；需要推送时再由所有者在Settings→Collaborators邀请。任何AI接手时应说明正在修改的源码、验证结果、是否同步导入包、是否部署云端、是否上传微信及尚未完成的验收，避免把不同阶段混为一谈。
