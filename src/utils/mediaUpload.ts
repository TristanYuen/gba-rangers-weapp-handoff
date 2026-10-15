import Taro from '@tarojs/taro'
import { cloudErrorMessage, valueMessage } from '@/services/cloudErrors'

export const isMediaCancel = (error: unknown): boolean =>
  /\b(cancel|canceled|cancelled)\b/i.test(valueMessage(error))

export const mediaErrorMessage = (error: unknown, fallback = '图片提交失败，请稍后重试'): string => {
  const message = valueMessage(error)
  if (isMediaCancel(error)) return '已取消选择'
  if (/authorize|auth deny|permission|access denied/i.test(message)) return '图片访问未获授权，请检查微信权限'
  if (/chooseMedia:fail/i.test(message)) return '选图失败，请稍后重试'
  return cloudErrorMessage(error, fallback)
}

// 压缩属于优化步骤；设备不支持时仍可提交原图。
export const compressMediaImage = async (source: string): Promise<string> => {
  try {
    const result = await Taro.compressImage({ src: source, quality: 82 })
    return result.tempFilePath || source
  } catch {
    return source
  }
}

export const uploadMediaBatch = async (
  paths: string[],
  submit: (path: string) => unknown | Promise<unknown>,
  onSaved: () => void
) => {
  let saved = 0
  const failures: Array<{ index: number; message: string }> = []
  for (const [index, source] of paths.entries()) {
    try {
      await submit(await compressMediaImage(source))
      saved += 1
    } catch (error) {
      failures.push({ index: index + 1, message: mediaErrorMessage(error) })
      console.error('图片提交失败', { index: index + 1, message: valueMessage(error) })
      continue
    }
    onSaved()
  }
  return { saved, failures }
}
