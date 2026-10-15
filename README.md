# 大湾区流浪者小程序：2.1.5接力开发快照

先读[接力开发说明](docs/HANDOFF-2026-10-15.md)。该快照包含2026年10月14日上传成功的2.1.5前端、当前源码、云函数和微信开发者工具导入包。审核及正式发布状态未核实。

# GBA RANGERS 微信小程序

球队公开数字档案馆与内部赛事管理工具，基于 Taro 4、React、TypeScript 和 CloudBase。

## 本地启动

首次开发需要安装：

- Node.js 18 或更高版本
- pnpm
- 微信开发者工具
- Git

在 MacBook 上可以这样获取并启动项目：

```bash
git clone https://github.com/TristanYuen/gba-rangers-weapp.git
cd gba-rangers-weapp
pnpm install
pnpm dev:weapp
```

```powershell
pnpm install
pnpm dev:weapp
```

项目默认使用本地数据，不需要先连接 CloudBase 就能预览和继续开发。

## MacBook 开发注意事项

- `project.private.config.json` 没有上传，这是微信开发者工具的本地配置文件，不影响基础开发。
- 根目录的 `.cmd` 和 `.ps1` 文件是 Windows 脚本，MacBook 不能直接双击运行。可以使用上面的 pnpm 命令，或直接在微信开发者工具中导入“微信开发者工具导入包”目录。
- `node_modules`、`dist` 和 `cloudfunctions-dist` 不提交到仓库，执行 `pnpm install` 和构建命令即可重新生成。
- 如果需要连接线上 CloudBase，需要使用有权限的微信账号登录，并配置对应的小程序 AppID、CloudBase 环境和云函数权限。
- 本地演示邀请码为 `GBA2026`，线上数据和管理员功能需要真实账号及对应权限。

## 浏览器手机预览

```powershell
pnpm build:h5
pnpm preview:h5
```

浏览器打开 `http://127.0.0.1:4173`。桌面浏览器会显示手机边框，窄屏设备会自动铺满屏幕。

在微信开发者工具中导入本目录，默认 `touristappid` 和本地数据模式可以直接预览公开端。进入“我的球队”可切换球员、管理员和队主演示身份。

生产构建已配置 CloudBase 环境 `cloud1-d4g1nl8yx26d1f3f2`。数据库集合创建后，还需将 `public-query`、`membership`、`match`、`stats`、`media`、`notifications`、`team` 七个云函数部署到该环境，生产数据请求才能正常工作。

第一次验收可以直接按照 [验收清单](docs/ACCEPTANCE.md) 逐页点击，无需填写 AppID 或 CloudBase 环境。

需要检查微信小程序原生效果时，双击项目根目录的 `打开小程序真实预览.cmd`。完整说明见 [真实效果检验方式](docs/REAL_PREVIEW.md)。

本地演示邀请码：`GBA2026`。

## 质量检查

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build:weapp
pnpm build:cloudfunctions
```

完整架构、数据安全边界和 CloudBase 接入步骤见 `docs/ARCHITECTURE.md`。
