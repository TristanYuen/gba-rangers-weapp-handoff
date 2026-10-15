import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { Segmented } from '@/components/Segmented'
import type { LeaderboardMetric } from '@/domain/types'
import { appService } from '@/services'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'

export default function LeaderboardPage() {
  const { syncError } = useCloudPageRefresh()
  usePageShare({ title: '大湾区流浪者｜数据榜单', path: '/pages/leaderboard/index' })
  const [metric, setMetric] = useState<LeaderboardMetric>('apps')
  const rows = appService.getLeaderboard(metric)
  return <PageShell>
    <PageHero eyebrow='2026 SEASON' title='排行榜' />
    <View className='content'>
      {syncError ? <View className='notice notice--danger'>{syncError}</View> : null}
      <Segmented value={metric} onChange={setMetric} items={[{ label: '出场榜', value: 'apps' }, { label: '射手榜', value: 'goals' }, { label: '助攻榜', value: 'assists' }]} />
      <View className='card card__body'>
        {rows.map((row) => <View className='list-row' key={row.playerId}><View className={`rank${row.rank <= 3 ? ' rank--top' : ''}`}>{row.rank}</View><View className='list-row__main'><Text className='list-row__title'>{row.displayName}</Text><Text className='list-row__meta'>{row.apps} APPS · {row.goals} G · {row.assists} A</Text></View><Text className='list-row__value'>{row[metric]}</Text></View>)}
      </View>
      <View className='notice' style={{ marginTop: '18px' }}>同值规则：射手榜和助攻榜优先较少出场，之后按姓名稳定排序。</View>
    </View>
  </PageShell>
}
