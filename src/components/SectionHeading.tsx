import { View, Text } from '@tarojs/components'

interface Props {
  eyebrow?: string
  title: string
  action?: string
  onAction?: () => void
}

export const SectionHeading = ({ eyebrow, title, action, onAction }: Props) => (
  <View className='section-heading'>
    <View>
      {eyebrow ? <Text className='section-heading__eyebrow'>{eyebrow}</Text> : null}
      <Text className='section-heading__title'>{title}</Text>
    </View>
    {action ? <Text className='section-heading__action' onClick={onAction}>{action}</Text> : null}
  </View>
)
