import type { Translations } from './types'

export const zhAppTour: Translations['appTour'] = {
  sessions: { title: '你的对话', text: '每个会话都保存在这里。可搜索、置顶或重新打开任意一个。' },
  composer: { title: '在此输入', text: '说出你想完成的事。输入 @ 引入文件。' },
  newSession: { title: '重新开始', text: '新会话拥有独立上下文。每个任务用一个。' },
  model: { title: '模型选择器', text: '选择回答你的模型。' },
  modelLocal: '本机可运行一个本地模型：设置 > 提供方 > 本地模型。',
  capabilities: { title: '能力', text: 'Hermes 可用的技能、工具和插件。可在此添加更多。' },
  messaging: { title: '消息', text: '从 Telegram、Slack、Discord 等平台联系 Hermes。' },
  rightPane: { title: '工作面板', text: '在右侧打开文件、终端、审查和应用内浏览器。' }
}
