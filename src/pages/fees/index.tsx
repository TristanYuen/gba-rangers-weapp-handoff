import { useCallback, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Picker, Switch, Text, View } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { FeePaymentStatus, FeePlanId } from '@/domain/types'
import { appService } from '@/services'
import { beijingPeriod } from '@/utils/date'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

const currentPeriod = () => beijingPeriod()
const featuredPlanIds = ['dongguan', 'non_dongguan', 'student_high', 'student_low'] as const
type FeaturedPlanId = (typeof featuredPlanIds)[number]

export default function FeesPage() {
  usePageShare({ title: '大湾区流浪者｜会费管理', path: '/pages/fees/index' })
  const access = appService.getAccess()
  const plans = appService.getFeePlans()
  const [period, setPeriod] = useState(currentPeriod())
  const [profiles, setProfiles] = useState(() => access.canManage ? appService.listPlayerFeeLedger(currentPeriod()) : [])
  const [payments, setPayments] = useState(() => access.canManage ? appService.listFeePayments(currentPeriod()) : [])
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | FeePaymentStatus>('all')
  const [planFilter, setPlanFilter] = useState<FeaturedPlanId | null>(null)
  const [editingPlayerId, setEditingPlayerId] = useState('')
  const [planIndex, setPlanIndex] = useState(0)
  const [effectiveFrom, setEffectiveFrom] = useState(currentPeriod())
  const [effectiveTo, setEffectiveTo] = useState('')
  const [reason, setReason] = useState('')
  const [notify, setNotify] = useState(true)

  const paymentStatusOf = useCallback((playerId: string): FeePaymentStatus =>
    payments.find((payment) => payment.playerId === playerId)?.status ?? 'unpaid', [payments])

  const summary = useMemo(() => {
    const configured = profiles.filter((row) => row.status === 'configured' && row.profile)
    const chargeable = configured.filter((row) => (row.profile?.amountDue ?? 0) > 0)
    const paid = chargeable.filter((row) => paymentStatusOf(row.playerId) === 'paid')
    const paidAmount = paid.reduce((sum, row) => sum + (row.profile?.amountDue ?? 0), 0)
    const total = chargeable.reduce((sum, row) => sum + (row.profile?.amountDue ?? 0), 0)
    return {
      total,
      paidAmount,
      unpaidAmount: total - paidAmount,
      paidMembers: paid.length,
      unpaidMembers: chargeable.length - paid.length,
      exempt: configured.length - chargeable.length,
      completion: chargeable.length ? Math.round((paid.length / chargeable.length) * 100) : 100
    }
  }, [paymentStatusOf, profiles])

  const visibleProfiles = useMemo(() => profiles.filter((row) => {
    const profile = row.profile
    const matchesStatus = row.status === 'pending'
      ? statusFilter === 'all' || statusFilter === 'pending'
      : statusFilter === 'all' || (statusFilter !== 'pending' && (profile?.amountDue === 0
        ? false
        : paymentStatusOf(row.playerId) === statusFilter))
    const matchesPlan = !planFilter || Boolean(profile && (
      profile.basePlan.id === planFilter ||
      profile.history.some((assignment) => assignment.feePlanId === planFilter && assignment.effectiveFrom > period)
    ))
    return matchesStatus && matchesPlan
  }), [paymentStatusOf, period, planFilter, profiles, statusFilter])

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>只有队长或管理员可以管理会费。</View></PageShell>
  }

  const changePeriod = (value: string) => {
    setPeriod(value)
    setProfiles(appService.listPlayerFeeLedger(value))
    setPayments(appService.listFeePayments(value))
    setStatusFilter('all')
    setPlanFilter(null)
  }

  const togglePlanFilter = (feePlanId: FeaturedPlanId) => {
    setPlanFilter((current) => current === feePlanId ? null : feePlanId)
    setStatusFilter('all')
  }

  const setPaymentStatus = async (playerId: string, amount: number, status: FeePaymentStatus) => {
    try {
      await appService.setFeePaymentStatus({ playerId, period, amount, status })
      setPayments(appService.listFeePayments(period))
      Taro.showToast({ title: status === 'paid' ? '已标记为已付' : '已标记为未付', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '更新失败', icon: 'none' })
    }
  }

  const beginAdjust = (playerId: string, feePlanId?: FeePlanId) => {
    setEditingPlayerId(playerId)
    setPlanIndex(feePlanId ? Math.max(0, plans.findIndex((plan) => plan.id === feePlanId)) : 0)
    setEffectiveFrom(period)
    setEffectiveTo('')
    setReason('')
    setNotify(true)
  }

  const save = async () => {
    const selectedPlan = plans[planIndex]
    if (!selectedPlan) return
    try {
      await appService.updatePlayerFee({
        playerId: editingPlayerId,
        feePlanId: selectedPlan.id,
        effectiveFrom,
        effectiveTo: effectiveTo || undefined,
        reason,
        notify
      })
      setProfiles(appService.listPlayerFeeLedger(period))
      setEditingPlayerId('')
      Taro.showToast({ title: access.role === 'admin' ? '已提交队长审核' : '会费类型已更新', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '调整失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='TEAM FINANCE' title='会费管理' midnight />
    <View className='content stack'>
      <View className='card fee-period'>
        <View><Text className='section-heading__eyebrow'>BILLING PERIOD</Text><Text className='fee-period__value'>{period.replace('-', ' 年 ')} 月</Text></View>
        <Picker mode='date' fields='month' value={period} onChange={(event) => changePeriod(event.detail.value)}><View className='button button--small button--light'>切换月份</View></Picker>
      </View>

      <View className='card fee-dashboard'>
        <View className='fee-dashboard__top'>
          <View>
            <Text className='section-heading__eyebrow'>MONTHLY OVERVIEW</Text>
            <Text className='fee-dashboard__title'>本月会费 Dashboard</Text>
          </View>
          <View className='fee-dashboard__rate'><Text>{summary.completion}%</Text><Text>收缴率</Text></View>
        </View>
        <View className='fee-dashboard__progress'><View style={{ width: `${summary.completion}%` }} /></View>
        <View className='fee-summary'>
          {[['本月应收', `¥${summary.total}`, ''], ['已收金额', `¥${summary.paidAmount}`, 'paid'], ['待收金额', `¥${summary.unpaidAmount}`, 'unpaid'], ['免缴成员', `${summary.exempt} 人`, '']].map(([label, value, tone]) =>
            <View className={`fee-summary__item fee-summary__item--${tone}`} key={label}><Text className='fee-summary__value'>{value}</Text><Text className='fee-summary__label'>{label}</Text></View>
          )}
        </View>
        <View className='fee-dashboard__people'>
          <View><Text className='fee-dashboard__people-value fee-dashboard__people-value--paid'>{summary.paidMembers}</Text><Text>人已付</Text></View>
          <View><Text className='fee-dashboard__people-value fee-dashboard__people-value--unpaid'>{summary.unpaidMembers}</Text><Text>人未付</Text></View>
        </View>
      </View>

      <View className='fee-plan-legend'>
        {plans
          .filter((plan) => featuredPlanIds.includes(plan.id as FeaturedPlanId))
          .map((plan) => <View
            className={`fee-plan-chip fee-plan-chip--${plan.category} ${planFilter === plan.id ? 'fee-plan-chip--active' : ''}`}
            key={plan.id}
            onClick={() => togglePlanFilter(plan.id as FeaturedPlanId)}
          >
            <Text className='fee-plan-chip__name'>{plan.name}</Text>
            <Text className='fee-plan-chip__amount'>¥{plan.monthlyAmount}</Text>
          </View>)}
      </View>

      <View className='card card__body'>
        <View className='fee-list-heading'>
          <View><Text className='section-heading__title'>球员缴费台账</Text></View>
          <Text className='fee-list-heading__count'>{visibleProfiles.length} 人</Text>
        </View>
        <View className='fee-status-filter'>
          {([['all', '全部'], ['pending', `待设置 ${profiles.filter((row) => row.status === 'pending').length}`], ['unpaid', `未付 ${summary.unpaidMembers}`], ['paid', `已付 ${summary.paidMembers}`]] as const).map(([value, label]) =>
            <View className={`fee-status-filter__item ${statusFilter === value ? 'fee-status-filter__item--active' : ''}`} key={value} onClick={() => setStatusFilter(value)}>{label}</View>
          )}
        </View>
        {visibleProfiles.map((row) => {
          const profile = row.profile
          const isPending = row.status === 'pending'
          const paymentStatus = !profile || profile.amountDue === 0 ? null : paymentStatusOf(row.playerId)
          return <View className='fee-player' key={row.playerId}>
          <View className='fee-player__avatar'>{row.player.displayName.slice(0, 1)}</View>
          <View className='fee-player__main'>
            <View className='fee-player__headline'><Text className='fee-player__name'>{row.player.displayName}</Text><Text className={`badge ${isPending ? 'badge--warning' : profile?.amountDue === 0 || paymentStatus === 'paid' ? 'badge--success' : 'badge--warning'}`}>{isPending ? '待设置' : profile?.amountDue === 0 ? '免缴' : paymentStatus === 'paid' ? '已付' : '未付'}</Text></View>
            <Text className='fee-player__meta'>{isPending ? '尚未设置会费类型' : `基础档：${profile?.basePlan.name}${profile?.activeAssignment.paymentMethod ? ` · ${profile.activeAssignment.paymentMethod}` : ''}${profile?.holidayAdjusted ? ' · 本月按在莞标准' : ''}`}</Text>
            <Text className='fee-player__reason'>{isPending ? '请管理员选择生效档次' : profile?.activeAssignment.reason}</Text>
          </View>
          <View className='fee-player__amount'><Text>{isPending ? '待设置' : `¥${profile?.amountDue ?? 0}`}</Text>{isPending ? null : <Text className='fee-player__unit'>／月</Text>}</View>
          {isPending ? <Button className='button button--small button--light' onClick={() => editingPlayerId === row.playerId ? setEditingPlayerId('') : beginAdjust(row.playerId)}>{editingPlayerId === row.playerId ? '收起设置' : '设置档次'}</Button> : profile && profile.amountDue > 0 ? <View className='fee-player__actions'>
            <View className={`fee-payment-toggle ${paymentStatus === 'unpaid' ? 'fee-payment-toggle--unpaid' : ''}`} onClick={() => setPaymentStatus(row.playerId, profile.amountDue, 'unpaid')}>未付</View>
            <View className={`fee-payment-toggle ${paymentStatus === 'paid' ? 'fee-payment-toggle--paid' : ''}`} onClick={() => setPaymentStatus(row.playerId, profile.amountDue, 'paid')}>已付</View>
            <Button className='button button--small button--light' onClick={() => editingPlayerId === row.playerId ? setEditingPlayerId('') : beginAdjust(row.playerId, profile.basePlan.id)}>{editingPlayerId === row.playerId ? '收起调整' : '调整档次'}</Button>
          </View> : <Button className='button button--small button--light' onClick={() => editingPlayerId === row.playerId ? setEditingPlayerId('') : beginAdjust(row.playerId, profile?.basePlan.id)}>{editingPlayerId === row.playerId ? '收起调整' : '调整档次'}</Button>}
          {editingPlayerId === row.playerId ? <View className='fee-player__editor'>
            <Text className='section-heading__eyebrow'>ADJUSTMENT</Text>
            <Text className='fee-player__editor-title'>{isPending ? '设置' : '调整'} {row.player.displayName} 的会费</Text>
            <View className='field'>
              <Text className='field__label'>新会费类型</Text>
              <Picker mode='selector' range={plans.map((plan) => `${plan.name} · ¥${plan.monthlyAmount}/月`)} value={planIndex} onChange={(event) => setPlanIndex(Number(event.detail.value))}>
                <View className='picker-value picker-value--full'>{plans[planIndex]?.name} · ¥{plans[planIndex]?.monthlyAmount}/月</View>
              </Picker>
            </View>
            <View className='grid-2'>
              <View className='field'><Text className='field__label'>生效月份</Text><Picker mode='date' fields='month' value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.detail.value)}><View className='picker-value'>{effectiveFrom}</View></Picker></View>
              <View className='field'><Text className='field__label'>结束月份（可选）</Text><Picker mode='date' fields='month' value={effectiveTo || effectiveFrom} onChange={(event) => setEffectiveTo(event.detail.value)}><View className='picker-value'>{effectiveTo || '长期有效'}</View></Picker></View>
            </View>
            <View className='field'><Text className='field__label'>调整原因</Text><Input className='field__input' value={reason} onInput={(event) => setReason(event.detail.value)} placeholder='例如：重大伤病、异地工作或队委会确认' /></View>
            <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>通知球员本人</Text></View><Switch checked={notify} color='#123BB4' onChange={(event) => setNotify(event.detail.value)} /></View>
            <View className='grid-2'><Button className='button button--light' onClick={() => setEditingPlayerId('')}>取消</Button><Button className='button button--primary' onClick={save}>确认调整</Button></View>
          </View> : null}
        </View>
        })}
      </View>
    </View>
  </PageShell>
}
