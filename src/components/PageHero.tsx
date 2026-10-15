import type { PropsWithChildren } from 'react'
import { View, Text } from '@tarojs/components'

interface Props extends PropsWithChildren {
  eyebrow: string
  title: string
  subtitle?: string
  midnight?: boolean
  brand?: boolean
}

export const PageHero = ({ eyebrow, title, subtitle, midnight, brand, children }: Props) => (
  <View className={`hero${midnight ? ' hero--midnight' : ''}${brand ? ' hero--branded' : ''}`}>
    <View className='hero__content'>
      <Text className='hero__eyebrow'>{eyebrow}</Text>
      <Text className='hero__title'>{title}</Text>
      {subtitle ? <Text className='hero__subtitle'>{subtitle}</Text> : null}
      {children ? <View className='hero__actions'>{children}</View> : null}
    </View>
    {brand ? <View className='hero__brand' aria-label='大湾区流浪者 Logo'><View className='hero__brand-mark' /></View> : null}
  </View>
)
