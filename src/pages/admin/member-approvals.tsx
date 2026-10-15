import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button, Picker } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { MembershipApplication, TeamMemberIdentity } from '@/domain/types'
import { appService } from '@/services'
import { formatBeijingTime } from '@/utils/date'
import { callCloudAction, cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

type PendingMember = MembershipApplication | TeamMemberIdentity

export default function MemberApprovalsPage() {
  usePageShare({ title: '大湾区流浪者｜成员审批', path: '/pages/admin/member-approvals' })
  const access = appService.getAccess()
  const players = access.canManage ? appService.listPlayers(true) : []
  const [members, setMembers] = useState<PendingMember[]>([])
  const [bindings, setBindings] = useState<Record<string, number>>({})

  const loadMembers = async () => {
    if (!access.canManage) return
    try {
      if (cloudbaseEnabled) {
        await syncCloudState(localStore)
        const pending = await callCloudAction<TeamMemberIdentity[]>('membership', 'listPendingClaims', {})
        setMembers(pending.filter((member) => member.status === 'pending'))
      } else {
        setMembers(appService.getMembershipApplications().filter((member) => member.status === 'pending'))
      }
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '成员审批加载失败', icon: 'none' })
    }
  }

  useDidShow(() => {
    void loadMembers()
  })

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>当前身份没有成员审批权限。</View></PageShell>
  }

  const reviewMember = async (member: PendingMember, approved: boolean) => {
    const player = players[bindings[member.id] ?? 0]
    try {
      if (cloudbaseEnabled) {
        await callCloudAction('membership', 'reviewClaim', {
          id: member.id,
          status: approved ? 'approved' : 'rejected'
        })
      } else {
        appService.reviewMembership(member.id, approved ? 'approved' : 'rejected', approved ? player?.id : undefined)
      }
      setMembers((current) => current.filter((item) => item.id !== member.id))
      Taro.showToast({ title: approved ? '成员已通过' : '申请已驳回', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '成员审批失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='MEMBER REVIEW' title='成员审批' subtitle={`待处理 ${members.length} 条`} midnight />
    <View className='content stack'>
      {members.length ? members.map((member) => <View className='card card__body approval-card' key={member.id}>
        <View className='approval-card__header'>
          <View>
            <Text className='approval-card__title'>{member.displayName}</Text>
            <Text className='approval-card__meta'>{member.requestedAt ? formatBeijingTime(member.requestedAt) : '刚刚提交'}</Text>
          </View>
          <Text className='badge badge--warning'>待审批</Text>
        </View>
        {cloudbaseEnabled
          ? <Text className='approval-card__detail'>申请认领：{member.displayName}</Text>
          : <Picker
              mode='selector'
              range={players.map((player) => player.displayName)}
              value={bindings[member.id] ?? 0}
              onChange={(event) => setBindings((current) => ({ ...current, [member.id]: Number(event.detail.value) }))}
          >
              <View className='approval-binding'>绑定球员档案：{players[bindings[member.id] ?? 0]?.displayName ?? '请选择'}</View>
            </Picker>}
        <View className='grid-2 approval-card__actions'>
          <Button className='button button--danger' onClick={() => void reviewMember(member, false)}>驳回</Button>
          <Button className='button button--primary' onClick={() => void reviewMember(member, true)}>通过</Button>
        </View>
      </View>) : <View className='card card__body empty-state'>
        <Text className='empty-state__title'>成员审批已处理完</Text>
        <Text className='empty-state__meta'>新的成员申请会显示在这里。</Text>
      </View>}
    </View>
  </PageShell>
}
