import type { Translations } from './types'

type ThreadCopy = Translations['assistant']['thread']

// The error card's layer fallbacks (lib/error-surface-copy.ts): used when a failure code has no own entry.
// Partial like the rest of this locale: an untranslated layer falls back to English.
export const zhErrorLayers: {
  [K in 'errorLayerBodies' | 'errorLayers']: Partial<ThreadCopy[K]>
} = {
  errorLayers: {
    auth: '认证错误',
    billing: '额度不足',
    disk: '磁盘已满',
    endpoint: '自定义端点错误',
    gateway: '无法发送你的消息',
    generic: '本轮失败',
    provider: '模型服务商错误',
    runtime: '本地运行时错误',
    streaming: '流式连接错误'
  },
  errorLayerBodies: {
    generic: 'Hermes 回复时出现问题。请重试；若问题持续，请复制错误详情。',
    provider: 'AI 服务无法完成此请求。请稍后重试或切换服务商。',
    endpoint: 'Hermes 无法连接到你的自定义模型服务器。请确认它正在运行，然后重新发送消息。',
    streaming: '回复完成前连接已断开。请重试以重新发送。',
    auth: 'AI 服务拒绝了你的登录。请检查此提供方的凭据，然后重新发送消息。',
    billing: '你的账户在此提供方已没有余额。请充值或切换提供方，然后重新发送。',
    disk: '磁盘已满，Hermes 无法保存此对话。请释放空间后重试。',
    gateway:
      'Hermes 在开始此回复时遇到内部问题。请重新发送消息；若持续发生，请发送诊断。',
    runtime:
      'Hermes 在开始此回复时遇到内部问题。请重新发送消息；若持续发生，请发送诊断。'
  }
}
