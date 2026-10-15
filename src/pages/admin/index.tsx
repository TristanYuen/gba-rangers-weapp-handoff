import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { TeamMemberIdentity } from '@/domain/types'
import { appService } from '@/services'
import { callCloudAction, cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { usePageShare } from '@/hooks/usePageShare'
import { setNavigationIntent } from '@/services/navigationIntent'
import { PageShell } from '@/components/PageShell'

export default function AdminPage() {
  usePageShare({ title: '大湾区流浪者｜球队运营中心', path: '/pages/admin/index' })
  const access = appService.getAccess()
  const [cloudMembers, setCloudMembers] = useState<TeamMemberIdentity[]>([])
  const [adminListExpanded, setAdminListExpanded] = useState(false)
  const [teamRoles, setTeamRoles] = useState(access.canManage ? appService.listTeamRoles() : [])
  const [, setRefreshKey] = useState(0)

  const loadAdminData = async () => {
    if (!access.canManage) return
    try {
      if (cloudbaseEnabled) {
        await syncCloudState(localStore)
        const approved = await callCloudAction<TeamMemberIdentity[]>('membership', 'listTeamMembers', {})
        setCloudMembers(approved)
      } else {
        setTeamRoles(appService.listTeamRoles())
      }
      setRefreshKey((value) => value + 1)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '管理数据加载失败', icon: 'none' })
    }
  }

  useDidShow(() => {
    void loadAdminData()
  })

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>当前身份没有管理权限。请在“我的球队”切换到管理员演示身份。</View></PageShell>
  }

  const dashboard = appService.getAdminDashboard()
  const pendingTotal = dashboard.pendingMembers + dashboard.pendingPlayerAdditions + dashboard.pendingFeeChanges + dashboard.pendingMedia
  const approvedMedia = appService.getMedia().filter((asset) => asset.reviewStatus === 'approved').length

  const setAdministrator = async (playerId: string, enabled: boolean) => {
    try {
      if (cloudbaseEnabled) {
        const member = cloudMembers.find((item) => item.playerId === playerId)
        if (!member) throw new Error('成员身份记录不存在')
        await callCloudAction('membership', 'setRole', { id: member.id, role: enabled ? 'admin' : 'player' })
        await loadAdminData()
        Taro.showToast({ title: enabled ? '已任命管理员' : '已撤销管理员', icon: 'success' })
        return
      }
      appService.setAdministrator(playerId, enabled)
      setTeamRoles(appService.listTeamRoles())
      Taro.showToast({ title: enabled ? '已任命管理员' : '已撤销管理员', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '权限调整失败', icon: 'none' })
    }
  }

  const setCaptain = async (membershipId: string, enabled: boolean) => {
    try {
      await callCloudAction('membership', 'setRole', { id: membershipId, role: enabled ? 'owner' : 'player' })
      await loadAdminData()
      Taro.showToast({ title: enabled ? '已任命队长' : '已撤销队长', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '队长权限调整失败', icon: 'none' })
    }
  }

  const unbindIdentity = async (member: TeamMemberIdentity) => {
    const confirmation = await Taro.showModal({
      title: '解除身份绑定',
      content: `确认解除 ${member.displayName} 的微信身份绑定？`,
      confirmText: '解除绑定',
      confirmColor: '#C62828'
    })
    if (!confirmation.confirm) return
    try {
      await callCloudAction('membership', 'unbindIdentity', { id: member.id })
      await loadAdminData()
      Taro.showToast({ title: '身份绑定已解除', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '解除绑定失败', icon: 'none' })
    }
  }

  const players = appService.listPlayers(true)

  return <PageShell>
    <PageHero eyebrow={access.role === 'owner' ? 'CAPTAIN CONTROL' : 'TEAM OPERATIONS'} title='球队运营中心' midnight />
    <View className='content stack'>
      <View className='admin-menu'>
        <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/approvals' })}>
          <View className='admin-menu__main'>
            <Text className='section-heading__eyebrow'>APPROVALS</Text>
            <Text className='admin-menu__title'>待审批</Text>
            <Text className='admin-menu__meta'>{access.role === 'owner' ? '成员、会费与图片审批' : '成员与新球员资料审批'}</Text>
          </View>
          <View className='admin-menu__side'>
            <Text className={`badge${pendingTotal ? ' badge--danger' : ' badge--success'}`}>{pendingTotal}</Text>
            <Text className='admin-menu__chevron'>›</Text>
          </View>
        </View>
        <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/media' })}>
          <View className='admin-menu__main'>
            <Text className='section-heading__eyebrow'>MEDIA</Text>
            <Text className='admin-menu__title'>照片管理</Text>
            <Text className='admin-menu__meta'>设置封面、精选或隐藏</Text>
          </View>
          <View className='admin-menu__side'>
            <Text className='badge'>{approvedMedia}</Text>
            <Text className='admin-menu__chevron'>›</Text>
          </View>
        </View>
        <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/players' })}>
          <View className='admin-menu__main'>
            <Text className='section-heading__eyebrow'>PLAYER ONBOARDING</Text>
            <Text className='admin-menu__title'>新增球员</Text>
            <Text className='admin-menu__meta'>提交资料、队长审核并进入身份认领</Text>
          </View>
          <View className='admin-menu__side'>
            {dashboard.pendingPlayerAdditions ? <Text className='badge badge--danger'>{dashboard.pendingPlayerAdditions}</Text> : null}
            <Text className='admin-menu__chevron'>›</Text>
          </View>
        </View>
        <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/logs' })}>
          <View className='admin-menu__main'>
            <Text className='section-heading__eyebrow'>AUDIT LOG</Text>
            <Text className='admin-menu__title'>管理员操作记录</Text>
            <Text className='admin-menu__meta'>长期保留，仅管理层可见</Text>
          </View>
          <Text className='admin-menu__chevron'>›</Text>
        </View>
      </View>

      <View className='grid-2'>
        <View className='card card__body center'>
          <Text className='stat__value'>{dashboard.draftMatches}</Text>
          <Text className='stat__label'>赛事草稿</Text>
        </View>
        <View className='card card__body center'>
          <Text className='stat__value'>{dashboard.migrationIssues}</Text>
          <Text className='stat__label'>迁移待核对</Text>
        </View>
      </View>

      <View className='card card__body'>
        <Text className='section-heading__title'>快捷操作</Text>
        <View className='toolbar'>
          <Button className='button button--primary button--small' onClick={() => Taro.navigateTo({ url: '/pages/fees/index' })}>会费管理</Button>
          <Button className='button button--light button--small' onClick={() => Taro.navigateTo({ url: '/pages/notices/index' })}>发布通知</Button>
          <Button className='button button--light button--small' onClick={() => Taro.navigateTo({ url: '/pages/matches/edit' })}>创建赛事</Button>
          <Button className='button button--light button--small' onClick={() => {
            setNavigationIntent('matches-history')
            void Taro.switchTab({ url: '/pages/matches/index' })
          }}>赛后录入</Button>
          <Button className='button button--light button--small' onClick={() => Taro.navigateTo({ url: '/pages/leaderboard/index' })}>检查榜单</Button>
        </View>
      </View>

      {access.canAppointAdmins ? <View className='card card__body manager-panel'>
        <View className='manager-panel__header'>
          <View>
            <Text className='section-heading__eyebrow'>CAPTAIN ONLY</Text>
            <Text className='section-heading__title'>管理员任命</Text>
          </View>
          <Text className='badge badge--success'>队长最高权限</Text>
        </View>
        <View className='manager-panel__toggle' onClick={() => setAdminListExpanded((expanded) => !expanded)}>
          <Text className='manager-panel__toggle-title'>成员名单</Text>
          <Text className={`manager-panel__chevron ${adminListExpanded ? 'manager-panel__chevron--open' : ''}`}>⌄</Text>
        </View>
        {adminListExpanded ? <View className='manager-panel__list'>
          {(cloudbaseEnabled ? cloudMembers : players).map((player) => {
            const assignment = teamRoles.find((item) => item.playerId === player.id)
            const cloudMember = cloudbaseEnabled ? cloudMembers.find((item) => item.playerId === ('playerId' in player ? player.playerId : player.id)) : undefined
            const playerId = 'playerId' in player ? player.playerId : player.id
            const displayName = 'displayName' in player ? player.displayName : '未知球员'
            const isAdmin = cloudMember ? cloudMember.role === 'admin' : assignment?.role === 'admin'
            const isOwner = cloudMember?.role === 'owner' || assignment?.role === 'owner'
            return <View className='role-member' key={player.id}>
              <View className='role-member__avatar'>{'shirtNumber' in player ? player.shirtNumber ?? '—' : '—'}</View>
              <View className='role-member__main'>
                <Text className='list-row__title'>{displayName}</Text>
                <Text className='list-row__meta'>{isOwner ? '队长' : isAdmin ? '管理员' : '普通成员'}</Text>
              </View>
              {!isOwner ? <Button className={`button button--small ${isAdmin ? 'button--danger' : 'button--light'}`} onClick={() => void setAdministrator(playerId, !isAdmin)}>{isAdmin ? '撤销管理员' : '任命管理员'}</Button> : null}
              {cloudbaseEnabled && cloudMember ? <>
                <Button className={`button button--small ${isOwner ? 'button--danger' : 'button--light'}`} onClick={() => void setCaptain(cloudMember.id, !isOwner)}>{isOwner ? '撤销队长' : '任命队长'}</Button>
                <Button className='button button--small button--danger' onClick={() => void unbindIdentity(cloudMember)}>解除绑定</Button>
              </> : null}
            </View>
          })}
        </View> : null}
      </View> : null}
    </View>
  </PageShell>
}
