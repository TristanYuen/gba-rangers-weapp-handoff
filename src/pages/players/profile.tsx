import Taro, { useRouter } from '@tarojs/taro'
import { Button, View, Text } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { StatStrip } from '@/components/StatStrip'
import { MatchCard } from '@/components/MatchCard'
import { SectionHeading } from '@/components/SectionHeading'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { appService } from '@/services'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'

const chairmanHonors = [
  {
    marker: '2020—2025',
    title: '俱乐部建设与运营',
    description: '担任董事长期间，持续推动球队日常运营、赛事组织与成员保障。'
  },
  {
    marker: 'special-amount',
    title: '俱乐部专项投入',
    description: '支持比赛球衣、训练背心、出行套装、文化衫等队务物资建设。'
  },
  {
    marker: '197,042.15 元',
    title: '累计资金与资源支持',
    description: '以长期、持续的资金和资源投入，为俱乐部及成员发展提供保障。'
  }
]

export default function PlayerProfilePage() {
  const { params } = useRouter()
  const playerId = params.id || 'p-li-xiang'
  usePageShare({ title: '大湾区流浪者｜球员资料', path: `/pages/players/profile?id=${playerId}` })
  useCloudPageRefresh()
  const player = appService.getPlayer(params.id || 'p-li-xiang')
  const access = appService.getAccess()
  const isChairmanAlumni = player.id === 'p-alumni-lu-huajie'
  const feeProfile = !isChairmanAlumni && appService.canViewPlayerFee(player.id) ? appService.getPlayerFeeProfile(player.id) : null
  const matches = appService.listMatches().filter((match) => match.status.startsWith('completed')).slice(0, 3)
  const serviceYears = player.leaveYear
    ? `${player.joinYear || '—'}—${player.leaveYear} 年效力`
    : `自 ${player.joinYear || '—'} 年效力`
  const legacyAmount = player.legacyAmount?.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const legacySpecialAmount = player.legacySpecialAmount?.toLocaleString('zh-CN') || '—'
  return <PageShell>
    <PageHero eyebrow={isChairmanAlumni ? 'CHAIRMAN · HONORARY ARCHIVE' : player.status === 'active' ? 'FIRST TEAM' : 'ALUMNI'} title={player.displayName} subtitle={`${player.shirtNumber ? `#${player.shirtNumber} · ` : ''}${player.position || '位置待补'}\n${serviceYears}`} midnight>
      {access.canManage ? <Button className='button button--ghost button--small' onClick={() => Taro.navigateTo({ url: `/pages/players/edit?id=${player.id}` })}>编辑球员资料</Button> : null}
    </PageHero>
    <View className='content stack'>
      <View className={`card player-profile__identity${isChairmanAlumni ? ' player-profile__identity--chairman' : ''}`}>
        <PlayerAvatar player={player} className='player-profile__avatar' fallback={player.shirtNumber ?? player.displayName.slice(0, 1)} />
        <View>
          <Text className='player-profile__name'>{player.displayName}</Text>
          <Text className='player-profile__meta'>{player.shirtNumber ? `${player.shirtNumber} 号 · ` : ''}{player.position || '资料待补'}{isChairmanAlumni ? ' · 荣誉档案' : ''}</Text>
        </View>
      </View>
      {isChairmanAlumni ? <View className='card chairman-legacy'>
        <Text className='chairman-legacy__eyebrow'>LEGACY AMOUNT</Text>
        <Text className='chairman-legacy__label'>金额</Text>
        <View className='chairman-legacy__amount-row'>
          <Text className='chairman-legacy__currency'>人民币</Text>
          <Text className='chairman-legacy__amount'>{legacyAmount}</Text>
          <Text className='chairman-legacy__unit'>元</Text>
        </View>
        <Text className='chairman-legacy__uppercase'>人民币大写：壹拾玖万柒仟零肆拾贰元壹角伍分</Text>
        <Text className='chairman-legacy__service'>董事长 · 2020—2025 年效力</Text>
        <View className='chairman-honors'>
          <View className='chairman-honors__heading'>
            <Text className='chairman-honors__eyebrow'>HONORARY RECORD</Text>
            <Text className='chairman-honors__title'>荣誉档案</Text>
          </View>
          {chairmanHonors.map((honor) => <View className='chairman-honors__item' key={honor.marker}>
            <Text className='chairman-honors__marker'>{honor.marker === 'special-amount' ? `${legacySpecialAmount} 元` : honor.marker}</Text>
            <View className='chairman-honors__content'>
              <Text className='chairman-honors__item-title'>{honor.title}</Text>
              <Text className='chairman-honors__description'>{honor.description}</Text>
            </View>
          </View>)}
        </View>
      </View> : <View className='card card__body'><SectionHeading eyebrow='2026 / CAREER' title='球员数据' /><StatStrip stats={player.stats} /></View>}
      <View className='card card__body'>
        <SectionHeading title='公开资料' />
        <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>成员状态</Text></View><Text className='list-row__value'>{player.status === 'active' ? '现役' : '历史成员'}</Text></View>
        <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>公开照片</Text></View><Text className='list-row__value'>{player.showPhotos ? '已授权' : '已隐藏'}</Text></View>
      </View>
      {feeProfile ? <View className='card card__body fee-profile'>
        <SectionHeading eyebrow='MEMBERS ONLY' title='会费信息' />
        <View className='fee-profile__hero'>
          <View><Text className='fee-profile__plan'>{feeProfile.billedPlan.name}</Text><Text className='fee-profile__period'>{feeProfile.period.replace('-', ' 年 ')} 月执行标准</Text></View>
          <View className='fee-profile__amount'><Text>¥{feeProfile.amountDue}</Text><Text className='fee-profile__unit'>／月</Text></View>
        </View>
        {feeProfile.holidayAdjusted ? <View className='notice notice--warning'><Text className='notice__title'>寒暑假档次已自动调整</Text></View> : null}
        <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>基础会费类型</Text></View><Text className='list-row__value'>{feeProfile.basePlan.name}</Text></View>
        <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>生效时间</Text></View><Text className='list-row__value'>{feeProfile.activeAssignment.effectiveFrom}</Text></View>
        {feeProfile.activeAssignment.effectiveTo ? <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>结束时间</Text></View><Text className='list-row__value'>{feeProfile.activeAssignment.effectiveTo}</Text></View> : null}
        <View className='fee-profile__reason'><Text className='field__label'>当前档次说明</Text><Text>{feeProfile.activeAssignment.reason}</Text></View>
        <View className='fee-history'>
          <Text className='fee-history__title'>最近调整记录</Text>
          {feeProfile.history.slice(0, 3).map((assignment) => {
            const plan = appService.getFeePlans().find((item) => item.id === assignment.feePlanId)
            return <View className='fee-history__item' key={assignment.id}><View><Text className='fee-history__plan'>{plan?.name || assignment.feePlanId}</Text><Text className='fee-history__meta'>{assignment.effectiveFrom}{assignment.effectiveTo ? ` 至 ${assignment.effectiveTo}` : ' 起'} · {assignment.adjustedBy}</Text></View><Text className='fee-history__reason'>{assignment.reason}</Text></View>
          })}
        </View>
      </View> : null}
      <View><SectionHeading eyebrow='MATCH HISTORY' title='相关赛事' />{matches.map((match) => <MatchCard key={match.id} match={match} />)}</View>
    </View>
  </PageShell>
}
