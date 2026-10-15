import { Text, View } from '@tarojs/components'

export const CloudSyncStatus = ({ error }: { error?: string }) => error
  ? <View className='notice notice--warning cloud-sync-status'>
    <Text className='notice__title'>当前显示上次同步结果</Text>
    <Text>{error}。网络恢复后会自动刷新，暂时无法提交修改。</Text>
  </View>
  : null
