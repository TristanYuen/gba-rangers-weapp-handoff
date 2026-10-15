import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { MatchCard } from '@/components/MatchCard'
import { PageHero } from '@/components/PageHero'
import { SectionHeading } from '@/components/SectionHeading'
import { Segmented } from '@/components/Segmented'
import { TopNav } from '@/components/TopNav'
import { CloudSyncStatus } from '@/components/CloudSyncStatus'
import { appService } from '@/services'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'
import { usePageShare } from '@/hooks/usePageShare'
import type { MatchPublic } from '@/domain/types'
import { consumeNavigationIntent } from '@/services/navigationIntent'
import { PageShell } from '@/components/PageShell'

type Filter = 'signup' | 'history'

export default function MatchesPage() {
  usePageShare({ title: '大湾区流浪者｜赛事', path: '/pages/matches/index' })
  const [filter, setFilter] = useState<Filter>('signup')
  const [, setRefreshKey] = useState(0)
  const { syncError } = useCloudPageRefresh({ onSynced: () => setRefreshKey((value) => value + 1) })
  useDidShow(() => {
    if (consumeNavigationIntent('matches-history')) setFilter('history')
    const page = Taro.getCurrentInstance().page as unknown as ({
      getTabBar?: () => { setData: (data: { selected: number }) => void }
    } | undefined)
    page?.getTabBar?.()?.setData({ selected: 0 })
  })
  const access = appService.getAccess()
  const matches = appService.listMatches().filter((match) => filter === 'signup'
    ? ['published', 'registration_closed'].includes(match.status) || (access.canManage && match.status === 'draft')
    : ['completed', 'completed_pending_score', 'cancelled'].includes(match.status))
  const handleDelete = async (match: MatchPublic) => {
    const result = await Taro.showModal({
      title: '删除历史比赛',
      content: `确认删除“${match.title}”？相关报名、赛后统计和年鉴记录也会移除。`,
      confirmText: '删除',
      confirmColor: '#a42525'
    })
    if (!result.confirm) return
    try {
      await appService.deleteMatch(match.id)
      setRefreshKey((value) => value + 1)
      Taro.showToast({ title: '已删除', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '删除失败', icon: 'none' })
    }
  }
  const openMatchActions = async (match: MatchPublic) => {
    try {
      const result = await Taro.showActionSheet({ itemList: ['删除这场比赛'] })
      if (result.tapIndex === 0) await handleDelete(match)
    } catch {
      // 用户取消操作菜单时保持当前页面状态。
    }
  }
  return (
    <PageShell>
      <TopNav unreadCount={appService.getUnreadNoticeCount()} showNotices={access.memberStatus === 'approved'} />
      <PageHero eyebrow='GBA RANGERS · 2026' title='比赛中心' brand>
        <Button className='button button--ghost button--small' onClick={() => Taro.navigateTo({ url: '/pages/leaderboard/index' })}>排行榜</Button>
        {access.canManage ? <Button className='button button--dark button--small' onClick={() => Taro.navigateTo({ url: '/pages/matches/edit' })}>创建赛事</Button> : null}
      </PageHero>
      <View className='content'>
        <CloudSyncStatus error={syncError} />
        <Segmented value={filter} onChange={setFilter} items={[{ label: '赛事报名', value: 'signup' }, { label: '历史比赛', value: 'history' }]} />
        <SectionHeading eyebrow={filter === 'signup' ? 'UPCOMING' : 'ARCHIVE'} title={filter === 'signup' ? '近期比赛' : '比赛记录'} />
        {access.memberStatus !== 'approved' && filter === 'signup'
          ? <View className='notice notice--warning'><Text className='notice__title'>球队成员专属</Text></View>
          : matches.length
            ? matches.map((match) => <MatchCard
                key={match.id}
                match={match}
                showResult={filter === 'history'}
                moreAction={filter === 'history' && access.canManage ? () => openMatchActions(match) : undefined}
            />)
            : <View className='notice center'>当前没有符合条件的比赛</View>}
      </View>
    </PageShell>
  )
}
