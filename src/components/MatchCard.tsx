import Taro from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { matchStatusLabel, scoreLabel } from '@/domain/rules'
import type { MatchPublic } from '@/domain/types'
import { matchDateLabel } from '@/utils/date'

const statusClass = (status: MatchPublic['status']) => status === 'cancelled' ? 'badge--danger' : status === 'published' ? 'badge--success' : status === 'completed_pending_score' ? 'badge--warning' : ''

interface MatchCardProps {
  match: MatchPublic
  showResult?: boolean
  moreAction?: () => void | Promise<void>
}

export const MatchCard = ({ match, showResult = false, moreAction }: MatchCardProps) => (
  <View className='card match-card' onClick={() => Taro.navigateTo({ url: `/pages/matches/detail?id=${match.id}` })}>
    <View className='match-card__top'>
      <Text className='match-card__date'>{matchDateLabel(match.matchDate)}{match.kickoffTime ? ` · ${match.kickoffTime}` : ''}</Text>
      <Text className={`badge ${statusClass(match.status)}`}>{matchStatusLabel(match.status)}</Text>
    </View>
    <Text className='match-card__title'>{match.title}</Text>
    <Text className='match-card__meta'>{match.exactLocation || match.publicArea || '地点待定'} · {match.format === '7-a-side' ? '7 人制' : match.format}</Text>
    {showResult ? <View className='match-card__score'>{scoreLabel(match)}{match.apps ? ` · ${match.apps} 人出场` : ''}</View> : (
      <View className='match-card__action'>
        <Text>{match.status === 'published' ? `${match.registrationCount || 0}/${match.capacity} 人已报名` : matchStatusLabel(match.status)}</Text>
        <Text className='match-card__arrow'>查看详情 ›</Text>
      </View>
    )}
    {moreAction ? <View className='match-card__operation'>
      <Button className='button button--light button--small match-card__more' onClick={(event) => {
        event.stopPropagation()
        void moreAction()
      }}>更多操作</Button>
    </View> : null}
  </View>
)
