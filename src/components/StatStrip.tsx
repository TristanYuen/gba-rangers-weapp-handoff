import { View, Text } from '@tarojs/components'
import type { PlayerStats } from '@/domain/types'

export const StatStrip = ({ stats, dark = false }: { stats: PlayerStats; dark?: boolean }) => (
  <View className='stat-strip'>
    {([['apps', 'APPS'], ['goals', 'GOALS'], ['assists', 'ASSISTS']] as const).map(([key, label]) => (
      <View className={`stat${dark ? ' stat--dark' : ''}`} key={key}>
        <Text className='stat__value'>{stats[key]}</Text>
        <Text className='stat__label'>{label}</Text>
      </View>
    ))}
  </View>
)
