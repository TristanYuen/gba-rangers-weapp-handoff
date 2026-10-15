import Taro from '@tarojs/taro'
import type { ApiResult } from '@/domain/types'
import { cloudErrorMessage, cloudUserError } from './cloudErrors'

interface CloudApi {
  init(options: { env: string; traceUser?: boolean }): void
  callFunction<T>(options: { name: string; data: unknown }): Promise<{ result: ApiResult<T> }>
  uploadFile(options: { cloudPath: string; filePath: string }): Promise<{ fileID: string }>
}

const cloud = (Taro as unknown as { cloud?: CloudApi }).cloud
export const cloudbaseEnvironmentId = __CLOUDBASE_ENV_ID__
export const cloudbaseEnabled = __DATA_MODE__ === 'cloudbase'
const CLOUD_CALL_TIMEOUT_MS = 15000
const normalizeCloudValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeCloudValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('$date' in record) return new Date(record.$date as string | number).toISOString()
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, normalizeCloudValue(item)]))
  }
  return value
}

export const initCloud = () => {
  if (!cloudbaseEnabled || !cloud || !cloudbaseEnvironmentId) return false
  cloud.init({ env: cloudbaseEnvironmentId, traceUser: true })
  return true
}

export const callCloudAction = async <T>(functionName: string, action: string, payload: unknown): Promise<T> => {
  if (!cloudbaseEnabled || !cloud || !cloudbaseEnvironmentId) throw new Error('CloudBase 尚未配置，请继续使用本地模式')
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('云端响应超时，请稍后重试')), CLOUD_CALL_TIMEOUT_MS)
    })
    const response = await Promise.race([
      cloud.callFunction<T>({ name: functionName, data: { action, payload, requestId: `${Date.now()}` } }),
      timeout
    ])
    if (!response?.result || typeof response.result.ok !== 'boolean') throw new Error('INVALID_CLOUD_RESPONSE')
    if (!response.result.ok) {
      const error = new Error(cloudErrorMessage(response.result.error.message)) as Error & { code?: string }
      if (typeof response.result.error.code === 'string') error.code = response.result.error.code
      throw error
    }
    return normalizeCloudValue(response.result.data) as T
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
    const userError = cloudUserError(error) as Error & { code?: string }
    if (code) userError.code = code
    throw userError
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export const uploadCloudFile = async (filePath: string, cloudPath: string): Promise<string> => {
  if (!cloudbaseEnabled || !cloud || !cloudbaseEnvironmentId) throw new Error('CloudBase 尚未配置，请继续使用本地模式')
  try {
    const response = await cloud.uploadFile({ cloudPath, filePath })
    if (!response.fileID) throw new Error('文件上传失败，请稍后重试')
    return response.fileID
  } catch (error) {
    throw cloudUserError(error, '文件上传失败，请稍后重试')
  }
}
