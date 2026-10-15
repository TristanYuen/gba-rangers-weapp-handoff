import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { ManagerOperationLog } from '@/domain/types'
import { appService } from '@/services'
import { formatBeijingTime } from '@/utils/date'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

export default function ManagerLogsPage() {
  usePageShare({ title: '大湾区流浪者｜操作记录', path: '/pages/admin/logs' })
  const access = appService.getAccess()
  const [logs, setLogs] = useState<ManagerOperationLog[]>([])

  useDidShow(() => {
    if (!access.canManage) return
    const load = async () => {
      try {
        if (cloudbaseEnabled) await syncCloudState(localStore)
        setLogs(appService.listManagerOperationLogs())
      } catch (error) {
        Taro.showToast({ title: error instanceof Error ? error.message : '操作记录加载失败', icon: 'none' })
      }
    }
    void load()
  })

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>当前身份无权查看管理员操作记录。</View></PageShell>
  }

  return <PageShell>
    <PageHero eyebrow='MANAGERS ONLY' title='管理员操作记录' subtitle='记录长期保留，仅管理层可见。' midnight />
    <View className='content'>
      <View className='card card__body manager-operation-log'>
        {logs.length ? logs.map((log) => <View className='manager-operation-log__item' key={log.id}>
          <View className='manager-operation-log__top'>
            <Text className='manager-operation-log__action'>{log.action}</Text>
            <Text className='manager-operation-log__time'>{formatBeijingTime(log.createdAt, { seconds: true })}</Text>
          </View>
          <Text className='manager-operation-log__summary'>{log.summary}</Text>
          {log.note ? <Text className='manager-operation-log__note'>备注：{log.note}</Text> : null}
          <Text className='manager-operation-log__signature'>操作人：{log.signedBy}</Text>
        </View>) : <View className='empty-state'>
          <Text className='empty-state__title'>暂无管理员操作记录</Text>
        </View>}
      </View>
    </View>
  </PageShell>
}
