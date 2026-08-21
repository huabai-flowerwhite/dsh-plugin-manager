// dsh-plugin-manager — Client half (settings UI, factory-form bundle)
//
// 在「设置 → 第三方插件」页提供第三方插件管理器：
//   选择插件库文件夹 → 扫描 → 列表（名称/路径/状态）→ 启动/关闭开关。
// 通过 fetch 调 Host 半体的 /dsh-plugin-manager/* 路由（与 dsh-plugin-design 一致）。

window.__ModuleLoader__.load({
  id: 'dsh-plugin-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    function h(tag, props, kids) {
      return React.createElement(tag, props, ...(Array.isArray(kids) ? kids : [kids]))
    }

    const css = {
      panel: { fontFamily: 'inherit', padding: '4px 0', lineHeight: '1.6', maxWidth: 860 },
      h3: { margin: '0 0 6px', fontSize: 15, fontWeight: 600 },
      lead: { opacity: 0.75, fontSize: 13, marginBottom: 8 },
      section: { margin: '14px 0' },
      row: { display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: '1px solid var(--color-border, #ddd)', borderRadius: 8, marginBottom: 8 },
      meta: { flex: '1 1 auto', minWidth: 0 },
      name: { fontWeight: 600, fontSize: 13 },
      path: { fontSize: 12, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      sub: { fontSize: 11, opacity: 0.6, marginTop: 2 },
      input: { flex: '1 1 auto', minWidth: 0, border: '1px solid var(--color-border, #ccc)', background: 'var(--color-bg, #fff)', color: 'var(--color-text, #222)', borderRadius: 6, padding: '6px 10px', fontSize: 13 },
      btn: { border: '1px solid var(--color-border, #ccc)', background: 'var(--color-bg-secondary, #f5f5f5)', color: 'var(--color-text, #222)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
      btnPrimary: { border: '1px solid var(--color-brand, #2563eb)', background: 'var(--color-brand, #2563eb)', color: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
      btnOn: { border: '1px solid #b91c1c', background: '#fee2e2', color: '#b91c1c', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
      btnOff: { border: '1px solid #15803d', background: '#dcfce7', color: '#15803d', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
      badge: { display: 'inline-block', borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 500, lineHeight: '17px', whiteSpace: 'nowrap' },
      badgeOn: { background: '#dcfce7', color: '#15803d' },
      badgeOff: { background: '#fee2e2', color: '#b91c1c' },
      badgeNone: { background: '#e5e7eb', color: '#6b7280' },
      empty: { opacity: 0.7, fontSize: 13, padding: '8px 0' },
      err: { color: '#c00', fontSize: 13, marginTop: 8 },
      note: { fontSize: 12, opacity: 0.7, marginTop: 10 },
      hint: { fontSize: 12, opacity: 0.6, marginTop: 4 },
    }

    function statusBadge(p) {
      if (p.enabled) return h('span', { style: Object.assign({}, css.badge, css.badgeOn) }, '已启用')
      if (p.inComposition || p.disabledInPatch || p.mounted) return h('span', { style: Object.assign({}, css.badge, css.badgeOff) }, '已禁用')
      return h('span', { style: Object.assign({}, css.badge, css.badgeNone) }, '未挂载')
    }

    function Panel(props) {
      const [root, setRoot] = React.useState('')
      const [plugins, setPlugins] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [patchPath, setPatchPath] = React.useState('')
      const pickDirectoryFn = props && props.pickDirectory

      function pickDirectory() {
        if (pickDirectoryFn) {
          setError(null)
          pickDirectoryFn().then(function (path) {
            if (path) setRoot(path)
          }).catch(function (e) {
            setError('目录选择失败：' + String(e && e.message ? e.message : e) + '（可在输入框手动粘贴路径）')
          })
        } else {
          setError('当前环境未提供目录选择器，请手动输入路径')
        }
      }

      function scan() {
        const target = String(root || '').trim()
        if (!target) { setError('请先选择或输入第三方插件库文件夹路径'); return }
        setLoading(true)
        setError(null)
        setNotice(null)
        fetch('/dsh-plugin-manager/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ root: target }),
        }).then(function (r) { return r.json() }).then(function (data) {
          setPlugins((data && data.plugins) || [])
          if (data && data.patchPath) setPatchPath(data.patchPath)
          setLoading(false)
        }).catch(function (e) {
          setError(String(e && e.message ? e.message : e))
          setLoading(false)
        })
      }

      function toggle(p) {
        const enable = !p.enabled
        setBusy(p.path)
        setError(null)
        setNotice(null)
        fetch('/dsh-plugin-manager/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pluginPath: p.path, id: p.dirName, enable: enable }),
        }).then(function (r) { return r.json() }).then(function (d) {
          setBusy(null)
          if (d && d.ok) {
            setNotice('已写入 ' + (d.patchPath || patchPath) + '，' + (d.note || '重启 dsh 后生效'))
            scan()
          } else {
            setError((d && d.error) || '操作失败')
          }
        }).catch(function (e) {
          setBusy(null)
          setError(String(e && e.message ? e.message : e))
        })
      }

      React.useEffect(function () {
        fetch('/dsh-plugin-manager/status').then(function (r) { return r.json() }).then(function (d) {
          if (d && d.patchPath) setPatchPath(d.patchPath)
        }).catch(function () {})
      }, [])

      function pluginRow(p) {
        const enabled = !!p.enabled
        return h('div', { style: css.row, key: p.path }, [
          h('div', { style: css.meta }, [
            h('div', { style: css.name }, p.name),
            h('div', { style: css.path }, p.path),
            h('div', { style: css.sub }, (p.hasManifest ? 'manifest' : 'no-manifest') + ' · ' + (p.hasPackageJson ? 'package.json' : 'no-package.json') + (p.hasCordisPatch ? ' · cordis.patch.yml' : '')),
            h('div', { style: Object.assign({}, css.sub, { marginTop: 4 }) }, statusBadge(p)),
          ]),
          h('button', {
            style: enabled ? css.btnOn : css.btnOff,
            disabled: busy === p.path,
            onClick: function () { toggle(p) },
          }, busy === p.path ? '处理中…' : (enabled ? '关闭' : '启动')),
        ])
      }

      return h('div', { style: css.panel }, [
        h('h3', { style: css.h3 }, '第三方插件'),
        h('div', { style: css.lead }, '选择第三方插件库文件夹，搜索其中的第三方插件，并一键关闭/启动（写入 cordis.patch.yml 的 disabled 标记，重启 dsh 后生效）。'),

        h('div', { style: css.section }, [
          h('div', { style: css.row }, [
            h('input', {
              style: css.input,
              placeholder: '第三方插件库文件夹路径，如 E:\\creat\\DSH\\rule',
              value: root,
              onChange: function (e) { setRoot(e.target.value) },
            }),
            h('button', { style: css.btn, onClick: pickDirectory }, '选择文件夹'),
            h('button', { style: css.btnPrimary, onClick: scan, disabled: loading }, loading ? '扫描中…' : '扫描'),
          ]),
          h('div', { style: css.hint }, patchPath ? '当前 composition patch：' + patchPath : ''),
        ]),

        h('div', { style: css.section }, [
          plugins.length === 0
            ? h('div', { style: css.empty }, loading ? '正在扫描第三方插件…' : '尚未扫描，或该文件夹中未发现第三方插件项目（含 dsh.plugin.yaml 或 package.json 的目录）')
            : plugins.map(pluginRow),
        ]),

        notice !== null ? h('div', { style: Object.assign({}, css.note, { color: '#15803d' }) }, notice) : null,
        error !== null ? h('div', { style: css.err }, error) : null,
        h('div', { style: css.note }, '说明：关闭/启动通过修改 cordis.patch.yml 实现，重启 dsh 后生效；每次修改前自动备份为 cordis.patch.yml.bak。'),
      ])
    }

    function apply(ctx) {
      const slots = ctx.slots
      const workspaces = ctx.get('workspaces')
      const pickDirectory = workspaces && typeof workspaces.pickDirectory === 'function'
        ? function () { return workspaces.pickDirectory() }
        : null
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'dsh-plugin-manager', order: 90, label: '第三方插件' },
          function () { return React.createElement(Panel, { pickDirectory: pickDirectory }) },
        )
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
