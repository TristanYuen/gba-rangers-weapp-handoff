import { useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button, Input, Picker, Switch } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { TopNav } from '@/components/TopNav'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { StatStrip } from '@/components/StatStrip'
import { CloudSyncStatus } from '@/components/CloudSyncStatus'
import type { AccessContext, ClaimableRoster, Player, Role } from '@/domain/types'
import { appService } from '@/services'
import { callCloudAction, cloudbaseEnabled } from '@/services/cloudService'
import { localStore } from '@/services/localStore'
import { chooseCroppedAvatar } from '@/utils/avatar'
import { confirmMediaUploadCompliance } from '@/utils/mediaCompliance'
import { isMediaCancel, mediaErrorMessage } from '@/utils/mediaUpload'
import { valueMessage } from '@/services/cloudErrors'
import { useCloudPageRefresh } from '@/hooks/useCloudPageRefresh'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'
import { SUBSCRIBE_TEMPLATE_IDS } from '@/services/subscribeMessages'

const roleLabel: Record<Role, string> = { visitor: '访客', player: '球员', admin: '管理员', owner: '队长' }
const resetPageScroll = () => {
  setTimeout(() => {
    void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }).catch(() => undefined)
  }, 0)
}
const playerOrNull = (playerId?: string): Player | null => {
  if (!playerId) return null
  try {
    return appService.getPlayer(playerId)
  } catch {
    return null
  }
}

interface AccountOverview {
  access: Pick<AccessContext, 'role' | 'memberStatus' | 'membershipId' | 'teamId' | 'playerId'>
  player: Player | null
  subscriptionEnabled: boolean
}

export default function AccountPage() {
  usePageShare({ title: '大湾区流浪者｜我的球队', path: '/pages/account/index' })
  const [access, setAccess] = useState<AccessContext>(appService.getAccess())
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(() => {
    const initialAccess = appService.getAccess()
    return playerOrNull(initialAccess.playerId)
  })
  const [inviteCode, setInviteCode] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bootstrapCode, setBootstrapCode] = useState('')
  const [claimableRoster, setClaimableRoster] = useState<ClaimableRoster | null>(null)
  const [claimPlayerIndex, setClaimPlayerIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(appService.getSubscriptionEnabled())
  const [unreadNoticeCount, setUnreadNoticeCount] = useState(() => {
    const initialAccess = appService.getAccess()
    return initialAccess.memberStatus === 'approved' ? appService.getUnreadNoticeCount() : 0
  })
  const { syncError } = useCloudPageRefresh({
    onSynced: () => {
      const nextAccess = appService.getAccess()
      setAccess(nextAccess)
      setCurrentPlayer(playerOrNull(nextAccess.playerId))
      setSubscriptionEnabled(appService.getSubscriptionEnabled())
      setUnreadNoticeCount(nextAccess.memberStatus === 'approved' ? appService.getUnreadNoticeCount() : 0)
    }
  })
  const refreshCloudAccess = async () => {
    if (!cloudbaseEnabled) return
    const overview = await callCloudAction<AccountOverview>('membership', 'getAccountOverview', {})
    localStore.hydrateFromCloud({
      access: overview.access,
      subscriptionEnabled: overview.subscriptionEnabled
    })
    const nextAccess = appService.getAccess()
    setAccess(nextAccess)
    setCurrentPlayer(overview.player || playerOrNull(nextAccess.playerId))
    setSubscriptionEnabled(overview.subscriptionEnabled)
    setUnreadNoticeCount(nextAccess.memberStatus === 'approved' ? appService.getUnreadNoticeCount() : 0)
    resetPageScroll()
  }
  useDidShow(() => {
    const page = Taro.getCurrentInstance().page as unknown as ({
      getTabBar?: () => { setData: (data: { selected: number }) => void }
    } | undefined)
    page?.getTabBar?.()?.setData({ selected: 1 })
    setUnreadNoticeCount(appService.getUnreadNoticeCount())
    resetPageScroll()
    if (cloudbaseEnabled) {
      void refreshCloudAccess().catch((error) => {
        console.error('Account cloud refresh failed:', error)
        Taro.showToast({ title: '云端连接异常，已显示本机缓存', icon: 'none' })
      })
    }
  })
  const switchRole = (role: Role) => {
    const nextAccess = appService.setDemoRole(role)
    setAccess(nextAccess)
    setCurrentPlayer(playerOrNull(nextAccess.playerId))
    Taro.showToast({ title: `已切换为${roleLabel[role]}`, icon: 'none' })
  }
  const join = async () => {
    try {
      if (cloudbaseEnabled) {
        setSubmitting(true)
        if (!claimableRoster) {
          const roster = await callCloudAction<ClaimableRoster>('membership', 'listClaimablePlayers', { inviteCode })
          setClaimableRoster(roster)
          setClaimPlayerIndex(0)
          Taro.showToast({ title: '请选择本人姓名', icon: 'none' })
          return
        }
        const player = claimableRoster.players[claimPlayerIndex]
        if (!player) throw new Error('当前没有可认领的正式球员')
        await callCloudAction('membership', 'requestClaim', { inviteCode, playerId: player.id })
        await refreshCloudAccess()
        Taro.showToast({ title: '认领申请已提交', icon: 'success' })
        return
      }
      setAccess(appService.requestJoin(inviteCode, displayName))
      Taro.showToast({ title: '申请已提交', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '提交失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }
  const bootstrapOwner = async () => {
    try {
      setSubmitting(true)
      await callCloudAction('membership', 'bootstrapOwner', { code: bootstrapCode })
      await refreshCloudAccess()
      setBootstrapCode('')
      Taro.showToast({ title: '队长身份绑定成功', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '绑定失败', icon: 'none' })
    } finally {
      setSubmitting(false)
    }
  }
  const uploadLock = useRef(false)
  const [uploading, setUploading] = useState(false)
  const choosePhoto = async () => {
    if (uploadLock.current) return
    uploadLock.current = true
    setUploading(true)
    try {
      if (!await confirmMediaUploadCompliance()) return
      const savedPath = await chooseCroppedAvatar()
      if (!savedPath) return
      const updatedPlayer = await appService.setPlayerAvatar(savedPath)
      setCurrentPlayer(updatedPlayer)
      Taro.showToast({ title: '头像已提交，待队长审批', icon: 'none' })
    } catch (error) {
      if (!isMediaCancel(error)) console.error('头像提交失败', { message: valueMessage(error) })
      Taro.showToast({ title: mediaErrorMessage(error, '头像提交失败，请稍后重试'), icon: 'none' })
    } finally {
      uploadLock.current = false
      setUploading(false)
    }
  }
  const updateSubscription = async (enabled: boolean) => {
    try {
      let acceptedCount = 0
      if (enabled && cloudbaseEnabled) {
        const result = await Taro.requestSubscribeMessage({ tmplIds: [...SUBSCRIBE_TEMPLATE_IDS] } as Parameters<typeof Taro.requestSubscribeMessage>[0])
        const resultByTemplateId = result as Record<string, unknown>
        const acceptedTemplateIds = SUBSCRIBE_TEMPLATE_IDS.filter((templateId) => resultByTemplateId[templateId] === 'accept')
        if (acceptedTemplateIds.length > 0) {
          await callCloudAction('notifications', 'recordSubscription', { templateIds: acceptedTemplateIds })
          acceptedCount = acceptedTemplateIds.length
        }
      }
      const saved = await appService.setSubscriptionEnabled(enabled)
      setSubscriptionEnabled(saved)
      if (enabled && cloudbaseEnabled) {
        Taro.showToast({
          title: acceptedCount > 0 ? `已获得${acceptedCount}项微信提醒额度` : '已开启球队通知，暂未获得微信额度',
          icon: acceptedCount > 0 ? 'success' : 'none'
        })
      }
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '订阅设置更新失败', icon: 'none' })
    }
  }
  return <PageShell>
    <TopNav unreadCount={unreadNoticeCount} showNotices={access.memberStatus === 'approved'} />
    <PageHero eyebrow='GBA RANGERS · CLUB' title='我的球队' />
    <View className='content stack'>
      <CloudSyncStatus error={syncError} />
      {__DATA_MODE__ === 'local' ? <View className='demo-role'>
        <Text className='section-heading__title'>本地演示身份</Text>
        <View className='toolbar'>{(['visitor', 'player', 'admin', 'owner'] as Role[]).map((role) => <Button key={role} className={`button button--small ${access.role === role ? 'button--primary' : 'button--light'}`} onClick={() => switchRole(role)}>{roleLabel[role]}</Button>)}</View>
      </View> : null}
      {access.memberStatus === 'none' || access.memberStatus === 'rejected' ? <>
        {access.memberStatus === 'rejected' ? <View className='notice notice--danger'><Text className='notice__title'>上一次身份认领未通过，请确认后重新提交。</Text></View> : null}
        <View className='card form-card'>
          <Text className='section-heading__title'>认领我的球员身份</Text>
          {cloudbaseEnabled ? null : <View className='field'><Text className='field__label'>姓名</Text><Input className='field__input' value={displayName} onInput={(event) => setDisplayName(event.detail.value)} placeholder='填写真实姓名' /></View>}
          <View className='field'>
            <Text className='field__label'>球队邀请码</Text>
            <Input
              className='field__input'
              value={inviteCode}
              onInput={(event) => {
                setInviteCode(event.detail.value)
                setClaimableRoster(null)
              }}
              placeholder='输入球队邀请码'
            />
          </View>
          {cloudbaseEnabled && claimableRoster ? <View className='field'>
            <Text className='field__label'>选择本人姓名</Text>
            {claimableRoster.players.length ? <Picker
              mode='selector'
              range={claimableRoster.players.map((player) => player.displayName)}
              value={claimPlayerIndex}
              onChange={(event) => setClaimPlayerIndex(Number(event.detail.value))}
            >
              <View className='field__input'>
                {claimableRoster.players[claimPlayerIndex]?.displayName || '请选择'}
              </View>
            </Picker> : <View className='notice notice--warning'>当前没有可认领的正式球员。</View>}
          </View> : null}
          <Button className='button button--primary' disabled={submitting} onClick={() => void join()}>
            {cloudbaseEnabled && !claimableRoster ? '验证邀请码并读取名单' : '提交认领申请'}
          </Button>
        </View>
        {cloudbaseEnabled ? <View className='card form-card'>
          <Text className='section-heading__title'>队长专属初始化</Text>
          <Text className='muted'>仅供黄震杰首次绑定使用，邀请码成功使用后立即失效。</Text>
          <View className='field'>
            <Text className='field__label'>专属队长邀请码</Text>
            <Input className='field__input' password value={bootstrapCode} onInput={(event) => setBootstrapCode(event.detail.value)} placeholder='输入专属邀请码' />
          </View>
          <Button className='button button--light' disabled={submitting || !bootstrapCode.trim()} onClick={() => void bootstrapOwner()}>绑定队长身份</Button>
        </View> : null}
      </> : null}
      {access.memberStatus === 'pending' ? <View className='notice notice--warning'><Text className='notice__title'>申请审核中</Text></View> : null}
      {access.memberStatus === 'approved' ? <>
        <View className='card card__body'>
        <View className='team-profile' onClick={() => access.playerId && Taro.navigateTo({ url: `/pages/players/profile?id=${access.playerId}` })}>
          {currentPlayer ? <PlayerAvatar player={currentPlayer} className='team-profile__avatar' fallback={currentPlayer.shirtNumber ?? '—'} /> : <View className='team-profile__avatar'>—</View>}
          <View className='team-profile__main'><Text className='team-profile__name'>{currentPlayer?.displayName ?? '球队成员'}</Text><Text className='team-profile__meta'>{roleLabel[access.role] ?? '成员'} · {currentPlayer?.shirtNumber !== undefined ? `${currentPlayer.shirtNumber} 号` : '号码待补'} · {currentPlayer?.position || '未分类'} · {currentPlayer?.joinYear ? `${currentPlayer.joinYear} 年入队` : '年份待补'}</Text></View>
          <Text className='badge badge--success'>查看档案</Text>
        </View>
        </View>
        <View className='card card__body team-personal-stats'>
          <Text className='section-heading__eyebrow'>2026 SEASON</Text>
          <Text className='section-heading__title'>个人数据</Text>
          <StatStrip stats={currentPlayer?.stats || { apps: 0, goals: 0, assists: 0 }} />
        </View>
        <View className='card card__body team-service-panel'>
        <Text className='section-heading__eyebrow'>TEAM SERVICES</Text>
        <Text className='section-heading__title'>球队功能</Text>
        <View className='team-menu'>
          <View className='team-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/notices/index' })}><Text className='team-menu__label'>球队通知</Text>{unreadNoticeCount > 0 ? <Text className='team-menu__badge'>{unreadNoticeCount > 99 ? '99+' : unreadNoticeCount}</Text> : null}</View>
          <View className='team-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/players/index' })}><Text className='team-menu__label'>球员名册</Text></View>
          <View className='team-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/leaderboard/index' })}><Text className='team-menu__label'>数据榜单</Text></View>
          <View className='team-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/yearbook/index' })}><Text className='team-menu__label'>球队年鉴</Text></View>
        </View>
        <Button className='button button--light' onClick={choosePhoto} disabled={uploading} loading={uploading}>上传头像并提交审批</Button>
        <View className='list-row'><View className='list-row__main'><Text className='list-row__title'>赛事订阅提醒</Text></View><Switch checked={subscriptionEnabled} color='#123BB4' onChange={(event) => void updateSubscription(event.detail.value)} /></View>
        </View>
      </> : null}
      {access.canManage ? <View className='card admin-entry' onClick={() => Taro.navigateTo({ url: '/pages/admin/index' })}><View><Text className='section-heading__eyebrow'>TEAM OPERATIONS</Text><Text className='admin-entry__title'>球队运营中心</Text></View><Text className='admin-entry__arrow'>›</Text></View> : null}
    </View>
  </PageShell>
}
