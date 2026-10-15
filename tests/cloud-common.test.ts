import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface CommonModule {
  transactionValue(value: unknown): unknown
  normalizeServiceError(error: unknown): { code: string; message: string }
  handleError(event: { requestId: string }, error: unknown): Record<string, unknown>
}

const loadCommon = () => {
  let initOptions: Record<string, unknown> | undefined
  let databaseOptions: Record<string, unknown> | undefined
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init: (options: Record<string, unknown>) => { initOptions = options },
    database: (options: Record<string, unknown>) => {
      databaseOptions = options
      return { command: {}, serverDate: () => 'server-date' }
    },
    getWXContext: () => ({})
  }
  const source = fs.readFileSync(path.resolve('cloudfunctions-src/common.js'), 'utf8')
  const moduleRecord: { exports: Partial<CommonModule> } = { exports: {} }
  const factory = new Function('require', 'module', 'exports', source) as (
    require: (id: string) => unknown,
    module: typeof moduleRecord,
    exports: typeof moduleRecord.exports
  ) => void
  factory((id) => {
    if (id === 'wx-server-sdk') return cloud
    throw new Error(`Unexpected module: ${id}`)
  }, moduleRecord, moduleRecord.exports)
  return { common: moduleRecord.exports as CommonModule, initOptions, databaseOptions }
}

describe('云函数公共数据库配置', () => {
  it('所有云函数都允许读取尚未创建的文档', () => {
    const { initOptions, databaseOptions } = loadCommon()

    expect(initOptions).toMatchObject({ env: 'test-env', throwOnNotFound: false })
    expect(databaseOptions).toEqual({ throwOnNotFound: false })
  })

  it('统一拆包事务结果并隐藏 SDK 底层错误', () => {
    const { common } = loadCommon()

    expect(common.transactionValue({ result: false, errMsg: 'runTransaction:ok' })).toBe(false)
    expect(common.handleError({ requestId: 'request-1' }, { errCode: -1, errMsg: 'document failed' })).toMatchObject({
      ok: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: '云端服务暂时不可用，请稍后重试' },
      requestId: 'request-1'
    })
    expect(common.normalizeServiceError(new Error('document.get:fail document with _id missing does not exist'))).toEqual({
      code: 'RESOURCE_NOT_FOUND',
      message: '相关数据已不存在，请刷新后重试'
    })
    expect(common.normalizeServiceError(Object.assign(new Error('请输入标题'), { code: 'TITLE_REQUIRED' }))).toEqual({
      code: 'TITLE_REQUIRED',
      message: '请输入标题'
    })
  })
})
