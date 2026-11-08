import type { TranslationOverrides } from './define-locale'

/** Chinese copy for the Plugins tab: updating an installed plugin and the folders it may use. */
export const zhPluginUpdate = {
  updateToPin: (sha: string) => `更新到 ${sha}`,
  updateFailed: (name: string) => `无法更新 ${name}`,
  updated: (name: string) => `${name} 已更新到当前目录固定提交。重启网关后生效。`,
  updateConsentTitle: (name: string) => `${name} 请求更多权限`,
  updateConsentBody: (name: string, sha: string) =>
    `“${name}”（${sha}）的新目录钉包含了已安装版本没有的界面。只有在你信任它们时才应用：`,
  updateScanTitle: (name: string) => `安全扫描标记了 ${name}`,
  updateScanBody: (name: string, count: number) =>
    `对 ${name} 的更新得到警告结论（${count} 处${count === 1 ? '' : '问题'}）。每次更新都会扫描。只有在你信任来源时才应用：`,
  updateScanMore: (count: number) => `+ ${count} 更多`,
  updateScanBlocked: (name: string) =>
    `安全扫描阻止了对 ${name} 的更新（危险结论）。无法覆盖。`,
  updatedGit: (name: string) => `${name} 已更新到最新提交。`,
  updateConsentConfirm: '应用更新',
  updateScanConfirm: '仍要更新',
  folderAccess: {
    title: '文件夹访问',
    hint: (name: string) => `${name} 可以读取和修改这些文件夹中的文件。撤销后立即生效。`,
    revoke: '撤销',
    revokeLabel: (path: string) => `撤销对 ${path} 的访问`,
    revoked: (name: string, path: string) => `${name} 已无法再使用 ${path}。`,
    revokeFailed: (name: string) => `无法撤销 ${name} 的文件夹访问`,
    pickerTitle: (name: string) => `为 ${name} 选择文件夹`,
    pickerButton: '允许访问',
    refusedProtected: (name: string) =>
      `${name} 不能使用该文件夹：其中包含 Hermes 的设置、密钥或插件数据。请选择不包含它们的文件夹。`,
    loadFailed: (name: string) => `无法加载与 ${name} 共享的文件夹。`
  }
} satisfies NonNullable<NonNullable<TranslationOverrides['skills']>['plugins']>
