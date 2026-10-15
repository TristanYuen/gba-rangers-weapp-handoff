import { useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { View, Text, Button, Input, Picker } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { CloudSyncStatus } from '@/components/CloudSyncStatus'
import type { Signup, SignupChoice, SignupType } from '@/domain/types'
import { appService } from '@/services'
import { beijingDate, formatBeijingTime } from '@/utils/date'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

type ManagerFilter = 'all' | 'attending' | 'maybe' | 'absent' | 'pending_approval'

const choiceLabel = (signup: Signup) => {
  if (signup.approvalStatus === 'pending') return '待审核'
  if (signup.approvalStatus === 'rejected') return '审核未通过'
  if (signup.choice === 'attending') return signup.placement === 'waitlisted' ? '候补' : '参加'
  if (signup.choice === 'maybe') return '待定'
  return '缺席'
}

const signupTypeLabel = (signup: Signup) => {
  if (signup.signupType === 'trial_companion') return `带人试训${signup.companionName ? `：${signup.companionName}` : ''}`
  if (signup.signupType === 'guest_companion') return `带人凑脚${signup.companionName ? `：${signup.companionName}` : ''}`
  return '正式球员'
}

export default function SignupPage() {
  const { params } = useRouter()
  const id = params.id || 'm-next'
  usePageShare({ title: '大湾区流浪者｜赛事报名', path: `/pages/matches/signup?id=${id}` })
  const access = appService.getAccess()
  const match = appService.getMatch(id)
  const initialSignups = access.memberStatus === 'approved' ? appService.getSignups(id) : []
  const currentSignup = initialSignups.find((signup) => signup.playerId === (access.playerId || 'p-huang'))
  const [choice, setChoice] = useState<SignupChoice>(currentSignup?.choice || 'attending')
  const [signupType, setSignupType] = useState<SignupType>(currentSignup?.signupType || 'self')
  const [companionName, setCompanionName] = useState(currentSignup?.companionName || '')
  const [pendingDate, setPendingDate] = useState(currentSignup?.pendingUntil?.slice(0, 10) || match.matchDate)
  const [pendingTime, setPendingTime] = useState(currentSignup?.pendingUntil?.slice(11, 16) || '18:00')
  const [note, setNote] = useState(currentSignup?.note || '')
  const [signups, setSignups] = useState(initialSignups)
  const [managerFilter, setManagerFilter] = useState<ManagerFilter>('all')
  const { syncError } = useCloudPageRefresh({
    onSynced: () => {
      if (appService.getAccess().memberStatus === 'approved') setSignups(appService.getSignups(id))
    }
  })
  const players = appService.listPlayers(true)

  const summary = useMemo(() => ({
    attending: signups.filter((item) => item.choice === 'attending' && item.placement === 'confirmed').length,
    waitlisted: signups.filter((item) => item.placement === 'waitlisted').length,
    maybe: signups.filter((item) => item.choice === 'maybe').length,
    absent: signups.filter((item) => item.choice === 'absent').length,
    pendingApproval: signups.filter((item) => item.approvalStatus === 'pending').length
  }), [signups])

  const filteredSignups = signups.filter((signup) => {
    if (managerFilter === 'all') return true
    if (managerFilter === 'pending_approval') return signup.approvalStatus === 'pending'
    return signup.choice === managerFilter
  })

  const submit = async () => {
    try {
      const pendingUntil = choice === 'maybe' ? `${pendingDate}T${pendingTime}:00+08:00` : undefined
      setSignups(await appService.updateSignup(id, access.playerId || 'p-huang', choice, pendingUntil, note, signupType, companionName))
      Taro.showToast({ title: signupType === 'self' ? '报名状态已更新' : '申请已提交审核', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '报名失败', icon: 'none' })
    }
  }

  const review = async (signupId: string, approved: boolean) => {
    try {
      setSignups(await appService.reviewSpecialSignup(signupId, approved))
      Taro.showToast({ title: approved ? '报名已通过' : '报名已拒绝', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '审核失败', icon: 'none' })
    }
  }

  const remind = async (playerId: string) => {
    try {
      await appService.remindPendingSignup(id, playerId)
      Taro.showToast({ title: '提醒已发送', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '提醒失败', icon: 'none' })
    }
  }

  const copy = async () => {
    await Taro.setClipboardData({ data: appService.rosterText(id) })
    Taro.showToast({ title: '名单已复制', icon: 'success' })
  }

  return (
    <PageShell>
      <PageHero
        eyebrow={access.canManage ? 'TEAM MANAGEMENT' : 'MEMBERS ONLY'}
        title={access.canManage ? '报名管理' : '赛事报名'}
        subtitle={`${match.title}\n${match.capacityEnabled === false ? '本场不限人数' : `上限 ${match.capacity} 人`}`}
      />
      <View className='content stack'>
        <CloudSyncStatus error={syncError} />
        {access.memberStatus !== 'approved' ? <View className='notice notice--warning'>需要先加入球队并通过审核</View> : <>
          <View className='card form-card'>
            <Text className='section-heading__eyebrow'>MY STATUS</Text>
            <Text className='section-heading__title'>我的出席状态</Text>
            <View className='signup-options signup-options--primary'>
              {([['attending', '参加'], ['maybe', '待定']] as const).map(([value, label]) => (
                <Button key={value} className={`signup-option ${choice === value ? 'signup-option--active' : ''}`} onClick={() => setChoice(value)}>
                  <Text className='signup-option__label'>{label}</Text>
                </Button>
              ))}
            </View>
            <Button className={`absence-option ${choice === 'absent' ? 'absence-option--active' : ''}`} onClick={() => setChoice('absent')}>
              <Text>本场缺席</Text>
            </Button>

            {choice === 'maybe' ? <View className='pending-panel'>
              <Text className='field__label'>预计确认时间</Text>
              <View className='pending-pickers'>
                <Picker mode='date' value={pendingDate} start={beijingDate()} end={match.matchDate} onChange={(event) => setPendingDate(event.detail.value)}>
                  <View className='picker-value'>{pendingDate}</View>
                </Picker>
                <Picker mode='time' value={pendingTime} onChange={(event) => setPendingTime(event.detail.value)}>
                  <View className='picker-value'>{pendingTime}</View>
                </Picker>
              </View>
            </View> : null}

            {choice === 'attending' ? <View className='signup-kind'>
              <Text className='field__label'>报名类型</Text>
              <View className='signup-kind__options'>
                {([
                  ['self', '本人参加'],
                  ['trial_companion', '带人试训'],
                  ['guest_companion', '带人凑脚']
                ] as Array<[SignupType, string]>).map(([value, label]) => (
                  <View key={value} className={`signup-kind__item ${signupType === value ? 'signup-kind__item--active' : ''}`} onClick={() => setSignupType(value)}>{label}</View>
                ))}
              </View>
              {signupType !== 'self' ? <View className='field field--spaced'>
                <Text className='field__label'>同行人员姓名</Text>
                <Input className='field__input' value={companionName} onInput={(event) => setCompanionName(event.detail.value)} placeholder='填写试训球员或临时客串人员姓名' />
              </View> : null}
            </View> : null}

            <View className='signup-note'>
              <Text className='field__label'>报名备注（可选）</Text>
              <Input className='field__input signup-note__input' maxlength={40} value={note} onInput={(event) => setNote(event.detail.value)} placeholder='例如：会晚到、需要搭车' />
            </View>
            <Button className='button button--primary' onClick={submit}>确认提交</Button>
          </View>

          {access.canManage ? <View className='card manager-panel'>
            <View className='manager-panel__header'>
              <View>
                <Text className='section-heading__eyebrow'>MANAGER VIEW</Text>
                <Text className='section-heading__title'>人员状态总览</Text>
              </View>
              <Text className='badge badge--warning'>{summary.pendingApproval} 项待审核</Text>
            </View>
            <View className='signup-summary'>
              {[
                ['参加', summary.attending],
                ['待定', summary.maybe],
                ['候补', summary.waitlisted],
                ['缺席', summary.absent]
              ].map(([label, value]) => <View key={label}><Text className='signup-summary__value'>{value}</Text><Text className='signup-summary__label'>{label}</Text></View>)}
            </View>
            <View className='manager-filter'>
              {([
                ['all', '全部'],
                ['attending', '参加'],
                ['maybe', '待定'],
                ['absent', '缺席'],
                ['pending_approval', '待审']
              ] as Array<[ManagerFilter, string]>).map(([value, label]) => (
                <View key={value} className={`manager-filter__item ${managerFilter === value ? 'manager-filter__item--active' : ''}`} onClick={() => setManagerFilter(value)}>{label}</View>
              ))}
            </View>
            {filteredSignups.map((signup) => {
              const player = players.find((item) => item.id === signup.playerId)
              return <View className='manager-signup' key={signup.id}>
                <View className='manager-signup__main'>
                  <View className='manager-signup__headline'>
                    <Text className='list-row__title'>{player?.displayName || '未知球员'}</Text>
                    <Text className={`badge ${signup.approvalStatus === 'pending' ? 'badge--warning' : ''}`}>{choiceLabel(signup)}</Text>
                  </View>
                  <Text className='list-row__meta'>{signupTypeLabel(signup)}{signup.pendingUntil ? ` · 确认时间 ${formatBeijingTime(signup.pendingUntil, { short: true })}` : ''}</Text>
                  {signup.note ? <Text className='signup-note__display'>备注：{signup.note}</Text> : null}
                </View>
                {signup.choice === 'maybe' ? <Button className='button button--small button--light' onClick={() => remind(signup.playerId)}>提醒</Button> : null}
                {signup.approvalStatus === 'pending' ? <View className='manager-signup__actions'>
                  <Button className='button button--small button--primary' onClick={() => review(signup.id, true)}>通过</Button>
                  <Button className='button button--small button--danger' onClick={() => review(signup.id, false)}>拒绝</Button>
                </View> : null}
              </View>
            })}
          </View> : <View className='card card__body'>
            <Text className='section-heading__title'>报名名单</Text>
            {signups.map((signup) => {
              const player = players.find((item) => item.id === signup.playerId)
              return <View className='list-row' key={signup.id}>
                <View className='list-row__main'>
                  <Text className='list-row__title'>{player?.displayName || '未知球员'}</Text>
                  <Text className='list-row__meta'>{choiceLabel(signup)} · {signupTypeLabel(signup)}</Text>
                </View>
              </View>
            })}
          </View>}
          <Button className='button button--dark' onClick={copy}>复制微信群名单</Button>
        </>}
      </View>
    </PageShell>
  )
}
