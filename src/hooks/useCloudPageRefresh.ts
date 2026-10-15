import { useCallback, useEffect, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { cloudbaseEnabled } from '@/services/cloudService'
import { syncCloudState } from '@/services/cloudStore'
import { localStore } from '@/services/localStore'

interface CloudPageRefreshOptions {
  intervalMs?: number
  onSynced?: () => void
}

export const useCloudPageRefresh = ({ intervalMs = 8000, onSynced }: CloudPageRefreshOptions = {}) => {
  const [syncError, setSyncError] = useState('')
  const [lastSyncedAt, setLastSyncedAt] = useState<number>()
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const activeRef = useRef(false)
  const onSyncedRef = useRef(onSynced)
  onSyncedRef.current = onSynced

  const refresh = useCallback(async (showFailure = false) => {
    if (!cloudbaseEnabled) return true
    try {
      await syncCloudState(localStore)
      setSyncError('')
      setLastSyncedAt(Date.now())
      onSyncedRef.current?.()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : '云端同步失败'
      setSyncError(message)
      if (showFailure) Taro.showToast({ title: message, icon: 'none' })
      return false
    }
  }, [])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const stopPolling = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = undefined
  }
  const startPolling = () => {
    stopPolling()
    if (!cloudbaseEnabled || intervalMs <= 0) return
    timerRef.current = setInterval(() => {
      if (activeRef.current) void refreshRef.current(false)
    }, intervalMs)
  }

  useDidShow(() => {
    activeRef.current = true
    void refreshRef.current(false)
    startPolling()
  })
  useDidHide(() => {
    activeRef.current = false
    stopPolling()
  })
  usePullDownRefresh(() => {
    void refreshRef.current(true).finally(() => Taro.stopPullDownRefresh())
  })
  useEffect(() => () => stopPolling(), [])

  return { syncError, lastSyncedAt, refresh }
}
