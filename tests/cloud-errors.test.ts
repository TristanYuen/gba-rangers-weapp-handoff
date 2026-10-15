import { describe, expect, it } from 'vitest'
import { cloudErrorMessage } from '@/services/cloudErrors'

describe('云端错误提示', () => {
  it('转换云函数调用失败和超时错误', () => {
    expect(cloudErrorMessage(new Error('cloud.callFunction:fail Error: errCode: -50400'))).toBe('云端响应超时，请稍后重试')
    expect(cloudErrorMessage({ errMsg: 'cloud.callFunction:fail system error' })).toBe('云端服务暂时不可用，请稍后重试')
  })

  it('转换文档不存在错误', () => {
    expect(cloudErrorMessage(new Error('document.get:fail document with _id member-1 does not exist'))).toBe('相关数据已不存在，请刷新后重试')
  })

  it('保留服务端返回的业务提示', () => {
    expect(cloudErrorMessage(new Error('请至少选择一名推送对象'))).toBe('请至少选择一名推送对象')
  })
})
