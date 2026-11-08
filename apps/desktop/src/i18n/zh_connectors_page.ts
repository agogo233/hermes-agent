import type { TranslationOverrides } from './define-locale'
import { zhConnectorAccounts } from './zh_connector_accounts'

export const zhConnectorsPage: TranslationOverrides['connectorsPage'] = {
  title: '连接器',
  searchPlaceholder: (count: number) => `搜索 ${count} 个应用`,
  filterCategory: '分类',
  categoryAll: '全部分类',
  uncategorised: '未分类',

  residencyLocal: '在本设备上',

  segment: {
    all: '全部',
    available: '可用',
    connected: '已连接',
    off: '已关闭'
  },

  group: {
    connected: '已连接',
    connectedNote: '断开的连接排在前面。',
    available: '可用',
    off: '已关闭',
    offNote: '保留登录状态。'
  },

  card: {
    kindManaged: '托管',
    kindCatalog: 'MCP · 目录',
    kindCustom: 'MCP · 自定义',
    kindPlugin: (plugin: string) => `MCP · 插件 ${plugin}`,
    inCatalog: '在 Hermes 目录中',
    hostedTwin: '有托管版本可用',
    alsoLocal: '也在此设备上运行',
    open: (name: string) => `打开 ${name}`,
    turnServerOn: (name: string) => `开启 ${name}`,
    turnServerOff: (name: string) => `关闭 ${name}`,
    state: {
      accessExpired: '访问已过期',
      available: '可用',
      connected: '已连接',
      connecting: '连接中',
      connectionUnknown: '状态未知',
      couldNotConnect: '无法连接',
      offByYourOrganisation: '已被你的组织关闭',
      offForYou: '已为你关闭',
      serverConnecting: '连接中…',
      serverError: '错误',
      serverNeedsAuth: '需要认证',
      serverOff: '关闭',
      serverOn: '开启',
      serverOnUnused: '开启，未使用'
    },
    fact: {
      tools: (count: number) => `${count} 个工具`,
      toolsOff: (count: number) => `${count} 个工具已关闭`,
      toolsOn: (count: number) => `${count} 个工具已开启`,
      toolsSomeOn: (total: number, on: number) => `共 ${total} 个工具，${on} 个已开启`
    },
    verb: {
      authenticate: '认证',
      connect: '连接',
      install: '安装',
      openLogs: '打开日志',
      reconnect: '重新连接',
      stopWaiting: '停止等待',
      tryAgain: '重试',
      turnBackOn: '重新开启'
    },
    reason: {
      finishSignIn: '请在浏览器中完成登录。',
      reconnect: '重新连接以保持此应用工作。',
      serverError: '服务器拒绝了连接。',
      serverNeedsAuth: '登录以让此服务器应答。'
    }
  },

  page: {
    loading: '正在读取目录和本机上的服务器',
    emptyTitle: '这里还没有应用。请在本机上添加服务器以开始。',
    noMatchTitle: '没有匹配的应用',
    noMatchBody: '没有匹配项。请将 Hermes 指向你自己的 MCP 服务器以添加。',
    clearSearch: '清除搜索',
    hostedFailedTitle: '无法访问托管应用。',
    hostedFailedBody: '本机上的服务器不受影响，仍在运行。未关闭任何内容。',
    retry: '重试',
    matchesElsewhere: (count: number) => `${count} 个匹配在其他分组中。`,
    showAllMatches: '显示所有匹配',
    segmentNoMatch: (segment: string) => `在“${segment}”中没有匹配，因此显示所有匹配。`,
    freeTierNote: '在你登录前，连接仅保留在本机上。',
    signInLine: '登录 Nous 以使用托管应用。',
    signIn: '登录',
    managedUnavailable: '托管应用尚不适用于此账户。',
    writeFailed: '更改未保存。',
    refreshFailed: '工具列表未刷新。',
    disconnectNoAccount: 'Hermes 在此处没有可断开的账户。请刷新页面后重试。',
    disconnectRefused:
      'Nous 暂时无法移除此次登录。请改用开关关闭该应用，或稍后重试。'
  },

  add: {
    action: '添加你自己的',
    title: '连接到自定义 MCP',
    hint: '本机 mcp.json 中的一个新条目',
    pasteLabel: '粘贴命令或片段',
    pastePlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/dir',
    pasteNoMatch: '此处内容无法识别为服务器。请改为填写下方字段。',
    name: '名称',
    nameTaken: '该名称已被使用。',
    type: '类型',
    typeStdio: 'STDIO',
    typeHttp: '流式 HTTP',
    command: '启动命令',
    args: '参数',
    addArg: '+ 添加参数',
    envVars: '环境变量',
    addEnvVar: '+ 添加环境变量',
    passthrough: '环境变量透传',
    addPassthrough: '+ 添加变量',
    cwd: '工作目录',
    url: 'URL',
    headers: '请求头',
    addHeader: '+ 添加请求头',
    auth: '认证',
    authNone: '无',
    authOauth: 'OAuth',
    authBearer: 'Bearer 令牌',
    keyPlaceholder: 'KEY',
    valuePlaceholder: '值',
    removeRow: '移除此行',
    editJson: '编辑 mcp.json',
    saveFailed: '该服务器未保存。'
  },

  dialog: {
    disconnect: '断开连接',
    disconnectTitle: (name: string) => `断开 ${name}？`,
    disconnectBody: 'Hermes 将不再以该账户身份运行。你可以随时重新连接。',
    menuRefreshTools: '刷新工具',
    moreActions: '更多操作',
    removeServerTitle: (name: string) => `移除 ${name}？`,
    removeServerBody: '该条目会从本机 mcp.json 中移除。其他内容不会被删除。',
    appSwitch: (name: string) => `Hermes 可以使用 ${name}`,
    waysTitle: (name: string) => `${name} 运行在哪里`,
    wayNotConnected: (name: string) => `尚未连接。请在浏览器中登录 ${name}。`,
    wayHosted: '托管',
    bothOn: (name: string) => `两者都已开启，因此 Hermes 会看到每个 ${name} 工具两次。`,
    turnOffLocal: '关闭本地服务器',
    providedByPlugin: (plugin: string) => `由插件 ${plugin} 提供`,
    openPlugins: '打开插件标签页',
    // Verbatim, by decision of the design of record.
    nousLine: 'Nous 应用跟随你的账户，而非配置。',
    rulesReadOnly: '当前无法更改规则。',
    rulesAppOff: (name: string) => `开启 ${name} 以更改其工具。`,
    rulesSignIn: '登录以更改 Hermes 在此处可执行的操作。',
    orgNote: (count: number) => `你的组织关闭了 ${count} 个工具。`,
    orgLink: '打开连接器管理',
    connectEnded: '登录未完成。',
    connectOpenAgain: '重新打开链接',
    tokensPerCall: '每次调用令牌数',
    usesPerMonth: '30 天使用次数',
    advanced: '高级',
    advancedHint: 'mcp.json 条目和日志'
  },

  accounts: zhConnectorAccounts,

  tools: {
    title: '工具',
    notInstalledBody: '请在本设备上安装以查看它带来的工具。',
    summaryTitle: (name: string) => `Hermes 可以借助 ${name} 做什么`,
    summaryPreviewTitle: (name: string) => `连接后 Hermes 可以借助 ${name} 做什么`,
    summaryCount: (count: number) => `${count} 个工具`,
    summaryAllTools: '所有工具',
    summaryOther: '其他',
    allToolsSwitch: '开启或关闭所有工具',
    summaryAllOn: '全部开启',
    summarySomeOn: (on: number, total: number) => `已开启 ${on}/${total}`,
    summaryOff: '关闭',
    showAllTools: (count: number) => `显示全部 ${count} 个工具`,
    showSummary: '显示摘要',
    facetSwitch: (facet: string) => `开启或关闭 ${facet} 工具`,
    moreHints: (count: number) => `+${count}`,
    staleSignIn: '登录以读取最新工具列表。',
    searchCountPlaceholder: (count: number) => `搜索 ${count} 个工具`,
    toolList: (name: string) => `${name} 工具`,
    categorySelect: (count: number) => `${count} 个分类`,
    showDeprecated: (count: number) => `显示 ${count} 个已弃用`,
    hideDeprecated: (count: number) => `隐藏 ${count} 个已弃用`,
    quickReadOnly: '只读',
    quickNoDestructive: '关闭破坏性',
    quickEverythingOn: '全部开启',
    lockedHint: '已被你的组织关闭',
    turnToolOn: (tool: string) => `开启 ${tool}`,
    turnToolOff: (tool: string) => `关闭 ${tool}`,
    showDetails: (tool: string) => `显示 ${tool} 的功能`,
    hideDetails: (tool: string) => `隐藏 ${tool} 的功能`,
    noMatch: '没有工具匹配这些筛选条件。',
    loading: '正在读取工具列表',
    unavailableLine: '工具列表不可用。',
    needsAuthTitle: (name: string) => `登录 ${name} 以读取其工具。`,
    needsAuthBody: '登录状态保留在本机上，不会离开。',
    retry: '重试',
    goneTitle: (name: string) => `${name} 已离开目录。`,
    goneBody: 'Hermes 无法再调用它。该行会保留到你移除它为止，因此不会有任何内容消失。',
    remove: '移除',
    offTitle: (name: string) => `${name} 已关闭。`,
    offBody: '请用上方开关开启它，以读取它带来的工具。',
    signedOutTitle: '登录 Nous 以读取工具列表。',
    signedOutBody: '本机上的服务器不受影响。',
    conflictTitle: '你在编辑时，其他人更改了此规则。',
    // Two sentences at most, and the second says the work is still here.
    conflictBody: (theyOff: number, theyOn: number) => {
      const they = [
        theyOff > 0 ? `关闭了 ${theyOff} 个你已开启的工具` : '',
        theyOn > 0 ? `保留 ${theyOn} 个你已关闭的工具为开启` : ''
      ].filter(Boolean)

      return `${they.length > 0 ? `他们${they.join('，并且')}。` : ''}你的编辑仍显示在屏幕上；未写入任何内容。`
    },
    conflictReload: '加载他们的版本',
    conflictSave: '覆盖他们的版本',
    saveFailed: '这些工具规则未保存。',
    footerDirty: (off: number, backOn: number) =>
      `${off} 个工具关闭，${backOn === 0 ? '无' : backOn} 个重新开启`,
    discard: '放弃',
    save: '保存更改',
    saving: '保存中...'
  },

  // The label rides in every tool row, so it stays short enough not to widen one.
  vocabulary: {
    facetRead: { label: '读取', long: '从此应用中读取数据。不会更改任何内容。' },
    facetWrite: { label: '写入', long: '在此应用中创建或更改某些内容。' },
    facetDestructive: { label: '破坏性', long: '可以永久移除此应用中的某些内容。' },
    facetUnclassified: { label: '效果未知', long: '此应用从未说明该工具的作用。' },
    hintReadOnly: { label: '只读', long: '该工具声明它只读取。' },
    hintCreate: { label: '创建', long: '创建新内容。' },
    hintUpdate: { label: '更新', long: '更改已存在的内容。' },
    hintDelete: { label: '删除', long: '移除某些内容。' },
    hintDestructive: { label: '破坏性', long: '其更改无法在此处撤销。' },
    hintIdempotent: { label: '可重复', long: '运行两次与运行一次效果相同。' },
    hintOpenWorld: { label: '外部', long: '触及此应用外部的某些内容。' }
  }
}
