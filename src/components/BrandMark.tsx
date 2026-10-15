import { View, Text } from '@tarojs/components'

export const BrandMark = () => (
  <View className='brand-lockup'>
    <View className='brand-mark' aria-label='GBA RANGERS Logo' />
    <View>
      <Text className='brand-lockup__name'>GBA{`\n`}RANGERS</Text>
      <Text className='brand-lockup__meta'>EST. GREATER BAY AREA</Text>
    </View>
  </View>
)
