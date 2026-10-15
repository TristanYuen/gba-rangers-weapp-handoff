import type {
  AccessContext,
  FeeChangeRequest,
  FeePaymentRecord,
  FeePlan,
  ManagerOperationLog,
  MatchInternal,
  MatchStatRecord,
  MediaAsset,
  MembershipApplication,
  Player,
  PlayerAddRequest,
  PlayerFeeAssignment,
  Signup,
  TeamNotice,
  TeamRoleAssignment,
  YearbookEntry
} from '@/domain/types'
import type { LocalStore } from './localStore'
import { callCloudAction, uploadCloudFile } from './cloudService'

interface CloudSnapshot {
  access: Pick<AccessContext, 'role' | 'memberStatus' | 'membershipId' | 'teamId' | 'playerId'>
  matches: MatchInternal[]
  players: Player[]
  yearbook: YearbookEntry[]
  signups: Signup[]
  media: MediaAsset[]
  matchStats: MatchStatRecord[]
  notices: TeamNotice[]
  subscriptionEnabled?: boolean
  membershipApplications?: MembershipApplication[]
  teamRoles?: TeamRoleAssignment[]
  feePlans?: FeePlan[]
  feeAssignments?: PlayerFeeAssignment[]
  feePayments?: FeePaymentRecord[]
  feeChangeRequests?: FeeChangeRequest[]
  managerOperationLogs?: ManagerOperationLog[]
  playerAddRequests?: PlayerAddRequest[]
}

type CloudStoreTarget = LocalStore & {
  hydrateFromCloud(snapshot: CloudSnapshot): void
}

const normalizeCloudValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeCloudValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('$date' in record) return new Date(record.$date as string | number).toISOString()
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, normalizeCloudValue(item)]))
  }
  return value
}

const extensionOf = (filePath: string) => {
  const match = filePath.match(/\.([a-zA-Z0-9]{1,8})(?:\?.*)?$/)
  return match?.[1] ? match[1].toLowerCase() : 'jpg'
}

const cloudAssetPath = (teamId: string, filePath: string) =>
  `team-assets/${teamId}/${Date.now()}-${Math.random().toString(36).slice(2, 12)}.${extensionOf(filePath)}`

let cloudSyncInFlight: Promise<void> | null = null

export const syncCloudState = async (store: CloudStoreTarget) => {
  if (cloudSyncInFlight) return cloudSyncInFlight
  cloudSyncInFlight = (async () => {
    const raw = await callCloudAction<CloudSnapshot>('team', 'getSnapshot', {})
    const snapshot = normalizeCloudValue(raw) as CloudSnapshot
    if (snapshot.access?.memberStatus === 'approved' && !Array.isArray(snapshot.matchStats)) {
      throw new Error('云端快照没有返回赛后球员数据，请先更新team云函数。')
    }
    if (snapshot.access?.memberStatus === 'approved' && !Array.isArray(snapshot.yearbook)) {
      throw new Error('云端快照没有返回球队年鉴，请先更新team云函数。')
    }
    store.hydrateFromCloud(snapshot)
  })()
  try {
    await cloudSyncInFlight
  } finally {
    cloudSyncInFlight = null
  }
}

/**
 * 云端模式只在服务端写入成功后刷新本机缓存。所有页面仍可复用 LocalStore
 * 的读取和领域计算，跨设备共享数据以 CloudBase 为唯一准源。
 */
export const createCloudStore = (localStore: LocalStore): LocalStore => {
  const sync = () => syncCloudState(localStore as CloudStoreTarget)
  // 媒体记录已保存后，刷新失败不能回报为提交失败，避免重复上传。
  const syncSubmittedMedia = async () => {
    try {
      await sync()
    } catch (error) {
      console.error('图片已提交，云端列表刷新失败', error)
    }
  }


  return new Proxy(localStore, {
    get(store, property, receiver) {
      const value = Reflect.get(store, property, receiver)
      if (typeof value !== 'function') return value

      const remoteHandlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {
        async updateSignup(matchId, playerId, choice, pendingUntil, note, signupType, companionName) {
          await callCloudAction('match', 'updateSignup', { matchId, playerId, choice, pendingUntil, note, signupType, companionName })
          await sync()
          return store.getSignups(String(matchId))
        },
        async saveMatch(match) {
          const input = match as MatchInternal
          await callCloudAction('match', 'createOrUpdateMatch', {
            match: input,
            expectedVersion: (input as MatchInternal & { version?: number }).version
          })
          await sync()
          return store.getMatch(input.id)
        },
        async updateMatchStatus(matchId, status) {
          const current = store.getMatch(String(matchId)) as MatchInternal
          await callCloudAction('match', 'changeMatchStatus', {
            matchId,
            status,
            expectedVersion: (current as MatchInternal & { version?: number }).version
          })
          await sync()
          return store.getMatch(String(matchId))
        },
        async deleteMatch(matchId) {
          const current = store.getMatch(String(matchId)) as MatchInternal & { version?: number }
          await callCloudAction('match', 'deleteMatch', {
            matchId,
            expectedVersion: current.version
          })
          await sync()
          return true
        },
        async publishStats(matchId, rows, scores, expectedVersion) {
          const score = scores as { home: number | null; away: number | null }
          const current = store.getMatch(String(matchId)) as MatchInternal & { version?: number }
          await callCloudAction('stats', 'publishMatchStats', {
            matchId,
            rows,
            homeScore: score.home,
            awayScore: score.away,
            expectedVersion: expectedVersion ?? current.version
          })
          await sync()
          return store.getMatch(String(matchId))
        },
        async reviewSpecialSignup(signupId, approved) {
          const reviewed = await callCloudAction<{ matchId: string }>('match', 'reviewSpecialSignup', { signupId, approved })
          await sync()
          return store.getSignups(reviewed.matchId)
        },
        async reviewMedia(id, status, rejectReason) {
          await callCloudAction('media', 'reviewMedia', { id, status, rejectReason })
          await sync()
          return store.getMedia().find((item) => item.id === id)
        },
        async setMediaPresentation(id, values) {
          const presentation = values as { isCover?: boolean; isFeatured?: boolean; hidden?: boolean }
          await callCloudAction('media', 'reviewMedia', {
            id,
            status: presentation.hidden ? 'hidden' : 'approved',
            isCover: presentation.isCover,
            isFeatured: presentation.isFeatured
          })
          await sync()
          return store.getMedia().find((item) => item.id === id)
        },
        async updatePlayer(playerId, patch) {
          await callCloudAction('team', 'updatePlayer', { playerId, patch })
          await sync()
          return store.getPlayer(String(playerId))
        },
        async createPlayerRequest(input) {
          const saved = await callCloudAction<PlayerAddRequest>('team', 'createPlayerRequest', input)
          await sync()
          return normalizeCloudValue(saved)
        },
        async reviewPlayerAddRequest(id, approved) {
          const saved = await callCloudAction<PlayerAddRequest>('team', 'reviewPlayerRequest', { id, approved })
          await sync()
          return normalizeCloudValue(saved)
        },
        async updateYearbookEntry(id, patch) {
          await callCloudAction('team', 'updateYearbookEntry', { id, patch })
          await sync()
          return store.getYearbookEntry(String(id))
        },
        async createNotice(input) {
          const created = await callCloudAction<{ id: string }>('notifications', 'createNotice', input)
          await sync()
          return store.listNotices().find((notice) => notice.id === created.id)
        },
        async markNoticeRead(id) {
          await callCloudAction('notifications', 'markNoticeRead', { id })
          await sync()
        },
        async setFeePaymentStatus(input) {
          const saved = await callCloudAction<FeePaymentRecord>('fees', 'setPaymentStatus', input)
          await sync()
          return normalizeCloudValue(saved)
        },
        async updatePlayerFee(input) {
          const values = input as { playerId: string; effectiveFrom: string }
          await callCloudAction('fees', 'requestFeeChange', input)
          await sync()
          try {
            return store.getPlayerFeeProfile(values.playerId, values.effectiveFrom)
          } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'FEE_ASSIGNMENT_NOT_FOUND') return undefined
            throw error
          }
        },
        async reviewFeeChangeRequest(id, decision) {
          const saved = await callCloudAction<{ request: FeeChangeRequest }>('fees', 'reviewFeeChange', { id, decision })
          await sync()
          return normalizeCloudValue(saved.request)
        },
        async setPlayerAvatar(filePath) {
          const access = store.getAccess()
          if (!access.teamId || !access.playerId) throw new Error('当前身份尚未绑定球员')
          const fileId = await uploadCloudFile(String(filePath), cloudAssetPath(access.teamId, String(filePath)))
          await callCloudAction('media', 'uploadPlayerAvatar', { fileId, playerId: access.playerId, complianceAccepted: true })
          await syncSubmittedMedia()
          return store.getPlayer(access.playerId)
        },
        async setPlayerAvatarFor(playerId, filePath) {
          const access = store.getAccess()
          if (!access.teamId) throw new Error('当前身份尚未加入球队')
          const fileId = await uploadCloudFile(String(filePath), cloudAssetPath(access.teamId, String(filePath)))
          await callCloudAction('media', 'uploadPlayerAvatar', { fileId, playerId, complianceAccepted: true })
          await syncSubmittedMedia()
          return store.getPlayer(String(playerId))
        },
        async addLocalMedia(filePath, options) {
          const access = store.getAccess()
          if (!access.teamId) throw new Error('当前身份尚未加入球队')
          const fileId = await uploadCloudFile(String(filePath), cloudAssetPath(access.teamId, String(filePath)))
          const created = await callCloudAction<{ id: string }>('media', 'uploadMediaMeta', { fileId, ...(options as object), complianceAccepted: true })
          await syncSubmittedMedia()
          return store.getMedia().find((item) => item.id === created.id)
        },
        async setSubscriptionEnabled(enabled) {
          await callCloudAction('notifications', 'setNotificationPreference', { enabled })
          await sync()
          return Boolean(enabled)
        },
        async remindPendingSignup(matchId, playerId) {
          await callCloudAction('notifications', 'remindPendingSignup', { matchId, playerId })
          await sync()
        }
      }

      const handler = remoteHandlers[String(property)]
      if (handler) return (...args: unknown[]) => handler(...args)
      if (['requestJoin', 'reviewMembership', 'setAdministrator', 'setDemoRole'].includes(String(property))) {
        return () => {
          throw new Error('云端模式不允许使用本地演示操作')
        }
      }
      return (...args: unknown[]) => Reflect.apply(value, store, args)
    }
  })
}
