import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { PlayerAvatar } from './PlayerAvatar'
import type { Player } from '@/domain/types'

export const PlayerCard = ({ player, grouped = false }: { player: Player; grouped?: boolean }) => (
  <View className={`${grouped ? 'player-card player-card--grouped' : 'card player-card'}`} onClick={() => Taro.navigateTo({ url: `/pages/players/profile?id=${player.id}` })}>
    <PlayerAvatar player={player} />
    <View className='player-card__main'>
      <Text className='player-card__name'>{player.displayName} · {player.shirtNumber !== undefined ? `${player.shirtNumber} 号` : '号码—'}</Text>
      <Text className='player-card__meta'>{player.position || '未分类'} · {player.joinYear ? `${player.joinYear} 年入队 · ` : ''}{player.stats.apps} APPS · {player.stats.goals} G · {player.stats.assists} A</Text>
    </View>
    <Text className='player-card__arrow'>›</Text>
  </View>
)
