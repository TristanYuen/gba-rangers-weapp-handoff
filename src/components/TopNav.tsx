import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'

export const TopNav = ({ unreadCount = 0, showNotices = false }: { unreadCount?: number; showNotices?: boolean }) => {
  const statusBarHeight = Taro.getWindowInfo().statusBarHeight || 20
  return <View className='top-nav' style={{ paddingTop: `${statusBarHeight}px`, height: `${statusBarHeight + 44}px` }}>
    <View className='top-nav__bar'>
      {showNotices ? <View className='top-nav__notices' aria-label={`球队通知，${unreadCount}条未读`} onClick={() => Taro.navigateTo({ url: '/pages/notices/index' })}>
        <Text>通知</Text>
        {unreadCount > 0 ? <Text className='top-nav__notice-count'>{unreadCount > 99 ? '99+' : unreadCount}</Text> : null}
      </View> : null}
      <Text className='top-nav__title'>大湾区流浪者</Text>
    </View>
  </View>
}
