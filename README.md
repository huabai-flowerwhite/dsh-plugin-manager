# dsh plugin manager

面向 DeepSeek Harness（dsh）的**第三方插件管理器**：在 Web UI 设置页选择第三方插件库文件夹，搜索其中所有第三方插件，并一键关闭/启动（写入 `cordis.patch.yml` 的 `disabled` 标记，重启 dsh 后生效）。

> 本插件本身也是一个第三方插件，挂载到 host composition 后，**启动 dsh 即默认加载**。

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

## 安装（host composition 挂载）

本插件是 **npm 包 + host composition row** 形态（与 dsh-plugin-design 相同）。

### 方式一：一键安装脚本（推荐，其他用户用这个）

```bash
# Windows
powershell -ExecutionPolicy Bypass -File install.ps1
# macOS / Linux
bash install.sh
# 可指定 DSH home：
powershell -ExecutionPolicy Bypass -File install.ps1 -DshHome C:\Users\you\.dsh
DSH_HOME=/home/you/.dsh bash install.sh
```

脚本自动完成：① 在 `$DSH_HOME/profiles/node_modules` 建立 junction/symlink 指向本目录；② 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 追加 insert row（幂等，重复运行不产生重复行）；③ 提示重启。运行结束后**重启 dsh** 即生效。

### 方式二：手动安装

1. 把包放进 node_modules（本机用 junction/symlink）：
   ```text
   $DSH_HOME/profiles/node_modules/dsh-plugin-manager  ->  本目录
   ```
   或发布到 npm 后 `npm install dsh-plugin-manager`。

2. 在 `$DSH_HOME/profiles/web/cordis.patch.yml` 加 insert row：
   ```yaml
   - insert:
       - id: dsh-plugin-manager
         name: 'dsh-plugin-manager'
   ```

3. 重启 dsh。Host 半体（webServer 路由）热生效；Client 半体（设置页）在 boot 时由 `dsh-client-modules` 扫描加载，需重启后刷新页面生效。

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
