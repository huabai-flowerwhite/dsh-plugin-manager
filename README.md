# dsh plugin manager

面向 DeepSeek Harness（dsh）的**第三方插件管理器**：在 Web UI 设置页选择第三方插件库文件夹，搜索其中所有第三方插件，并一键关闭/启动（写入 `cordis.patch.yml` 的 `disabled` 标记，重启 dsh 后生效）。

> 本插件本身也是一个第三方插件，挂载到 host composition 后，**启动 dsh 即默认加载**。

## 解决痛点

```text
dsh用户开发/部署各类插件时，不能随用随关。
问题根源于各类插件可能未遵循dsh的开发规范、以及各类插件并不能完全做到“随用随丢”的独立插件理念。
本插件针对部署的“持久化”插件，提供搜索插件并一键关闭/启动功能。
建议可以先按照dsh plugin design插件对已部署的插件进行“持久化”、“独立”化改造后使用。
```

## 目录结构

```text
dsh-plugin-manager/
├── package.json       # npm 包：exports + dsh.client + dsh.bundle
├── dsh.plugin.yaml    # DH-TP-SDK manifest
├── cordis.patch.yml   # 挂载参考：host composition insert row
├── install.ps1        # Windows 一键安装（junction + patch insert，幂等）
├── install.sh         # POSIX 一键安装（symlink + patch insert，幂等）
├── README.md / design.md
├── lib/client.js      # Client 半体：factory-form bundle（设置页「第三方插件」）
└── src/
    ├── index.js       # 入口 → host.js
    └── host.js        # Host 半体：webServer 路由 scan / toggle / status
```

## 能力

- **Host 半体**：三个 webServer 路由
  - `POST /dsh-plugin-manager/scan` — 扫描指定文件夹中的第三方插件项目（识别 `dsh.plugin.yaml` / `package.json`，跳过 node_modules/.git/dist 与 DSH 自身）。
  - `POST /dsh-plugin-manager/toggle` — 关闭/启动某个插件（写 `cordis.patch.yml` 的 `disabled: true`，写前自动备份 `.bak`）。
  - `GET /dsh-plugin-manager/status` — 返回当前 patch 路径与各插件启停状态。
- **Client 半体**：设置页「第三方插件」，含文件夹选择、扫描、插件列表、启停开关。

## 使用方法

1. 启动 dsh（本插件随 host composition 自动加载）。
2. 进入「设置 → 第三方插件」。
3. 点击「选择文件夹」选择第三方插件库文件夹（或手动粘贴路径），点击「扫描」。
4. 在列表中点击「关闭 / 启动」切换插件状态，重启 dsh 后生效。
5. 可参考目录中的How‑to Showcase.png。

## 安装（一条命令）

本插件是 **npm 包 + host composition row** 形态：设置页「第三方插件」全局加载，重启后自动加载。

下载后，在插件目录内运行对应脚本，即可自动完成「链接进 node_modules + 写入 cordis.patch.yml」两步：

**Windows（PowerShell）**

```powershell
git clone <你的仓库> dsh-plugin-manager
cd dsh-plugin-manager
powershell -ExecutionPolicy Bypass -File install.ps1
```

**Linux / macOS（bash）**

```bash
git clone <你的仓库> dsh-plugin-manager
cd dsh-plugin-manager
bash install.sh
```

脚本是幂等的（重复运行无害）。装完后**重启 dsh**（Ctrl+C 后重新 `npx dsh web` / `dsh web`），即完整可用：「设置 → 第三方插件」出现设置页（选文件夹扫描第三方插件、启停）。

### 脚本做了什么（手动安装等价步骤）

1. 把本目录链接进 node_modules：
   ```text
   $DSH_HOME/profiles/node_modules/dsh-plugin-manager  ->  本目录
   ```
   （`$DSH_HOME` 默认 `~/.dsh`；Windows 用 junction，Linux/macOS 用 symlink。或发布到 npm 后 `npm install dsh-plugin-manager` 亦可。）
2. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 追加：
   ```yaml
   - insert:
       - id: dsh-plugin-manager
         name: 'dsh-plugin-manager'
   ```
   （profile 默认 `web`，可用环境变量 `DSH_PROFILE` 覆盖；DSH home 可用 `-DshHome` 参数或 `DSH_HOME` 环境变量覆盖。）

> 提示：Host 半体（webServer 路由）改 `cordis.patch.yml` 后热生效；Client 半体（设置页）在 boot 时由 `dsh-client-modules` 扫描加载，需重启后刷新页面。

### 给插件作者的命名约定（避免冲突）

每个第三方插件都挂到同一份 `cordis.patch.yml` / `node_modules`，必须保证以下**全局唯一**，否则会相互覆盖或注册报错：

| 命名对象 | 约定（本插件取值） | 冲突后果 |
|---|---|---|
| 包名 / row id / 设置页 slot id | `dsh-<插件名>`（`dsh-plugin-manager`） | 同名 → node_modules 链接与 patch row 互相覆盖 |
| HTTP 路由前缀 | `/<包名>/<动作>`（`/dsh-plugin-manager/scan` 等） | 同名路由注册会 throw |

`install.ps1` / `install.sh` 是**各自仓库根目录的普通文件**，用户在各自的 clone 目录里执行，不会互相冲突；只要坚持「一个插件一个唯一前缀」，多插件共存安全。

## 为什么 Host 与 Client 挂载位置相同

- Host 半体（webServer 路由）与 Client 半体（设置页 UI）都挂到 host composition（web profile），与本包「启动即默认加载、全局可用」的定位一致。
- Client 半体**必须** host composition：`dsh-client-modules` 只扫描 host Loader entries，且 client UI 是 boot 时加载的全局 UI，agent preset 的 client 不会被加载。

## 已知限制

1. 插件启停**重启 dsh 后生效**（composition 在启动时加载；本插件不改动运行中的 Loader）。
2. 「启动」未挂载插件时，要求该插件包已在 `profiles/node_modules` 可解析（junction 或安装），否则 Cordis 无法 import。
3. `pickDirectory()` 依赖官方目录选择器服务；不可用时回退手动输入路径。
4. manifest 为声明式合规文档；实际权限以运行时沙箱策略为准。

## 落地经验（host composition 第三方插件开发踩坑实录）

> 本插件从「写出来」到「真的跑起来」经历了三次重启排查。以下结论均在真实 dsh 上验证过，写新 host 平面插件可直接复用。

### 服务访问速查表

| 服务 | host 平面可用？ | 正确用法 |
|---|---|---|
| `webServer` | ✅ | **必须 `inject: ['webServer']` 硬依赖 + `ctx.webServer`**。它由 `webserver` entry 异步依赖驱动（`inject: [webStartup]` → `cmdlineArgs`），用 `ctx.get('webServer')` 会在 apply 时拿到 undefined（apply 先于 webServer 提供执行）。官方 `dsh-client-modules` 也是 `static inject = ["webServer", "loader"]` |
| `loader` | ✅ | `ctx.get('loader')`（可选读取，判空）。loader 是 host 平面根服务，apply 前必已存在 |
| `fs` | ❌ | `ctx.get('fs')` 返回 undefined。`fs` 是 per-agent 服务（`SandboxedFileSystem` 注入 `sandboxPolicy`，且 `Service[symbols.filter]` 按 isolate realm 过滤）。**替代：直接用 `node:fs`**（官方 `dsh-fs-local` 自己就 import node:fs） |

### 关键坑

1. **`ctx.get('fs')` 不可用 → 用 `node:fs`**：fs 是 per-agent 服务（`SandboxedFileSystem` 注入 `sandboxPolicy` 且带 isolate realm 过滤），在 host composition 全局 context 中返回 undefined。这也是 dsh-plugin-design 的 Host 半体挂 host composition 后 `dshpd_*` 工具**从未注册成功**的根因。本插件用 `import { readFileSync, writeFileSync, readdirSync } from 'node:fs'`。

2. **`webServer` 必须 `inject: ['webServer']` 硬依赖 + `ctx.webServer` 访问**：webServer 由 `webserver` entry 异步依赖驱动（`inject: [webStartup]` → `cmdlineArgs`），用 `ctx.get('webServer')` 会在 apply 时拿到 undefined。

3. **Client 半体的 `ctx` 作用域陷阱**：被渲染组件（`Panel`）内部**不能直接引用 `ctx`**（闭包中不存在，会 ReferenceError）。须在 `apply(ctx)` 内先取服务（如 `ctx.get('workspaces')`），再通过 props 传入组件。

4. **Client 半体必须挂 host composition**：`dsh-client-modules` 只扫描 host Loader entries，浏览器 boot 时按 `window.__DSH_BOOT__` 加载全局 UI；agent preset 的 client 不会被加载。

5. **Client→Host 通信用 `fetch` 调 webServer 路由**：持久化插件没有动态插件的 `host.call`，用 `fetch('/dsh-plugin-manager/...')`。

### 诊断方法

- 重启后看终端 stdout：Host 半体的 `console.error('[dsh-plugin-manager] ...')` 是第一个信号源。
- `dsh --profile web --dump-config`：确认 patch row 是否被正确 compose。
- 独立 node 冒烟脚本（fake ctx + 真实 node:fs + 临时 DSH_HOME 副本）：端到端调路由，不污染真实 patch。
- PowerShell 的 `Get-Content` 默认 GBK 读 UTF-8 会显示乱码，用 read 工具或 `-Encoding UTF8` 确认真实内容。

> 完整推演、源码级机制与最终验证清单见 `design.md` 第 11 节。
