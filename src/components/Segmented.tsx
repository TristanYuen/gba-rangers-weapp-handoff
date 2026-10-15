import { View, Text } from '@tarojs/components'

export interface Segment<T extends string> { label: string; value: T }

export function Segmented<T extends string>({ items, value, onChange }: { items: Segment<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <View className='segmented'>
      {items.map((item) => (
        <Text key={item.value} className={`segmented__item${item.value === value ? ' segmented__item--active' : ''}`} onClick={() => onChange(item.value)}>
          {item.label}
        </Text>
      ))}
    </View>
  )
}
