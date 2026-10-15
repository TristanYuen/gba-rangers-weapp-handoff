import { type PropsWithChildren, useCallback, useState } from 'react'
import Taro, { useDidShow, useLaunch } from '@tarojs/taro'
import type { AccessContext, Player } from '@/domain/types'
import { callCloudAction, initCloud } from '@/services/cloudService'
import { localStore } from '@/services/localStore'
import { syncCloudState } from '@/services/cloudStore'
import './app.scss'

function App({ children }: PropsWithChildren) {
  const [, setCloudRevision] = useState(0)
  const guardRoute = useCallback(() => {
    if (__DATA_MODE__ !== 'cloudbase') return
    const pages = Taro.getCurrentPages()
    const page = pages[pages.length - 1]
    const route = page?.route || ''
    const approved = localStore.getAccess().memberStatus === 'approved'
    if (!approved && route && route !== 'pages/account/index') {
      void Taro.reLaunch({ url: '/pages/account/index' })
    }
  }, [])
  const bootstrap = useCallback(async () => {
    if (__DATA_MODE__ !== 'cloudbase') return
    try {
      if (!initCloud()) throw new Error('CloudBase 初始化失败')
      const overview = await callCloudAction<{
        access: Pick<AccessContext, 'role' | 'memberStatus' | 'membershipId' | 'teamId' | 'playerId'>
        player: Player | null
        subscriptionEnabled: boolean
      }>('membership', 'getAccountOverview', {})
      localStore.hydrateFromCloud({
        access: overview.access,
        subscriptionEnabled: overview.subscriptionEnabled
      })
      setCloudRevision((value) => value + 1)
      setTimeout(guardRoute, 0)
      void syncCloudState(localStore)
        .then(() => setCloudRevision((value) => value + 1))
        .catch((error) => console.error('CloudBase background sync failed:', error))
    } catch (error) {
      console.error('CloudBase startup failed:', error)
      void Taro.showToast({
        title: '云端连接异常，已显示本机缓存',
        icon: 'none',
        duration: 3000
      })
      setTimeout(guardRoute, 0)
    }
  }, [guardRoute])
  useLaunch(() => {
    void bootstrap()
  })
  useDidShow(() => {
    guardRoute()
  })
  return children
}

export default App
