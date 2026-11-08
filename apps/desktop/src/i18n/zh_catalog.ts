import type { TranslationOverrides } from './define-locale'

export const zhCatalog = {
  add: '添加',
  added: '已添加',
  discover: '发现',
  featured: '精选',
  explorePlugins: '探索插件',
  exploreSkills: '探索技能',
  mostStarred: '星标最多',
  newest: '最新发布',
  recentlyUpdated: '最近更新',
  alphabetical: '名称',
  sortBy: '排序方式',
  seeAll: '查看全部',
  related: '类似推荐',
  tags: '标签',
  screenshots: '截图',
  listView: '列表视图',
  cardView: '卡片视图',
  installTitle: (name: string) => `安装“${name}”？`,
  installDescription: '此技能将在新会话中可用。请仅安装可信来源的内容。',
  installTo: '安装到',
  thisComputer: '此电脑',
  installing: '正在安装…',
  installComplete: (name: string) => `已安装“${name}”`,
  destinationChanged: '安装目标已更改。请关闭此对话框并重新打开安装链接。',
  install: '安装',
  installed: '已安装',
  searchSkills: '搜索技能',
  searchPlugins: '搜索插件',
  allSources: '所有来源',
  allCategories: '所有分类',
  about: '简介',
  author: '作者',
  source: '来源',
  category: '分类',
  version: '版本',
  platforms: '支持的平台',
  requires: '依赖项',
  tools: '工具',
  hooks: '钩子',
  middleware: '中间件',
  commands: '命令',
  license: '许可证',
  addedDate: '添加日期',
  updatedDate: '更新日期',
  repository: '代码仓库',
  documentation: '文档',
  noResults: '没有匹配项',
  tryAnother: '请尝试其他搜索或清除筛选条件。',
  clearFilters: '清除筛选条件',
  filters: '筛选条件',
  loadFailed: '无法加载目录',
  retry: '重试',
  more: '显示更多',
  pinned: '已审核的提交',
  snapshotHint: '内容来自 Hermes 目录。浏览时不会连接来源代码仓库。',
  installHint: '安装前请检查源代码。更改将在新会话中生效。',
  results: (count: number) => `${count.toLocaleString('zh')} 个结果`,
  back: '返回结果',
  tier: '等级',
  previousSlide: '上一个精选',
  nextSlide: '下一个精选',
  tierLabels: {
    official: '官方',
    verified: '已认证',
    community: '社区'
  },
  tiers: {
    official: {
      title: '官方插件',
      blurb: '由 Nous Research 构建和维护。'
    },
    verified: {
      title: '已认证插件',
      blurb: '来自该集成背后的公司，由 Nous 认证。'
    }
  },
  moreToExplore: '更多待探索',
  moreToExploreBlurb: '目录中较小的角落，尽在此处。',
  developer: {
    heading: '开发者模式',
    title: '为 Hermes 构建',
    pitch: '构建了工具、连接器、插件或 Mod？',
    pitchFollowUp: '想构建但不知如何开始？',
    submit: '提交 Mod',
    docs: '开发者文档'
  },
  toolsets: {
    mostUsed: '最常用',
    mostUsedBlurb: '此配置上 Hermes 最常使用的工具集。',
    essentials: '核心',
    essentialsBlurb: '多数 Hermes 工作依赖的内容。',
    themes: {
      work: {
        label: '浏览、工作和自动化',
        blurb: '驱动浏览器和桌面、编辑文件、运行代码并调度工作。'
      },
      create: {
        label: '观看、聆听和创作',
        blurb: '查看图片和视频、转写语音并生成媒体。'
      },
      recall: {
        label: '记忆与知识',
        blurb: 'Hermes 记住的内容，以及它可搜索的技能和历史。'
      },
      connect: {
        label: '连接与触达',
        blurb: '账户、其他代理、智能家居以及超越网页的搜索。'
      },
      more: {
        label: '更多工具',
        blurb: '此配置可开启的其他一切。'
      }
    },
    toolCount: (count: number) => `${count} 个工具`,
    callCount: (count: string, calls: number) => `${count} ${calls} 次调用`
  },
  slideOf: (index: number, count: number) => `${index} / ${count}`,
  skillsFor: (category: string) => `“${category.toLowerCase()}”的技能。`,
  discoverKind: (kind: string) => `发现${kind}`
} satisfies TranslationOverrides['catalog']

export const zhSkillDeepLink = {
  installTitle: (name: string) => `安装“${name}”？`,
  installDescription: '此技能将在新会话中可用。请仅安装可信来源的内容。',
  installTo: '安装到',
  thisComputer: '此电脑',
  installing: '正在安装…',
  installComplete: (name: string) => `已安装“${name}”`,
  destinationChanged: '安装目标已更改。请关闭此对话框并重新打开安装链接。',
  installed: '已安装',
  source: '来源'
} satisfies TranslationOverrides['skillDeepLink']
