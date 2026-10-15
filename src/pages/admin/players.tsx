import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Input, Picker, Text, View } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { PlayerAddRequest } from '@/domain/types'
import { appService } from '@/services'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { formatBeijingTime } from '@/utils/date'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'
import { CloudSyncStatus } from '@/components/CloudSyncStatus'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

const positions = ['前锋', '中场', '后卫', '门将', '未分类']

export default function PlayerManagementPage() {
  usePageShare({ title: '大湾区流浪者｜球员管理', path: '/pages/admin/players' })
  const access = appService.getAccess()
  const feePlans = appService.getFeePlans()
  const [displayName, setDisplayName] = useState('')
  const [shirtNumber, setShirtNumber] = useState('')
  const [positionIndex, setPositionIndex] = useState(0)
  const [feePlanIndex, setFeePlanIndex] = useState(-1)
  const [joinYear, setJoinYear] = useState('2026')
  const [submitting, setSubmitting] = useState(false)
  const [requests, setRequests] = useState<PlayerAddRequest[]>(access.canManage ? appService.listPlayerAddRequests() : [])
  const refreshRequests = () => setRequests(appService.listPlayerAddRequests())
  const { syncError } = useCloudPageRefresh({ onSynced: () => access.canManage && refreshRequests() })

  useDidShow(() => {
    if (!access.canManage || !cloudbaseEnabled) return
    void syncCloudState(localStore).then(refreshRequests).catch(() => undefined)
  })

  if (!access.canManage) return <PageShell className='content'><View className='notice notice--danger'>当前身份没有新球员管理权限。</View></PageShell>

  const submit = async () => {
    try {
      if (!displayName.trim() || shirtNumber === '' || !joinYear) throw new Error('请填写完整球员资料')
      setSubmitting(true)
      const saved = await appService.createPlayerRequest({
        displayName,
        shirtNumber: Number(shirtNumber),
        position: positions[positionIndex] || '未分类',
        joinYear: Number(joinYear),
        feePlanId: feePlanIndex >= 0 ? feePlans[feePlanIndex]?.id : undefined
      })
      setDisplayName('')
      setShirtNumber('')
      setFeePlanIndex(-1)
      refreshRequests()
      Taro.showToast({ title: saved.status === 'approved' ? '球员已加入名册' : '已提交队长审核', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }

  const review = async (id: string, approved: boolean) => {
    try {
      await appService.reviewPlayerAddRequest(id, approved)
      refreshRequests()
      Taro.showToast({ title: approved ? '已批准入册' : '已驳回申请', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '审核失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='PLAYER ONBOARDING' title='新增球员' subtitle={access.role === 'owner' ? '队长提交后直接入册，球员仍需完成微信身份认领。' : '管理员提交后由队长审核，审核通过后进入可认领名单。'} midnight />
    <View className='content stack'>
      <CloudSyncStatus error={syncError} />
      <View className='card form-card'>
        <View className='field'><Text className='field__label'>姓名</Text><Input className='field__input' value={displayName} onInput={(event) => setDisplayName(event.detail.value)} placeholder='填写真实姓名' /></View>
        <View className='grid-2'>
          <View className='field'><Text className='field__label'>球衣号码</Text><Input className='field__input' type='number' value={shirtNumber} onInput={(event) => setShirtNumber(event.detail.value)} placeholder='现役号码不可重复' /></View>
          <View className='field'><Text className='field__label'>入队年份</Text><Input className='field__input' type='number' value={joinYear} onInput={(event) => setJoinYear(event.detail.value)} /></View>
        </View>
        <View className='field'><Text className='field__label'>位置</Text><Picker mode='selector' range={positions} value={positionIndex} onChange={(event) => setPositionIndex(Number(event.detail.value))}><View className='picker-value picker-value--full'>{positions[positionIndex]}</View></Picker></View>
        <View className='field'><Text className='field__label'>会费类型（可选）</Text><Picker mode='selector' range={['待设置', ...feePlans.map((plan) => `${plan.name} · ¥${plan.monthlyAmount}/月`)]} value={feePlanIndex + 1} onChange={(event) => setFeePlanIndex(Number(event.detail.value) - 1)}><View className='picker-value picker-value--full'>{feePlanIndex >= 0 ? `${feePlans[feePlanIndex]?.name} · ¥${feePlans[feePlanIndex]?.monthlyAmount}/月` : '待设置'}</View></Picker></View>
        <Button className='button button--primary' disabled={submitting} onClick={() => void submit()}>{access.role === 'owner' ? '确认加入名册' : '提交队长审核'}</Button>
      </View>

      <View className='stack'>
        <Text className='section-heading__title'>待审核申请</Text>
        {requests.map((request) => <View className='card approval-card' key={request.id}>
          <View className='approval-card__main'>
            <Text className='approval-card__name'>{request.displayName}</Text>
            <Text className='approval-card__meta'>{request.shirtNumber} 号 · {request.position} · {request.joinYear} 年入队</Text>
            <Text className='approval-card__meta'>会费：{request.feePlanId ? feePlans.find((plan) => plan.id === request.feePlanId)?.name || '待设置' : '待设置'}</Text>
            <Text className='approval-card__meta'>{request.requestedBy} · {formatBeijingTime(request.requestedAt)}</Text>
          </View>
          {access.role === 'owner' ? <View className='toolbar'><Button className='button button--small button--light' onClick={() => void review(request.id, false)}>驳回</Button><Button className='button button--small button--primary' onClick={() => void review(request.id, true)}>批准</Button></View> : <Text className='badge badge--warning'>等待队长</Text>}
        </View>)}
        {!requests.length ? <View className='notice center'>当前没有待审核的新球员申请</View> : null}
      </View>
    </View>
  </PageShell>
}
