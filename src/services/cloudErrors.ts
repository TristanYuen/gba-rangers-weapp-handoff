export const valueMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.errMsg === 'string') return record.errMsg
    if (typeof record.message === 'string') return record.message
  }
  return ''
}

export const cloudErrorMessage = (error: unknown, fallback = '操作失败，请稍后重试'): string => {
  const message = valueMessage(error).trim()
  const fingerprint = message.toLowerCase()
  if (fingerprint.includes('document.get:fail') || fingerprint.includes('document_not_found') || fingerprint.includes('does not exist')) {
    return '相关数据已不存在，请刷新后重试'
  }
  if (fingerprint.includes('-50400') || fingerprint.includes('timeout') || fingerprint.includes('timed out') || message.includes('响应超时')) {
    return '云端响应超时，请稍后重试'
  }
  if (fingerprint.includes('cloud.callfunction:fail') || fingerprint.includes('callfunction:fail')) {
    return '云端服务暂时不可用，请稍后重试'
  }
  if (fingerprint.includes('network') || fingerprint.includes('request:fail') || fingerprint.includes('socket') || message.includes('网络')) {
    return '网络连接异常，请检查网络后重试'
  }
  if (fingerprint.includes('invalid_cloud_response') || fingerprint.includes('cannot read properties of')) {
    return '云端返回异常，请稍后重试'
  }
  return message || fallback
}

export const cloudUserError = (error: unknown, fallback?: string): Error => new Error(cloudErrorMessage(error, fallback))
