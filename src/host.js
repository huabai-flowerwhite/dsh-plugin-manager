// dsh-plugin-manager — Host half (persistent plugin)
//
// 第三方插件管理器 Host 半体：在 host composition（web profile）挂载后，
// 通过 webServer 注册三个路由：
//   POST /dsh-plugin-manager/scan    扫描用户选择的第三方插件库文件夹
//   POST /dsh-plugin-manager/toggle  关闭/启动某个第三方插件（写 cordis.patch.yml disabled）
//   GET  /dsh-plugin-manager/status  返回 patch 路径与各插件当前启停状态
//
// 重要实现约束（落地验证后修正）：
//   - `ctx.get('fs')` 在 host composition 全局 context 里不可用（fs 是 per-agent
//     服务，`SandboxedFileSystem` 注入 `sandboxPolicy` 且带 isolate realm 过滤）。
//     本插件是 host 平面插件，直接用 node:fs 访问文件系统（与官方 dsh-fs-local
//     一样 `import ... from 'node:fs'`），不依赖 ctx.fs。
//   - `webServer` 是 host 平面服务，但由 `webserver` entry 异步依赖驱动
//     （inject: [webStartup] → cmdlineArgs）。必须用 `inject: ['webServer']`
//     声明硬依赖、并用 `ctx.webServer` 访问，否则 apply 在 webServer 提供之前
//     执行，`ctx.get('webServer')` 返回 undefined。`loader` 用 ctx.get 可选读取。

import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve as pathResolve, basename as pathBasename, join as pathJoin } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'out',
  '.dsh-plugin-design', '.next', '.turbo', 'target', '.DS_Store',
])

export default {
  inject: ['webServer'],

  apply(ctx) {
    // ---- helpers ----
    function basename(p) {
      return pathBasename(String(p))
    }
    function readText(p) {
      return readFileSync(p, 'utf8')
    }
    function tryReadText(p) {
      try { return readText(p) } catch (e) { return null }
    }
    function writeText(p, content) {
      writeFileSync(p, content, 'utf8')
    }
    function escapeRegExp(s) {
      return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    function json(res, status, obj) {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(obj))
    }
    async function readBody(req) {
      let body = ''
      for await (const chunk of req) body += chunk
      return body
    }

    // ---- DSH home / patch location ----
    // Resolve $DSH_HOME with cross-platform fallbacks:
    //   1. explicit DSH_HOME env (all platforms)
    //   2. Windows: USERPROFILE\.dsh
    //   3. POSIX:   HOME/.dsh
    function dshHome() {
      const env = (typeof process !== 'undefined' && process.env) || {}
      if (env.DSH_HOME) return env.DSH_HOME
      if (env.USERPROFILE) return pathJoin(env.USERPROFILE, '.dsh')
      if (env.HOME) return pathJoin(env.HOME, '.dsh')
      return ''
    }
    async function findPatchPath() {
      const home = dshHome()
      const base = pathJoin(home, 'profiles')
      try {
        const names = readdirSync(base, { withFileTypes: true })
        for (const e of names) {
          if (!e.isDirectory()) continue
          const p = pathJoin(base, e.name, 'cordis.patch.yml')
          const text = tryReadText(p)
          if (text !== null && text.indexOf('dsh-plugin-manager') !== -1) return p
        }
      } catch (e) { /* fall through */ }
      return pathJoin(base, 'web', 'cordis.patch.yml')
    }

    // ---- plugin discovery (heuristic, same as dsh-plugin-design) ----
    function isDshSelfDir(dirPath) {
      const pkgText = tryReadText(pathJoin(dirPath, 'package.json'))
      if (pkgText === null) return false
      try {
        const pkg = JSON.parse(pkgText)
        if (pkg && pkg._npx && Array.isArray(pkg._npx.packages) && pkg._npx.packages.indexOf('@deepseek-ai/dsh') !== -1) return true
        if (pkg && pkg.dependencies && pkg.dependencies['@deepseek-ai/dsh']) return true
      } catch (e) { /* regex fallback below */ }
      return /"_npx"\s*:\s*\{[^}]*"packages"\s*:\s*\[[^\]]*@deepseek-ai\/dsh/.test(pkgText) || /"@deepseek-ai\/dsh"\s*:/.test(pkgText)
    }

    function listDir(dirPath) {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          path: pathJoin(dirPath, e.name),
        }))
      } catch (e) {
        return null
      }
    }

    function discoverPlugins(rootPath, maxDepth) {
      const results = []
      const rootDir = pathResolve(rootPath)
      function walk(dirPath, depth) {
        if (depth > maxDepth) return
        const entries = listDir(dirPath)
        if (entries === null) return
        let hasManifest = false, hasPkg = false, hasPatch = false, pkgName = null
        const subdirs = []
        for (const e of entries) {
          const n = e.name
          if (SKIP_DIRS.has(n)) continue
          if (e.type === 'directory') subdirs.push(e.path)
          else if (n === 'dsh.plugin.yaml') hasManifest = true
          else if (n === 'package.json') hasPkg = true
          else if (n === 'cordis.patch.yml') hasPatch = true
        }
        if (hasPkg && isDshSelfDir(dirPath)) return
        if (hasManifest || hasPkg) {
          if (hasPkg) {
            const raw = tryReadText(pathJoin(dirPath, 'package.json'))
            try { const pkg = JSON.parse(raw); pkgName = (pkg && pkg.name) || null } catch (e) { pkgName = null }
          }
          results.push({
            path: dirPath,
            name: pkgName || basename(dirPath),
            dirName: basename(dirPath),
            hasManifest: hasManifest,
            hasPackageJson: hasPkg,
            hasCordisPatch: hasPatch,
            depth: depth,
          })
        }
        if (depth < maxDepth) {
          for (const s of subdirs) walk(s, depth + 1)
        }
      }
      walk(rootDir, 0)
      return results
    }

    // ---- composition status helpers ----
    function currentMountedMap() {
      const loader = ctx.get('loader')
      const map = {}
      if (loader !== undefined) {
        try {
          for (const entry of loader.entries()) {
            if (entry.options && entry.options.group) continue
            const name = entry.options && entry.options.name
            if (name) map[name] = { mounted: true, enabled: !entry.disabled }
          }
        } catch (e) { /* loader unavailable */ }
      }
      return map
    }

    // Find the `- id: <id>` row start (line index) in patch text; -1 when absent.
    function findRowStart(lines, id) {
      const re = new RegExp('^\\s*-\\s*id:\\s*' + escapeRegExp(id) + '\\s*$')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i
      }
      return -1
    }

    // Find the `disabled: true` line belonging to the row starting at rowStart.
    function findDisabledLine(lines, rowStart) {
      const indentMatch = lines[rowStart].match(/^(\s*)/)
      const rowIndent = indentMatch ? indentMatch[1].length : 0
      for (let i = rowStart + 1; i < lines.length; i++) {
        const line = lines[i]
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('#')) continue
        const m = line.match(/^(\s*)/)
        const indent = m ? m[1].length : 0
        if (indent <= rowIndent) break
        if (/^disabled\s*:\s*true\s*$/.test(trimmed)) return i
      }
      return -1
    }

    function applyDisabledMark(lines, rowStart, disabled) {
      const existing = findDisabledLine(lines, rowStart)
      if (disabled) {
        if (existing !== -1) return { lines, changed: false }
        const indentMatch = lines[rowStart].match(/^(\s*)/)
        const rowIndent = indentMatch ? indentMatch[1].length : 0
        const marker = ' '.repeat(rowIndent + 2) + 'disabled: true'
        // Insert right after the row's last property line (name/config).
        let insertAt = rowStart + 1
        let lastProp = rowStart
        while (insertAt < lines.length) {
          const line = lines[insertAt]
          const trimmed = line.trim()
          if (trimmed === '' || trimmed.startsWith('#')) { insertAt++; continue }
          const m = line.match(/^(\s*)/)
          const indent = m ? m[1].length : 0
          if (indent <= rowIndent) break
          lastProp = insertAt
          insertAt++
        }
        lines.splice(lastProp + 1, 0, marker)
        return { lines, changed: true }
      }
      if (existing === -1) return { lines, changed: false }
      lines.splice(existing, 1)
      return { lines, changed: true }
    }

    function buildInsertBlock(id, name, disabled) {
      let block = '- insert:\n'
      block += '    - id: ' + id + "\n"
      block += "      name: '" + String(name).replace(/'/g, "\\'") + "'\n"
      if (disabled) block += '      disabled: true\n'
      return block
    }

    // ---- routes ----
    const webServer = ctx.webServer

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-manager/scan',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req) || '{}')
          const root = body.root || ''
          if (!root) return json(res, 400, { error: 'root path required', plugins: [], count: 0 })
          const maxDepth = body.maxDepth !== undefined ? body.maxDepth : 5
          const plugins = discoverPlugins(root, maxDepth)
          const patchPath = await findPatchPath()
          const patchText = tryReadText(patchPath)
          const patchLines = patchText ? patchText.split('\n') : []
          const mountedMap = currentMountedMap()
          const enriched = plugins.map((p) => {
            const rowStart = findRowStart(patchLines, p.dirName)
            const nameRow = patchText ? patchText.indexOf("name: '" + p.name + "'") !== -1 : false
            const disabledLine = rowStart !== -1 ? findDisabledLine(patchLines, rowStart) : -1
            const loaded = mountedMap[p.name]
            return {
              path: p.path,
              name: p.name,
              dirName: p.dirName,
              hasManifest: p.hasManifest,
              hasPackageJson: p.hasPackageJson,
              hasCordisPatch: p.hasCordisPatch,
              mounted: !!(loaded && loaded.mounted),
              enabled: !!(loaded && loaded.enabled),
              inComposition: rowStart !== -1 || nameRow,
              disabledInPatch: disabledLine !== -1,
            }
          })
          json(res, 200, { root, patchPath, count: enriched.length, plugins: enriched })
        } catch (e) {
          json(res, 500, { error: String(e && e.message ? e.message : e), plugins: [], count: 0 })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-manager/toggle',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req) || '{}')
          const pluginPath = body.pluginPath
          const enable = body.enable === true
          if (!pluginPath) return json(res, 400, { error: 'pluginPath required' })
          const id = body.id || basename(pluginPath)
          const patchPath = await findPatchPath()
          const text = readText(patchPath)
          writeText(patchPath + '.bak', text)
          const lines = text.split('\n')
          const rowStart = findRowStart(lines, id)
          let changed = false
          if (rowStart !== -1) {
            const out = applyDisabledMark(lines, rowStart, !enable)
            changed = out.changed
          } else if (enable) {
            const block = buildInsertBlock(id, basename(pluginPath), false)
            writeText(patchPath, text.trimEnd() + '\n\n' + block)
            changed = true
          } else {
            const block = buildInsertBlock(id, basename(pluginPath), true)
            writeText(patchPath, text.trimEnd() + '\n\n' + block)
            changed = true
          }
          if (changed && rowStart !== -1) {
            writeText(patchPath, lines.join('\n'))
          }
          json(res, 200, {
            ok: true,
            pluginPath,
            id,
            enabled: enable,
            patchPath,
            changed,
            note: 'composition 在启动时加载，重启 dsh 后生效',
          })
        } catch (e) {
          json(res, 500, { error: String(e && e.message ? e.message : e) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-plugin-manager/status',
      handler: async (req, res) => {
        try {
          const patchPath = await findPatchPath()
          const text = tryReadText(patchPath)
          const lines = text ? text.split('\n') : []
          const rows = []
          const idRe = /^\s*-\s*id:\s*(\S+)\s*$/
          for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(idRe)
            if (!m) continue
            rows.push({
              id: m[1],
              disabled: findDisabledLine(lines, i) !== -1,
            })
          }
          json(res, 200, { patchPath, ok: true, rows })
        } catch (e) {
          json(res, 500, { error: String(e && e.message ? e.message : e) })
        }
      },
    }))
  },
}
