import { useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { View, Text, Button, Image } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { MediaAsset } from '@/domain/types'
import { appService } from '@/services'
import { formatBeijingTime } from '@/utils/date'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

export default function MediaApprovalsPage() {
  usePageShare({ title: '大湾区流浪者｜照片审批', path: '/pages/admin/media-approvals' })
  const access = appService.getAccess()
  const [media, setMedia] = useState<MediaAsset[]>([])

  const loadMedia = async () => {
    if (access.role !== 'owner') return
    try {
      if (cloudbaseEnabled) await syncCloudState(localStore)
      setMedia(appService.getMedia().filter((asset) => asset.reviewStatus === 'pending_review'))
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '照片审批加载失败', icon: 'none' })
    }
  }

  useDidShow(() => {
    void loadMedia()
  })

  if (access.role !== 'owner') {
    return <PageShell className='content'><View className='notice notice--danger'>只有队长可以审批图片。</View></PageShell>
  }

  const preview = (asset: MediaAsset) => {
    const urls = media.map((item) => item.fileUrl)
    Taro.previewImage({ current: asset.fileUrl, urls })
  }

  const review = async (asset: MediaAsset, approved: boolean) => {
    try {
      await appService.reviewMedia(
        asset.id,
        approved ? 'approved' : 'rejected',
        approved ? undefined : '画面不适合公开展示'
      )
      setMedia((current) => current.filter((item) => item.id !== asset.id))
      Taro.showToast({ title: approved ? '照片已通过' : '照片已驳回', icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '照片审批失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='MEDIA REVIEW' title='照片审批' subtitle={`待处理 ${media.length} 张`} midnight />
    <View className='content stack'>
      {media.length ? media.map((asset) => <View className='card card__body media-review-card' key={asset.id}>
        <Image
          className='media-review-card__image'
          src={asset.thumbnailUrl || asset.fileUrl}
          mode='aspectFill'
          onClick={() => preview(asset)}
        />
        <View className='media-review-card__content'>
          <View className='approval-card__header'>
            <View>
              <Text className='approval-card__title'>{asset.mediaPurpose === 'player_avatar' ? '球员头像' : asset.matchId ? '赛事照片' : '个人照片'}</Text>
              <Text className='approval-card__meta'>{formatBeijingTime(asset.createdAt)}</Text>
            </View>
            <Text className='badge badge--warning'>待队长审批</Text>
          </View>
          <Text className='media-review-card__preview' onClick={() => preview(asset)}>点击照片查看大图</Text>
          <View className='grid-2 approval-card__actions'>
            <Button className='button button--danger' onClick={() => void review(asset, false)}>驳回</Button>
            <Button className='button button--primary' onClick={() => void review(asset, true)}>通过</Button>
          </View>
        </View>
      </View>) : <View className='card card__body empty-state'>
        <Text className='empty-state__title'>照片审批已处理完</Text>
        <Text className='empty-state__meta'>新上传的待审照片会显示在这里。</Text>
      </View>}
    </View>
  </PageShell>
}
