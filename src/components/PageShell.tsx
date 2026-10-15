import type { PropsWithChildren } from 'react'
import { View } from '@tarojs/components'
import { IcpFooter } from './IcpFooter'

interface PageShellProps {
  className?: string
}

export const PageShell = ({ children, className = '' }: PropsWithChildren<PageShellProps>) => (
  <View className='page page-shell'>
    <View className={`page-shell__body ${className}`.trim()}>{children}</View>
    <IcpFooter />
  </View>
)
