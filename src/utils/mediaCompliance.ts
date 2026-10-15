import Taro from '@tarojs/taro'

export const confirmMediaUploadCompliance = async (): Promise<boolean> => {
  const result = await Taro.showModal({
    title: '上传须知',
    content: '请严格遵守相关法律法规。请确认您对上传内容拥有合法权利，已取得相关人员的肖像和隐私授权，内容不得含有违法违规、侵权或其他不宜公开展示的信息。图片上传后将由队长审批，通过后才会公开展示。',
    confirmText: '同意继续',
    cancelText: '取消'
  })
  return result.confirm
}
