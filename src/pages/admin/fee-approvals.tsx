import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { FeeChangeRequest } from '@/domain/types'
import { appService } from '@/services'
import { formatBeijingTime } from '@/utils/date'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

export default function FeeApprovalsPage() {
  usePageShare({ title: '大湾区流浪者｜会费审批', path: '/pages/admin/fee-approvals' })
  const access = appService.getAccess()
  const [requests, setRequests] = useState<FeeChangeRequest[]>([])

  const loadRequests = async () => {
    if (access.role !== 'owner') return
    try {
      if (cloudbaseEnabled) await syncCloudState(localStore)
      setRequests(appService.listFeeChangeRequests())
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '会费审批加载失败', icon: 'none' })
    }
  }

  useDidShow(() => {
    void loadRequests()
  })

  if (access.role !== 'owner') {
    return <PageShell className='content'><View className='notice notice--danger'>会费审批仅限队长处理。</View></PageShell>
  }

  const plans = appService.getFeePlans()
  const review = async (request: FeeChangeRequest, approved: boolean) => {
    try {
      await appService.reviewFeeChangeRequest(request.id, approved ? 'approved' : 'rejected')
      setRequests((current) => current.filter((item) => item.id !== request.id))
      Taro.showToast({ title: approved ? '会费调整已通过' : '会费调整已驳回', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '会费审批失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='CAPTAIN REVIEW' title='会费审批' subtitle={`待处理 ${requests.length} 条`} midnight />
    <View className='content stack'>
      {requests.length ? requests.map((request) => {
        const player = appService.getPlayer(request.playerId)
        const plan = plans.find((item) => item.id === request.feePlanId)
        return <View className='card card__body approval-card' key={request.id}>
          <View className='approval-card__header'>
            <View>
              <Text className='approval-card__title'>{player.displayName}</Text>
              <Text className='approval-card__meta'>{request.requestedBy} · {formatBeijingTime(request.requestedAt)}</Text>
            </View>
            <Text className='badge badge--warning'>待队长审批</Text>
          </View>
          <Text className='approval-card__detail'>{plan?.name ?? request.feePlanId} · ¥{plan?.monthlyAmount ?? 0}／月</Text>
          <Text className='approval-card__meta'>{request.effectiveFrom}{request.effectiveTo ? ` 至 ${request.effectiveTo}` : ' 起'}</Text>
          <Text className='approval-card__reason'>调整原因：{request.reason}</Text>
          <View className='grid-2 approval-card__actions'>
            <Button className='button button--danger' onClick={() => void review(request, false)}>驳回</Button>
            <Button className='button button--primary' onClick={() => void review(request, true)}>通过</Button>
          </View>
        </View>
      }) : <View className='card card__body empty-state'>
        <Text className='empty-state__title'>会费审批已处理完</Text>
        <Text className='empty-state__meta'>管理员提交的新申请会显示在这里。</Text>
      </View>}
    </View>
  </PageShell>
}
