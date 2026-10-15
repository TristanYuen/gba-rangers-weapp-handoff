import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { AdminDashboard } from '@/domain/types'
import { appService } from '@/services'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

const emptyDashboard: AdminDashboard = {
  pendingMembers: 0,
  pendingPlayerAdditions: 0,
  pendingMedia: 0,
  migrationIssues: 0,
  draftMatches: 0,
  pendingSignupApprovals: 0,
  pendingFeeChanges: 0
}

export default function ApprovalCenterPage() {
  usePageShare({ title: '大湾区流浪者｜审批中心', path: '/pages/admin/approvals' })
  const access = appService.getAccess()
  const [dashboard, setDashboard] = useState<AdminDashboard>(
    access.canManage ? appService.getAdminDashboard() : emptyDashboard
  )

  useDidShow(() => {
    if (!access.canManage) return
    const load = async () => {
      try {
        if (cloudbaseEnabled) await syncCloudState(localStore)
        setDashboard(appService.getAdminDashboard())
      } catch (error) {
        Taro.showToast({ title: error instanceof Error ? error.message : '审批数据加载失败', icon: 'none' })
      }
    }
    void load()
  })

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>当前身份没有审批权限。</View></PageShell>
  }

  const openFeeApprovals = () => {
    if (access.role !== 'owner') {
      Taro.showToast({ title: '会费审批仅限队长处理', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/admin/fee-approvals' })
  }

  return <PageShell>
    <PageHero eyebrow='APPROVAL CENTER' title='待审批' subtitle='按类型进入审批列表，处理完成后自动移出。' midnight />
    <View className='content stack'>
      <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/member-approvals' })}>
        <View className='admin-menu__main'>
          <Text className='admin-menu__title'>成员审批</Text>
          <Text className='admin-menu__meta'>审核成员身份申请与档案绑定</Text>
        </View>
        <View className='admin-menu__side'>
          <Text className={`badge${dashboard.pendingMembers ? ' badge--danger' : ' badge--success'}`}>{dashboard.pendingMembers}</Text>
          <Text className='admin-menu__chevron'>›</Text>
        </View>
      </View>
      <View className='card admin-menu__item' onClick={openFeeApprovals}>
        <View className='admin-menu__main'>
          <Text className='admin-menu__title'>会费审批</Text>
          <Text className='admin-menu__meta'>{access.role === 'owner' ? '审核管理员提交的会费调整' : '队长专属审批'}</Text>
        </View>
        <View className='admin-menu__side'>
          <Text className={`badge${dashboard.pendingFeeChanges ? ' badge--danger' : ' badge--success'}`}>{dashboard.pendingFeeChanges}</Text>
          <Text className='admin-menu__chevron'>›</Text>
        </View>
      </View>
      <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/players' })}>
        <View className='admin-menu__main'>
          <Text className='admin-menu__title'>新球员审批</Text>
          <Text className='admin-menu__meta'>{access.role === 'owner' ? '审核管理员提交的新球员资料' : '查看本人提交的待审核资料'}</Text>
        </View>
        <View className='admin-menu__side'>
          <Text className={`badge${dashboard.pendingPlayerAdditions ? ' badge--danger' : ' badge--success'}`}>{dashboard.pendingPlayerAdditions}</Text>
          <Text className='admin-menu__chevron'>›</Text>
        </View>
      </View>
      {access.role === 'owner' ? <View className='card admin-menu__item' onClick={() => Taro.navigateTo({ url: '/pages/admin/media-approvals' })}>
        <View className='admin-menu__main'>
          <Text className='admin-menu__title'>图片审批</Text>
          <Text className='admin-menu__meta'>队长预览头像和照片后执行通过或驳回</Text>
        </View>
        <View className='admin-menu__side'>
          <Text className={`badge${dashboard.pendingMedia ? ' badge--danger' : ' badge--success'}`}>{dashboard.pendingMedia}</Text>
          <Text className='admin-menu__chevron'>›</Text>
        </View>
      </View> : null}
    </View>
  </PageShell>
}
