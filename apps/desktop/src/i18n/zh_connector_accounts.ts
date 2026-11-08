import type { TranslationOverrides } from './define-locale'

export const zhConnectorAccounts: NonNullable<TranslationOverrides['connectorsPage']>['accounts'] = {
  heading: '账户',
  count: (count: number) => `${count} 个账户`,
  addAnother: '添加另一个账户',
  aliasLabel: '账户名称',
  aliasHint: '小写字母、数字和短横线，最多 32 个字符。例如 work 或 home。',
  aliasInvalid: '请使用小写字母、数字和短横线，并以字母或数字开头。',
  aliasTaken: '该名称已被使用。',
  add: '连接',
  rename: '重命名',
  renameLabel: (name: string) => `${name} 的新名称`,
  renameGone: '该账户已不存在。它已被移除或由重新连接替换。',
  remove: '移除',
  removeTitle: (app: string, name: string) => `移除 ${name} ${app} 账户？`,
  removeBody: 'Hermes 将不再以该账户身份运行。你的其他账户保持连接。',
  retiredCount: (count: number) => `${count} 个已退役`,
  status: {
    expired: '访问已过期',
    failed: '无法连接',
    inactive: '未激活',
    pending: '等待登录',
    retired: '已由重新连接替换',
    revoked: '访问已撤销'
  }
}
