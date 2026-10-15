import { useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { View, Text, Button, Input, Textarea, Switch, Picker } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import type { JerseyRequirement, MatchFormat, MatchInternal } from '@/domain/types'
import { appService } from '@/services'
import { beijingDate } from '@/utils/date'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

const capacityOptions = [5, 7, 8, 11, 14, 16, 18, 22]
const formatOptions: Array<{ value: MatchFormat; label: string }> = [
  { value: '5-a-side', label: '5 人制' },
  { value: '7-a-side', label: '7 人制' },
  { value: '8-a-side', label: '8 人制' },
  { value: '11-a-side', label: '11 人制' },
  { value: 'custom', label: '其他赛制' }
]
const jerseyOptions: Array<{ value: JerseyRequirement; label: string }> = [
  { value: 'home', label: '主场球衣' },
  { value: 'away', label: '客场球衣' },
  { value: 'custom', label: '自定义' }
]

const emptyMatch = (): MatchInternal => ({
  id: `m-${Date.now()}`,
  title: '',
  opponent: '',
  eventType: 'versus',
  matchDate: beijingDate(),
  kickoffTime: '20:00',
  publicArea: '大湾区',
  format: '8-a-side',
  capacityEnabled: false,
  capacity: 14,
  jerseyRequirement: 'home',
  registrationDeadline: '',
  status: 'draft',
  homeScore: null,
  awayScore: null,
  countInStats: true,
  exactLocation: '',
  gatheringTime: '19:30'
})

export default function MatchEditPage() {
  const { params } = useRouter()
  usePageShare({ title: '大湾区流浪者｜赛事管理', path: `/pages/matches/edit${params.id ? `?id=${params.id}` : ''}` })
  const access = appService.getAccess()
  const source = params.id ? appService.getMatch(params.id) : emptyMatch()
  const [form, setForm] = useState<MatchInternal>('gatheringTime' in source ? { ...source } as MatchInternal : emptyMatch())
  const set = <K extends keyof MatchInternal>(key: K, value: MatchInternal[K]) => setForm((current) => ({ ...current, [key]: value }))
  const formatIndex = Math.max(0, formatOptions.findIndex((item) => item.value === form.format))
  const jerseyIndex = Math.max(0, jerseyOptions.findIndex((item) => item.value === form.jerseyRequirement))
  const capacityIndex = useMemo(() => {
    const index = capacityOptions.indexOf(form.capacity)
    return index >= 0 ? index : capacityOptions.indexOf(14)
  }, [form.capacity])

  const chooseLocation = async () => {
    try {
      const location = await Taro.chooseLocation({})
      setForm((current) => ({
        ...current,
        exactLocation: location.name || location.address || current.exactLocation,
        publicArea: location.address || current.publicArea,
        latitude: location.latitude,
        longitude: location.longitude
      }))
    } catch {
      Taro.showToast({ title: '已取消地图选点', icon: 'none' })
    }
  }

  const save = async (publish: boolean) => {
    if (!form.title.trim() || !form.matchDate || !form.kickoffTime || !form.exactLocation || !form.gatheringTime) {
      Taro.showToast({ title: '请填写标题、日期、时间和地点', icon: 'none' })
      return
    }
    try {
      await appService.saveMatch({ ...form, status: publish ? 'published' : 'draft' })
      Taro.showToast({ title: publish ? '赛事已发布' : '草稿已保存', icon: 'success' })
      setTimeout(() => Taro.navigateBack(), 500)
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '保存失败', icon: 'none' })
    }
  }

  const setStatus = async (status: MatchInternal['status'], title: string) => {
    try {
      await appService.updateMatchStatus(form.id, status)
      setForm((current) => ({ ...current, status, countInStats: status === 'cancelled' ? false : current.countInStats }))
      Taro.showToast({ title, icon: 'success' })
    } catch (error) {
      Taro.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' })
    }
  }

  if (!access.canManage) {
    return <PageShell className='content'><View className='notice notice--danger'>只有队长或管理员可以创建和编辑赛事。</View></PageShell>
  }

  return (
    <PageShell>
      <PageHero eyebrow='MATCH CONTROL' title={params.id ? '编辑赛事' : '创建赛事'} />
      <View className='content stack'>
        <View className='card form-card'>
          <Text className='form-section-title'>赛事信息</Text>
          <View className='field'>
            <Text className='field__label'>赛事标题／对手</Text>
            <Input className='field__input' value={form.title} onInput={(event) => set('title', event.detail.value)} placeholder='例如：GBA RANGERS VS 南城联' />
          </View>
          <View className='grid-2'>
            <View className='field'>
              <Text className='field__label'>比赛日期</Text>
              <Picker mode='date' value={form.matchDate} start={beijingDate()} onChange={(event) => set('matchDate', event.detail.value)}>
                <View className='picker-value picker-value--full'>{form.matchDate}</View>
              </Picker>
            </View>
            <View className='field'>
              <Text className='field__label'>开球时间</Text>
              <Picker mode='time' value={form.kickoffTime || '20:00'} onChange={(event) => set('kickoffTime', event.detail.value)}>
                <View className='picker-value picker-value--full'>{form.kickoffTime}</View>
              </Picker>
            </View>
          </View>
          <View className='grid-2'>
            <View className='field'>
              <Text className='field__label'>集合时间</Text>
              <Picker mode='time' value={form.gatheringTime} onChange={(event) => set('gatheringTime', event.detail.value)}>
                <View className='picker-value picker-value--full'>{form.gatheringTime}</View>
              </Picker>
            </View>
            <View className='field'>
              <Text className='field__label'>比赛赛制</Text>
              <Picker mode='selector' range={formatOptions.map((item) => item.label)} value={formatIndex} onChange={(event) => set('format', formatOptions[Number(event.detail.value)]?.value || '8-a-side')}>
                <View className='picker-value picker-value--full'>{formatOptions[formatIndex]?.label}</View>
              </Picker>
            </View>
          </View>
        </View>

        <View className='card form-card'>
          <Text className='form-section-title'>地点与装备</Text>
          <View className='field'>
            <Text className='field__label'>比赛地点</Text>
            <View className='location-field'>
              <View className='field__input location-field__value'>{form.exactLocation || '尚未选择地点'}</View>
              <Button className='button button--light button--small' onClick={chooseLocation}>地图选点</Button>
            </View>
          </View>
          <View className='field'>
            <Text className='field__label'>球衣要求</Text>
            <Picker mode='selector' range={jerseyOptions.map((item) => item.label)} value={jerseyIndex} onChange={(event) => set('jerseyRequirement', jerseyOptions[Number(event.detail.value)]?.value || 'home')}>
              <View className='picker-value picker-value--full'>{jerseyOptions[jerseyIndex]?.label}</View>
            </Picker>
          </View>
          {form.jerseyRequirement === 'custom' ? <View className='field'>
            <Text className='field__label'>球衣补充说明</Text>
            <Input className='field__input' value={form.jerseyCustomNote} onInput={(event) => set('jerseyCustomNote', event.detail.value)} placeholder='填写颜色或搭配要求' />
          </View> : null}
        </View>

        <View className='card form-card'>
          <Text className='form-section-title'>报名规则</Text>
          <View className='list-row'>
            <View className='list-row__main'>
              <Text className='list-row__title'>限制报名人数</Text>
            </View>
            <Switch checked={Boolean(form.capacityEnabled)} color='#123BB4' onChange={(event) => set('capacityEnabled', event.detail.value)} />
          </View>
          {form.capacityEnabled ? <View className='field field--spaced'>
            <Text className='field__label'>人数上限</Text>
            <Picker mode='selector' range={capacityOptions.map((value) => `${value} 人`)} value={capacityIndex} onChange={(event) => set('capacity', capacityOptions[Number(event.detail.value)] || 14)}>
              <View className='picker-value picker-value--full'>{form.capacity} 人</View>
            </Picker>
          </View> : null}
          <View className='list-row'>
            <View className='list-row__main'>
              <Text className='list-row__title'>计入统计</Text>
            </View>
            <Switch checked={form.countInStats} color='#123BB4' onChange={(event) => set('countInStats', event.detail.value)} />
          </View>
        </View>

        <View className='card form-card'>
          <Text className='form-section-title'>赛事备注</Text>
          <View className='field'>
            <Text className='field__label'>公开备注</Text>
            <Textarea className='field__input field__textarea' value={form.internalNote} onInput={(event) => set('internalNote', event.detail.value)} placeholder='填写场地联系人、费用或临时安排' />
          </View>
        </View>

        <View className='grid-2'>
          <Button className='button button--light' onClick={() => save(false)}>保存草稿</Button>
          <Button className='button button--primary' onClick={() => save(true)}>发布赛事</Button>
        </View>
        {params.id ? <View className='grid-2'>
          <Button className='button button--light' onClick={() => setStatus('registration_closed', '报名已截止')}>截止报名</Button>
          <Button className='button button--danger' onClick={() => setStatus('cancelled', '赛事已取消')}>取消赛事</Button>
        </View> : null}
      </View>
    </PageShell>
  )
}
