import { Image, Text, View } from '@tarojs/components'
import type { Player } from '@/domain/types'
import { playerAvatarFallback } from '@/utils/playerAvatar'

interface PlayerAvatarProps {
  player: Player
  className?: string
  fallback?: string | number
}

export const PlayerAvatar = ({
  player,
  className = 'avatar',
  fallback = playerAvatarFallback(player.displayName)
}: PlayerAvatarProps) => player.showAvatar && player.avatarUrl
  ? <Image className={className} src={player.avatarUrl} mode='aspectFill' />
  : <View className={className}><Text>{fallback}</Text></View>
