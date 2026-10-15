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

export default function MediaManagementPage() {
  usePageShare({ title: '大湾区流浪者｜照片管理', path: '/pages/admin/media' })
  const access = appService.getAccess()
  const [media, setMedia] = useState<MediaAsset[]>([])

  const loadMedia = async () => {
    if (!access.canManage) return
    try {
      if (cloudbaseEnabled) await syncCloudState(localStore)
      setMedia(appService.getMedia().filter((asset) => ['approved', 'hidden'].includes(asset.reviewStatus)))
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '照片管理加载失败', icon: 'none' })
    }
  }

  useDidShow(() => {
    void loadMedia()
  })

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>当前身份没有照片管理权限。</View></PageShell>
  }

  const preview = (asset: MediaAsset) => {
    const urls = media.map((item) => item.fileUrl)
    Taro.previewImage({ current: asset.fileUrl, urls })
  }

  const presentMedia = async (asset: MediaAsset, action: 'cover' | 'featured' | 'hidden') => {
    try {
      await appService.setMediaPresentation(
        asset.id,
        action === 'cover'
          ? { isCover: true }
          : action === 'featured'
            ? { isFeatured: true }
            : { hidden: true }
      )
      await loadMedia()
      Taro.showToast({
        title: action === 'cover' ? '已设为封面' : action === 'featured' ? '已设为精选' : '照片已隐藏',
        icon: 'success'
      })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '照片展示设置失败', icon: 'none' })
    }
  }

  return <PageShell>
    <PageHero eyebrow='MEDIA LIBRARY' title='照片管理' subtitle='已通过照片的展示设置' midnight />
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
              <Text className='approval-card__title'>{asset.matchId ? '赛事照片' : '个人照片'}</Text>
              <Text className='approval-card__meta'>{formatBeijingTime(asset.createdAt)}</Text>
            </View>
            <Text className={`badge ${asset.reviewStatus === 'hidden' ? 'badge--warning' : 'badge--success'}`}>{asset.reviewStatus === 'hidden' ? '已隐藏' : '已通过'}</Text>
          </View>
          {asset.reviewStatus === 'approved' ? <View className='toolbar'>
            <Button className='button button--small button--light' disabled={asset.isCover} onClick={() => void presentMedia(asset, 'cover')}>{asset.isCover ? '当前封面' : '设为封面'}</Button>
            <Button className='button button--small button--light' disabled={asset.isFeatured} onClick={() => void presentMedia(asset, 'featured')}>{asset.isFeatured ? '已精选' : '设为精选'}</Button>
            <Button className='button button--small button--danger' onClick={() => void presentMedia(asset, 'hidden')}>隐藏</Button>
          </View> : <Text className='media-review-card__preview'>照片已隐藏，记录继续保留。</Text>}
        </View>
      </View>) : <View className='card card__body empty-state'>
        <Text className='empty-state__title'>暂无可管理照片</Text>
        <Text className='empty-state__meta'>审批通过的照片会显示在这里。</Text>
      </View>}
    </View>
  </PageShell>
}
