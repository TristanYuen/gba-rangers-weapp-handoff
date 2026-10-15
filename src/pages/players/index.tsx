import { useState } from 'react'
import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { PlayerCard } from '@/components/PlayerCard'
import { Segmented } from '@/components/Segmented'
import { appService } from '@/services'
import type { Player } from '@/domain/types'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

type Roster = 'active' | 'alumni'
type PositionGroup = 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | 'unassigned'

const positionGroups: Array<{ key: PositionGroup; label: string; english: string }> = [
  { key: 'forward', label: '前锋', english: 'FORWARDS' },
  { key: 'midfielder', label: '中场', english: 'MIDFIELDERS' },
  { key: 'defender', label: '后卫', english: 'DEFENDERS' },
  { key: 'goalkeeper', label: '门将', english: 'GOALKEEPERS' },
  { key: 'unassigned', label: '未分类', english: 'UNASSIGNED' }
]

const positionGroupOf = (position?: string): PositionGroup => {
  if (position?.includes('门将')) return 'goalkeeper'
  if (position?.includes('后卫')) return 'defender'
  if (position?.includes('中场')) return 'midfielder'
  if (position?.includes('前锋')) return 'forward'
  return 'unassigned'
}

const sortByShirtNumber = (a: Player, b: Player) => {
  if (a.shirtNumber === undefined && b.shirtNumber !== undefined) return 1
  if (a.shirtNumber !== undefined && b.shirtNumber === undefined) return -1
  return (a.shirtNumber ?? 0) - (b.shirtNumber ?? 0) || a.displayName.localeCompare(b.displayName, 'zh-CN')
}

export default function PlayersPage() {
  usePageShare({ title: '大湾区流浪者｜球员名册', path: '/pages/players/index' })
  const [roster, setRoster] = useState<Roster>('active')
  const players = appService.listPlayers().filter((player) => player.status === roster).sort(sortByShirtNumber)
  return <PageShell>
    <PageHero eyebrow='GALLERY / PLAYERS' title='FIRST TEAM' subtitle={`${appService.listPlayers().filter((player) => player.status === 'active').length} 名公开正式球员`}>
      <Button className='button button--dark button--small' onClick={() => Taro.navigateTo({ url: '/pages/leaderboard/index' })}>排行榜</Button>
    </PageHero>
    <View className='content'>
      <Segmented value={roster} onChange={setRoster} items={[{ label: '现役球员', value: 'active' }, { label: '历史成员', value: 'alumni' }]} />
      {players.length ? roster === 'active' ? <View className='position-groups'>
        {positionGroups.map((group) => {
          const groupedPlayers = players.filter((player) => positionGroupOf(player.position) === group.key)
          return <View className='card position-group' key={group.key}>
            <View className='position-group__header'>
              <View><Text className='position-group__english'>{group.english}</Text><Text className='position-group__title'>{group.label}</Text></View>
              <Text className='position-group__count'>{groupedPlayers.length} 人</Text>
            </View>
            {groupedPlayers.length
              ? groupedPlayers.map((player) => <PlayerCard key={player.id} player={player} grouped />)
              : <View className='position-group__empty'>当前暂无{group.label}资料</View>}
          </View>
        })}
      </View> : players.map((player) => player.id === 'p-alumni-lu-huajie'
        ? <View key={player.id} className='card alumni-chairman-card' onClick={() => Taro.navigateTo({ url: `/pages/players/profile?id=${player.id}` })}>
          <View className='alumni-chairman-card__top'>
            <View>
              <Text className='alumni-chairman-card__eyebrow'>CHAIRMAN · HONORARY ARCHIVE</Text>
              <Text className='alumni-chairman-card__name'>卢华杰</Text>
              <Text className='alumni-chairman-card__meta'>董事长 · 2020—2025 年效力</Text>
            </View>
            <Text className='alumni-chairman-card__mark'>董</Text>
          </View>
          <View className='alumni-chairman-card__honors'>
            <Text className='alumni-chairman-card__honors-title'>荣誉档案精选</Text>
            <View className='alumni-chairman-card__honor-list'>
              <Text>俱乐部建设与运营</Text>
              <Text>赛事装备与队务保障</Text>
              <Text>长期资金与资源支持</Text>
            </View>
          </View>
          <View className='alumni-chairman-card__amount'>
            <Text>人民币 197,042.15 元</Text>
            <Text className='alumni-chairman-card__arrow'>查看荣誉档案 ›</Text>
          </View>
        </View>
        : <PlayerCard key={player.id} player={player} />) : <View className='notice center'>当前没有公开成员</View>}
    </View>
  </PageShell>
}
