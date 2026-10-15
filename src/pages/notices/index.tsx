import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button, Input, Picker, Textarea } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { Segmented } from '@/components/Segmented'
import type { NotificationType, Player, TeamNotice } from '@/domain/types'
import { appService } from '@/services'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { beijingDate, beijingPeriod, formatBeijingTime } from '@/utils/date'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

type Tab = 'records' | 'publish'

const typeLabels: Record<NotificationType, string> = {
  match_signup: '赛事报名',
  signup_activity: '报名动态',
  fee_due: '会费催收',
  pending_confirmation: '待定确认'
}

const publishTypeOptions: Array<{ value: NotificationType; label: string }> = [
  { value: 'match_signup', label: '赛事报名' },
  { value: 'signup_activity', label: '报名动态' },
  { value: 'fee_due', label: '会费催收' },
  { value: 'pending_confirmation', label: '待定确认' }
]

const noticeTemplates: Record<NotificationType, { title: string; content: string }> = {
  match_signup: { title: '赛事报名提醒', content: '请及时确认本场比赛的参加状态。' },
  signup_activity: { title: '报名动态提醒', content: '本场比赛的报名情况已有更新，请及时查看。' },
  fee_due: {
    title: '会费缴纳提醒',
    content: '你好，{姓名}。你在 {月份} 的会费 ¥{金额} 尚未缴纳，请尽快完成缴费。'
  },
  pending_confirmation: { title: '请确认待定状态', content: '你的报名仍为待定，请及时确认是否参加。' }
}

const currentPeriod = () => beijingPeriod()

const personalize = (template: string, player: Player, period: string, amount?: number) =>
  template
    .split('{姓名}').join(player.displayName)
    .split('{月份}').join(period)
    .split('{金额}').join(String(amount ?? 0))

const deliveryLabel = {
  delivered: '已送达',
  sent: '已送达',
  processing: '发送中',
  retrying: '重试中',
  pending: '发送中',
  failed: '发送失败',
  unavailable: '未订阅'
} as const

export default function NoticesPage() {
  usePageShare({ title: '大湾区流浪者｜球队通知', path: '/pages/notices/index' })
  const access = appService.getAccess()
  const [tab, setTab] = useState<Tab>('records')
  const [notices, setNotices] = useState<TeamNotice[]>(access.memberStatus === 'approved' ? appService.listNotices() : [])
  const [type, setType] = useState<NotificationType>('match_signup')
  const [matchIndex, setMatchIndex] = useState(0)
  const [title, setTitle] = useState(noticeTemplates.match_signup.title)
  const [content, setContent] = useState(noticeTemplates.match_signup.content)
  const [dueDate, setDueDate] = useState(beijingDate())
  const [feePeriod, setFeePeriod] = useState(currentPeriod())
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])
  const [expandedDeliveryId, setExpandedDeliveryId] = useState('')
  const [, setRefreshKey] = useState(0)

  useDidShow(() => {
    if (access.memberStatus !== 'approved') return
    const load = async () => {
      try {
        if (cloudbaseEnabled) await syncCloudState(localStore)
        const currentNotices = appService.listNotices()
        setNotices(currentNotices)
        if (access.playerId) {
          for (const notice of currentNotices) {
            if (!notice.readBy.includes(access.playerId)) await appService.markNoticeRead(notice.id)
          }
          setNotices(appService.listNotices())
        }
        setRefreshKey((value) => value + 1)
      } catch (error) {
        Taro.showToast({ title: error instanceof Error ? error.message : '通知数据加载失败', icon: 'none' })
      }
    }
    void load()
  })

  if (access.memberStatus !== 'approved') {
    return <PageShell className='content'><View className='notice notice--warning'>加入球队并通过审核后可查看球队通知。</View></PageShell>
  }

  const matches = appService.listMatches().filter((match) => ['published', 'registration_closed'].includes(match.status))
  const activePlayers = access.canManage ? appService.listPlayers(true).filter((player) => player.status === 'active') : []
  const boundPlayerIds = new Set(access.canManage ? appService.listTeamRoles().map((assignment) => assignment.playerId) : [])
  const selectablePlayers = cloudbaseEnabled
    ? activePlayers.filter((player) => boundPlayerIds.has(player.id))
    : activePlayers
  const feeProfiles = access.canManage ? appService.listPlayerFeeProfiles(feePeriod) : []
  const feePayments = access.canManage ? appService.listFeePayments(feePeriod) : []
  const unpaidProfiles = feeProfiles.filter((profile) =>
    profile.amountDue > 0 &&
    feePayments.find((payment) => payment.playerId === profile.playerId)?.status !== 'paid' &&
    selectablePlayers.some((player) => player.id === profile.playerId)
  )
  const targetPlayers = type === 'fee_due'
    ? unpaidProfiles.map((profile) => profile.player)
    : selectablePlayers

  const lastReminderAt = (playerId: string) => notices
    .filter((notice) =>
      notice.type === 'fee_due' &&
      notice.feePeriod === feePeriod &&
      (notice.targetPlayerIds?.includes(playerId) || notice.targetPlayerId === playerId)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt

  const selectType = (index: number) => {
    const next = publishTypeOptions[index]?.value || 'match_signup'
    const template = noticeTemplates[next]
    setType(next)
    setTitle(template.title)
    setContent(template.content)
    setSelectedPlayerIds([])
  }

  const changeFeePeriod = (period: string) => {
    setFeePeriod(period)
    setSelectedPlayerIds([])
  }

  const togglePlayer = (playerId: string) => {
    setSelectedPlayerIds((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId]
    )
  }

  const selectAll = () => setSelectedPlayerIds(targetPlayers.map((player) => player.id))
  const clearAll = () => setSelectedPlayerIds([])

  const publish = async () => {
    if (!selectedPlayerIds.length) {
      Taro.showToast({ title: '请至少选择一名推送对象', icon: 'none' })
      return
    }
    try {
      const match = matches[matchIndex]
      const recipientDetails = selectedPlayerIds.map((playerId) => {
        const player = selectablePlayers.find((item) => item.id === playerId)!
        const amount = type === 'fee_due'
          ? unpaidProfiles.find((profile) => profile.playerId === playerId)?.amountDue
          : undefined
        return {
          playerId,
          displayName: player.displayName,
          feeAmount: amount,
          content: personalize(content, player, feePeriod, amount)
        }
      })
      const notice = await appService.createNotice({
        type,
        title,
        content,
        audience: 'individual',
        matchId: type === 'fee_due' ? undefined : match?.id,
        targetPlayerIds: selectedPlayerIds,
        feePeriod: type === 'fee_due' ? feePeriod : undefined,
        recipientDetails,
        dueAt: `${dueDate}T20:00:00+08:00`
      })
      setNotices((current) => [notice, ...current.filter((item) => item.id !== notice.id)])
      setSelectedPlayerIds([])
      setTab('records')
      Taro.showToast({ title: type === 'fee_due' ? '催收通知已发送' : '通知已发布', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '发布失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='TEAM SIGNAL' title='球队通知' />
    <View className='content'>
      {access.canManage ? <Segmented
        value={tab}
        onChange={setTab}
        items={[{ label: '发布通知', value: 'publish' }, { label: '发送记录', value: 'records' }]}
      /> : null}
      {tab === 'records' ? <View className='stack'>
        {notices.map((notice) => {
          const targetCount = notice.targetPlayerIds?.length ?? notice.delivery.total
          const deliveryExpanded = expandedDeliveryId === notice.id
          const unread = Boolean(access.playerId && !notice.readBy.includes(access.playerId))
          return <View className='card notice-card' key={notice.id}>
            <View className='notice-card__top'>
              <View className='notice-card__type-row'><Text className='badge'>{typeLabels[notice.type]}</Text>{unread ? <Text className='notice-card__unread'>未读</Text> : null}</View>
              <Text className='notice-card__time'>{formatBeijingTime(notice.createdAt, { short: true })}</Text>
            </View>
            <Text className='notice-card__title'>{notice.title}</Text>
            <Text className='notice-card__content'>{notice.content}</Text>
            <View className='notice-card__footer'>
              <Text>{notice.createdBy}发布 · {targetCount} 人</Text>
            </View>
            {access.canManage && notice.recipientDetails?.length ? <>
              <View className='notice-record-toggle' onClick={() => setExpandedDeliveryId(deliveryExpanded ? '' : notice.id)}>
                <Text>送达 {notice.delivery.delivered}/{notice.delivery.total} · {deliveryExpanded ? '收起发送明细' : '查看发送明细'}</Text>
                <Text>{deliveryExpanded ? '⌃' : '⌄'}</Text>
              </View>
              {deliveryExpanded ? <View className='notice-recipient-list'>
                {notice.recipientDetails.map((detail) => <View className='notice-recipient' key={detail.playerId}>
                  <View className='notice-recipient__main'>
                    <Text className='notice-recipient__name'>{detail.displayName}</Text>
                    {notice.type === 'fee_due' && notice.feePeriod && typeof detail.feeAmount === 'number' && Number.isFinite(detail.feeAmount)
                      ? <Text className='notice-recipient__meta'>{notice.feePeriod} · ¥{detail.feeAmount}</Text>
                      : null}
                    <Text className='notice-recipient__content'>{detail.content}</Text>
                  </View>
                  <Text className={`badge ${['delivered', 'sent'].includes(detail.deliveryStatus || '') ? 'badge--success' : 'badge--warning'}`}>
                    {detail.deliveryStatus ? deliveryLabel[detail.deliveryStatus] : '发送中'}
                  </Text>
                </View>)}
              </View> : null}
            </> : null}
          </View>
        })}
      </View> : <View className='card form-card notice-form'>
        <View className='field'>
          <Text className='field__label'>通知类型</Text>
          <Picker
            mode='selector'
            range={publishTypeOptions.map((item) => item.label)}
            value={Math.max(0, publishTypeOptions.findIndex((item) => item.value === type))}
            onChange={(event) => selectType(Number(event.detail.value))}
          >
            <View className='picker-value picker-value--full'>{typeLabels[type]}</View>
          </Picker>
        </View>
        {type !== 'fee_due' ? <View className='field'>
          <Text className='field__label'>关联比赛</Text>
          <Picker mode='selector' range={matches.map((match) => match.title)} value={matchIndex} onChange={(event) => setMatchIndex(Number(event.detail.value))}>
            <View className='picker-value picker-value--full'>{matches[matchIndex]?.title || '暂无可选比赛'}</View>
          </Picker>
        </View> : <View className='field'>
          <Text className='field__label'>欠费月份</Text>
          <Picker mode='date' fields='month' value={feePeriod} onChange={(event) => changeFeePeriod(event.detail.value)}>
            <View className='picker-value picker-value--full'>{feePeriod.replace('-', ' 年 ')} 月</View>
          </Picker>
        </View>}

        <View className='field notice-targets'>
          <View className='notice-targets__header'>
            <View>
              <Text className='field__label'>推送目标</Text>
              <Text className='notice-targets__count'>已选 {selectedPlayerIds.length}／{targetPlayers.length} 人</Text>
            </View>
            <View className='notice-targets__actions'>
              <Text onClick={selectAll}>全选</Text>
              <Text onClick={clearAll}>全不选</Text>
            </View>
          </View>
          {type === 'fee_due' ? <Text className='field__helper'>已同步 {feePeriod} 的未缴名单，可手动选择本次催收对象。</Text> : null}
          <View className='notice-target-list'>
            {targetPlayers.map((player) => {
              const selected = selectedPlayerIds.includes(player.id)
              const profile = type === 'fee_due'
                ? unpaidProfiles.find((item) => item.playerId === player.id)
                : undefined
              const remindedAt = type === 'fee_due' ? lastReminderAt(player.id) : undefined
              return <View
                className={`notice-target ${selected ? 'notice-target--selected' : ''}`}
                key={player.id}
                onClick={() => togglePlayer(player.id)}
              >
                <View className='notice-target__check'>{selected ? '✓' : ''}</View>
                <View className='notice-target__main'>
                  <Text className='notice-target__name'>{player.displayName}</Text>
                  {profile ? <Text className='notice-target__meta'>未缴 ¥{profile.amountDue}{remindedAt ? ` · 上次催收 ${formatBeijingTime(remindedAt, { short: true })}` : ' · 尚未催收'}</Text> : null}
                </View>
              </View>
            })}
            {!targetPlayers.length ? <View className='empty-state'>
              <Text className='empty-state__title'>{type === 'fee_due' ? '该月没有未缴成员' : '暂无可推送成员'}</Text>
            </View> : null}
          </View>
        </View>

        <View className='field'>
          <Text className='field__label'>截止日期</Text>
          <Picker mode='date' value={dueDate} onChange={(event) => setDueDate(event.detail.value)}>
            <View className='picker-value picker-value--full'>{dueDate}</View>
          </Picker>
        </View>
        <View className='field'>
          <Text className='field__label'>标题</Text>
          <Input className='field__input' value={title} onInput={(event) => setTitle(event.detail.value)} />
        </View>
        <View className='field'>
          <Text className='field__label'>通知内容</Text>
          <Textarea className='field__textarea' value={content} onInput={(event) => setContent(event.detail.value)} />
          {type === 'fee_due' ? <Text className='notice-template-hint'>支持变量：&#123;姓名&#125;、&#123;月份&#125;、&#123;金额&#125;</Text> : null}
        </View>
        <Button className='button button--primary' disabled={!selectedPlayerIds.length} onClick={publish}>
          {selectedPlayerIds.length ? `发送给 ${selectedPlayerIds.length} 人` : '请先选择推送对象'}
        </Button>
      </View>}
    </View>
  </PageShell>
}
