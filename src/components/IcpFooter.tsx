import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

const ICP_NUMBER = '粤ICP备2026117621号'
const ICP_QUERY_URL = 'https://beian.miit.gov.cn/'

export const IcpFooter = () => {
  const copyQueryUrl = async () => {
    try {
      await Taro.setClipboardData({ data: ICP_QUERY_URL })
      Taro.showToast({ title: '备案查询网址已复制，请在浏览器打开', icon: 'none', duration: 2500 })
    } catch {
      Taro.showToast({ title: '备案查询网址复制失败，请稍后重试', icon: 'none' })
    }
  }

  return <View className='icp-footer' onClick={() => void copyQueryUrl()}>
    <Text className='icp-footer__link'>{ICP_NUMBER}</Text>
  </View>
}
