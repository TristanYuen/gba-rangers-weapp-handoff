import Taro from '@tarojs/taro'

const NAVIGATION_INTENT_KEY = 'gba-navigation-intent'

export type NavigationIntent = 'matches-history'

export const setNavigationIntent = (intent: NavigationIntent) => {
  Taro.setStorageSync(NAVIGATION_INTENT_KEY, intent)
}

export const consumeNavigationIntent = (intent: NavigationIntent): boolean => {
  const current = Taro.getStorageSync(NAVIGATION_INTENT_KEY)
  if (current !== intent) return false
  Taro.removeStorageSync(NAVIGATION_INTENT_KEY)
  return true
}
