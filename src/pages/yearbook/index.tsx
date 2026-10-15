import Taro from '@tarojs/taro'
import { View, Text } from '@tarojs/components'
import { PageHero } from '@/components/PageHero'
import { SectionHeading } from '@/components/SectionHeading'
import { appService } from '@/services'
import { usePageShare } from '@/hooks/usePageShare'
import { PageShell } from '@/components/PageShell'

export default function YearbookPage() {
  usePageShare({ title: '大湾区流浪者｜球队年鉴', path: '/pages/yearbook/index' })
  const entries = appService.getYearbook(2026)
  const home = appService.getHome()
  return <PageShell>
    <PageHero eyebrow='THE YEARBOOK' title='2026' subtitle={`${home.seasonStats.matches} MATCHES · ${home.seasonStats.apps} APPEARANCES`} midnight />
    <View className='content'>
      <SectionHeading eyebrow='LATEST CHAPTERS' title='赛事与球队生活' />
      {entries.map((entry, index) => <View key={entry.id} className={`card card__body ${index === 0 ? 'card--royal' : ''}`} style={{ marginBottom: '18px' }} onClick={() => Taro.navigateTo({ url: `/pages/yearbook/detail?id=${entry.id}` })}>
        <Text className='section-heading__eyebrow' style={index === 0 ? { color: '#9BC3FF' } : undefined}>{entry.date}</Text>
        <Text className='section-heading__title'>{entry.title}</Text>
        <Text className={index === 0 ? 'hero__subtitle' : 'muted'} style={{ display: 'block', marginTop: '12px' }}>{entry.summary}</Text>
      </View>)}
    </View>
  </PageShell>
}
