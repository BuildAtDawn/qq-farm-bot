<div align="center">

<img src="web/public/icon.png" width="96" alt="QQ Farm Bot 图标">

# QQ Farm Bot

🌱 一位会自己浇水、除草、收菜的 QQ 农场小帮手

[能做什么](#-能做什么) · [微信扫码](#-微信扫码登录) · [开始种田](#-开始种田) · [Docker 部署](#-docker-部署) · [更新记录](docs/CHANGELOG.md) · [使用文档](#-使用文档) · [支持项目](#-支持项目)

</div>

> [!WARNING]
> 快乐种田，谨慎使用。本项目仅供学习和研究，自动化操作可能违反游戏服务条款，账号及其他相关风险由使用者自行承担。

> [!TIP]
> 欢迎 Fork 本项目并提交 PR。项目主要由个人利用业余时间维护，精力有限，功能更新、问题修复和兼容性适配难免有所遗漏。如果你发现 Bug、有新的想法，或有更好的实现方案，欢迎直接参与贡献，共同完善项目。

## 🌾 能做什么

- 👨‍🌾 **照看多座农场**：多个账号统一管理，也可以单独控制
- 💧 **打理日常农活**：农场、好友、任务、商城和活动自动化
- 🖥️ **随时看看田里**：Web 控制面板、实时日志和数据统计
- 🌻 **认识每株作物**：作物图鉴、土地状态和变异效果展示
- 🎉 **赶上限时活动**：支持“奶茶热销中”等活动，查看店铺经营、制作奶茶、雇佣员工与领取奖励，还有活动分析
- 📱 **轻松添加账号**：支持内置微信扫码、手机抓包登录和 QQ 好友同步
- 📦 **多种方式开工**：支持源码、Docker 和桌面二进制构建

> 🌱 想看看这片农场是怎么一步步长大的吗？前往[农场成长记录](docs/CHANGELOG.md)查看最新更新和完整历史。

## 🧋 最新更新 · v2.8.0

- 新增“奶茶热销中”活动页，支持店铺开业与改名、升级与等级预览、奶茶制作、员工雇佣与互动、营业记录、排行榜，以及快乐值和成长基金奖励展示与领取。
- 在“设置 → 账号设置 → 日常与活动”配置自动制作奶茶、升级店铺、雇佣员工、使用宣传喇叭、购买已解锁种子及领取各类收益和奖励；自动雇佣可选择时长与员工类型。
- 支持自动购买奶茶点券限时礼包，仅在点券足够买完剩余限额时执行；活动商城不支持钻石购买，成长基金仅领取已解锁奖励。
- 补全活动种子、果实、黄金作物及生长阶段图片，优化店铺升级奖励布局。活动入口和自动化按经营期、领奖期分别管理，过期后关闭对应开关并阻止继续执行。

## <th><img src="https://cdn.simpleicons.org/wechat/07C160" height="20" alt="微信" /></th> 微信扫码登录

微信玩家可直接在“添加账号 → 微信扫码”中完成登录。扫码链路已内置到 Bot 进程，通过应用宝 OAuth 获取微信会话，并使用内置 MMTLS 协议换取农场短时效 Code，无需额外部署 YYB-GO、第三方登录 API 或代理容器。

## 🧺 小推车里装了什么

| 模块 | 技术 |
| --- | --- |
| 后端 | Node.js、Express、Socket.IO、CommonJS |
| 前端 | Vue 3、Vite、TypeScript、Pinia、UnoCSS |
| 工程 | pnpm workspace、Docker |

管理面板默认住在 `3007` 端口。

## 🚜 开始种田

### 准备工具

- Node.js 20+
- pnpm 10+
- Git

### 把农场跑起来

```bash
git clone https://github.com/BuildAtDawn/qq-farm-bot.git
cd qq-farm-bot

corepack enable
pnpm install
pnpm build:web
pnpm dev:core
```

看到服务启动后，打开 <http://localhost:3007>，你的农场控制室就准备好了。

macOS / Linux 也可以在项目目录直接启停本地后台服务：

```bash
./start.sh
./stop.sh
```

`start.sh` 首次运行会安装缺失的依赖，每次启动会构建最新前端；重复启动不会创建第二个服务。
服务就绪后打开 <http://localhost:3007>，关闭终端后服务仍会运行。账号运行状态在 Web 面板中控制。
日志位于 `core/data/local-service.log`，可用 `tail -f core/data/local-service.log` 查看。
需要其他端口时使用 `ADMIN_PORT=3008 ./start.sh`，停止时仍运行 `./stop.sh`。

想继续装修控制室？可以另外启动前端开发服务器：

```bash
pnpm dev:web
```

## 🐳 Docker 部署

```bash
git clone https://github.com/BuildAtDawn/qq-farm-bot.git
cd qq-farm-bot
docker compose up -d --build
```

查看运行状态和日志：

```bash
docker compose ps
docker compose logs -f
```

更新代码后重新构建：

```bash
git pull
docker compose up -d --build
```

默认映射：

| 用途 | 端口或目录 |
| --- | --- |
| Web 管理面板 | `3007` |
| 抓包代理端口 | `18000` |
| 持久化数据 | 仓库上级目录的 `data/` |

源码运行、Docker 和二进制发布版的抓包服务均默认关闭；只有在
“系统配置 → Code/GID 抓取服务”中开启后才会启动，并且只使用代理端口 `18000`。

如需指定抓包服务对外地址，可在仓库根目录创建 `.env`：

```dotenv
CAPTURE_ADVERTISE_IPS=192.168.1.100,100.64.0.2
```

## 🔑 登录方式

### 面板访问 Code

访问 Code 默认为空，不再内置固定值。首次打开面板时，登录页会要求设置并确认访问 Code，
设置成功后使用新 Code 登录。请在服务对外开放前完成首次设置，避免被其他访问者抢先设置。

登录后可在“设置 → 全局设置 → 访问 Code”修改。修改成功后，所有旧 token 立即失效，
已连接的面板会退出，需要使用新 Code 重新登录；保存相同 Code 不会踢出。

Code 按明文持久化在数据目录中的 `admin-access-code.json`，默认是
`core/data/admin-access-code.json`；设置 `FARM_DATA_DIR` 时使用该目录，Docker 部署随数据卷保留。
配置文件不应提交到仓库。文件损坏或不可读时不会退回首次设置模式，也不会恢复旧的固定 Code。

项目支持微信扫码、QQ/NapCat 扫码、手动填码和手机抓包等账号添加方式。

### QQ/NapCat 扫码（Docker，可选）

NapCat 默认不启动，低配置机器继续使用原来的启动命令即可：

```bash
docker compose up -d --build
```

需要 QQ 扫码登录时，复制示例配置：

```bash
cp .env.compose.example .env
```

在 `.env` 中设置：

```dotenv
COMPOSE_PROFILES=napcat
NAPCAT_LOGIN_ENABLED=true
```

随后执行 `./compose.sh up -d --build`。脚本会读取当前 macOS 或 Linux 宿主机名并将其设置为
QQ 登录记录中的设备名称，然后由 Compose 启动农场和 NapCat 两个服务。构建 NapCat
派生镜像时自动安装 OpenAuth 插件，容器首次启动会生成内部随机 Token，并通过只读文件提供给农场
后端，不需要在环境变量中保存密钥。更新农场或插件代码后仍使用同一条命令，不需要手动运行安装
脚本。NapCat 的配置、内部 Token 和 QQ 登录数据保存在 `../data/napcat/`。
如需覆盖自动检测结果，可在 `.env` 中设置 `NAPCAT_DEVICE_NAME`；建议只使用英文字母、数字和
连字符，并在首次登录后保持不变。修改已有部署的名称后，需要重新创建 NapCat 容器才会生效。

默认基础镜像为 `mlikiowa/napcat-docker:v4.18.19`。官方镜像支持 `linux/amd64` 和
`linux/arm64`，覆盖常见的 x64 Linux、ARM Linux、Intel Mac 和 Apple Silicon Mac；macOS
通过 Docker Desktop 运行相应 Linux 架构镜像。官方没有 32 位 `linux/386` 镜像。可在 `.env`
中通过 `NAPCAT_IMAGE` 选择示例文件列出的其他多架构版本。

### 微信扫码

1. 进入“添加账号 → 微信扫码”。
2. 页面会自动生成二维码；也可以点击二维码空态或“获取/刷新二维码”。
3. 使用手机微信扫码，并在应用宝授权页确认。
4. 授权成功后账号会自动添加、开启 Code 刷新并启动。

微信扫码会话与当前面板用户绑定。若凭证已被微信撤销、长时间停机后过期或手机重新授权导致旧会话失效，需要重新扫码。

账号建立 WebSocket 连接后，Bot 会读取登录回包和心跳回包中的 `version_force` 或 `version_recommend`。检测到符合格式的完整版本（例如 `1.13.1.6_20260723`）时，会自动更新“系统配置 → 客户端版本”，后续连接直接使用该值。强制版本优先于推荐版本，日期部分来自服务端原始版本，不会按本机当天日期生成。

### 手机抓包

iPhone及安卓用户也可使用内置抓包登录服务自动获取登录 Code，并同步 QQ 平台好友。

抓包基本流程：

1. 在“系统配置 → Code/GID 抓取服务”中开启抓包登录。
2. 进入“添加账号 → 抓包登录”，点击“开始抓取”。
3. 按页面提示安装并信任 CA 证书，设置手机 Wi-Fi 代理。
4. 完全关闭并重新打开 QQ 农场，等待面板获取 Code。
5. 完成后关闭手机 Wi-Fi 代理。

证书安装、局域网和 Tailscale 配置请查看[抓包登录服务手册](core/docs/capture-service.md)。

## 🛠️ 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:core` | 启动后端和已构建的管理面板 |
| `pnpm dev:web` | 启动前端开发服务器 |
| `pnpm build:web` | 构建前端 |
| `pnpm lint` | 检查前后端代码 |
| `pnpm -C core test` | 运行后端测试 |
| `pnpm package:release` | 构建各平台二进制文件 |

二进制构建产物位于 `core/dist/`。首次运行时，程序会在数据目录中生成账号、日志和缓存等文件。

## 🗺️ 农场地图

```text
qq-farm-bot/
├── core/                 # 后端、自动化引擎及协议实现
│   ├── docs/             # 登录、活动与 TSDK 维护文档
│   ├── src/              # 配置、接口、模型和业务服务
│   └── test/             # 后端测试
├── web/                  # Vue 管理面板
├── docs/images/          # README 图片资源
├── docker-compose.yml
└── package.json
```

## 📖 使用文档

- [iPhone 抓包登录服务](core/docs/capture-service.md)
- [限时活动适配手册](core/docs/activity-update-runbook.md)
- [TSDK/WASM 更新手册](core/docs/tsdk-update-runbook.md)
- [TSDK/ACE 运行机制](core/docs/tsdk-ace-runtime.md)

## 🔒 数据与安全

`core/data/` 及 Docker 持久化目录可能包含账号、用户、登录日志、好友缓存和统计数据。请妥善备份，并避免提交到公开仓库。

以下内容不应提交：

- 运行时数据与账号信息
- `.env` 及其他密钥文件
- 日志、缓存和临时文件
- `node_modules/` 与构建产物

## 💖 支持项目

如果这个项目对你有帮助，可以通过[爱发电支持 xxxscarlxrd404](https://afdian.com/a/xxxscarlxrd404)。支持完全自愿，不影响项目功能与正常使用。

## 📌 免责声明与使用边界

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。它是“可查看源码的非商业许可证”，不是 OSI 认可的开源许可证。

### 严格禁止商业化

除许可证明确允许的非商业用途外，未经著作权人另行书面授权，不得将本项目或其修改版用于任何商业目的，包括但不限于：

- 付费倒卖、源码售卖、收费下载、收费授权或商业软件集成；
- 付费代部署、托管、租赁、SaaS、账号托管或按次/按量提供服务；
- 以本项目为基础进行收费的二次开发、定制、分发、培训或技术支持；
- 通过会员、订阅、兑换码、授权码、访问卡或其他方式收费或限制访问。

不得通过更改项目名称、界面、打包方式、增加代理服务或拆分组件来规避上述限制。自建、学习、研究、测试、个人娱乐以及符合许可证定义的非商业组织用途，不等于获得商业授权。自愿赞助不构成商业授权，也不改变许可证限制。


### 使用风险

本项目仅供学习、研究、测试和个人非商业用途。使用自动化工具可能违反游戏服务条款或其他规则，也可能导致账号限制、数据丢失、服务中断、法律争议或其他损失。使用者应自行承担全部风险和责任，作者不提供任何明示或默示担保，也不对使用结果负责。

作者未授权任何第三方以本项目名义收费、牟利、承诺账号安全或提供官方支持。通过付费渠道获取的服务或副本，与作者无关；相关纠纷应直接联系收费方。
