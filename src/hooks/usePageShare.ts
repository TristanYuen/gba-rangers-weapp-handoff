import { useShareAppMessage } from '@tarojs/taro'

interface PageShareOptions {
  title: string
  path: string
}

export function usePageShare({ title, path }: PageShareOptions) {
  useShareAppMessage(() => ({ title, path }))
}
