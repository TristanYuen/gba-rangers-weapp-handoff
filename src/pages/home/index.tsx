import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { BrandMark } from '@/components/BrandMark'
import { MatchCard } from '@/components/MatchCard'
import { PlayerCard } from '@/components/PlayerCard'
import { SectionHeading } from '@/components/SectionHeading'
import { StatStrip } from '@/components/StatStrip'
import { CloudSyncStatus } from '@/components/CloudSyncStatus'
import { appService } from '@/services'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'
import { weekdayOf } from '@/utils/date'

export default function HomePage() {
  usePageShare({ title: '大湾区流浪者｜球队首页', path: '/pages/home/index' })
  const { syncError } = useCloudPageRefresh()
  const data = appService.getHome()
  return (
    <PageShell>
      <View className='hero'>
        <BrandMark />
        <Text className='hero__eyebrow'>NEXT MATCH</Text>
        <Text className='hero__title'>{data.nextMatch ? `${data.nextMatch.matchDate.slice(5).replace('-', '.')} ${weekdayOf(data.nextMatch.matchDate)} · ${data.nextMatch.kickoffTime}` : '等待新赛事'}</Text>
        <Text className='hero__subtitle'>{data.nextMatch?.title || 'GBA RANGERS'}{data.nextMatch?.exactLocation ? `\n${data.nextMatch.exactLocation}` : ''}</Text>
        <View className='hero__actions'>
          <Button className='button button--dark' onClick={() => data.nextMatch && Taro.navigateTo({ url: `/pages/matches/detail?id=${data.nextMatch.id}` })}>查看赛事</Button>
          <Button className='button button--ghost' onClick={() => Taro.switchTab({ url: '/pages/account/index' })}>我的球队</Button>
        </View>
      </View>

      <View className='content'>
        <CloudSyncStatus error={syncError} />
        <View className='section'>
          <SectionHeading eyebrow='2026 SEASON' title='年度数字' />
          <View className='card card__body'><StatStrip stats={data.seasonStats} /></View>
        </View>

        <View className='section'>
          <SectionHeading eyebrow='EXPLORE' title='球队档案馆' />
          <View className='grid-2'>
            <View className='card card--dark card__body' onClick={() => Taro.switchTab({ url: '/pages/matches/index' })}>
              <Text className='section-heading__title'>MATCHES</Text>
            </View>
            <View className='card card__body' onClick={() => Taro.navigateTo({ url: '/pages/yearbook/index' })}>
              <Text className='section-heading__title'>GALLERY</Text>
            </View>
          </View>
        </View>

        <View className='section'>
          <SectionHeading eyebrow='LATEST' title='最近赛事' action='全部赛事' onAction={() => Taro.switchTab({ url: '/pages/matches/index' })} />
          {data.latestMatches.map((match) => <MatchCard key={match.id} match={match} />)}
        </View>

        <View className='section'>
          <SectionHeading eyebrow='FIRST TEAM' title='核心球员' action='球员名册' onAction={() => Taro.navigateTo({ url: '/pages/players/index' })} />
          {data.featuredPlayers.slice(0, 3).map((player) => <PlayerCard key={player.id} player={player} />)}
        </View>
      </View>
    </PageShell>
  )
}
