import Taro from '@tarojs/taro'
import { fixtureFeeAssignments, fixtureFeePayments, fixtureFeePlans, fixtureMatchStats, fixtureMatches, fixtureMedia, fixtureMembershipApplications, fixtureNotices, fixturePlayers, fixtureSignups, fixtureYearbook } from '@/data/fixtures'
import { DomainError } from '@/domain/errors'
import {
  buildLeaderboard,
  buildRosterText,
  canManage,
  isHistoricalMatch,
  matchStatusLabel,
  recalculateSignupPlacements,
  resolveBilledFeePlan,
  sanitizePublicMatch,
  shouldAutoCompleteMatch,
  validatePendingUntil,
  validateMatchStats
} from '@/domain/rules'
import type {
  AccessContext,
  AdminDashboard,
  FeePlan,
  FeePlanId,
  FeePaymentRecord,
  FeePaymentStatus,
  FeeChangeRequest,
  FeeChangeRequestStatus,
  HomeData,
  JerseyRequirement,
  LeaderboardMetric,
  LeaderboardRow,
  MatchInternal,
  MatchPublic,
  MatchStatRecord,
  MatchStatInput,
  MediaAsset,
  MembershipApplication,
  Player,
  PlayerAddRequest,
  PlayerFeeAssignment,
  PlayerFeeLedgerRow,
  PlayerFeeProfile,
  Role,
  Signup,
  SignupChoice,
  SignupType,
  TeamNotice,
  TeamRoleAssignment,
  PermissionAudit,
  ManagerOperationLog,
  NotificationType,
  NoticeAudience,
  YearbookEntry
} from '@/domain/types'
import { beijingPeriod } from '@/utils/date'

const STORAGE_KEY = 'gba-rangers-local-state-v2'
const DATASET_VERSION = '2026-09-20-excel-data-6'
const SETTINGS_VERSION = 1

const normalizeJerseyRequirement = (value: unknown): JerseyRequirement | undefined => {
  if (value === 'home' || value === 'away' || value === 'custom') return value
  if (value === 'dark') return 'away'
  if (value === 'royal_blue' || value === 'light') return 'home'
  return undefined
}

interface PersistedState {
  playerId?: string
  membershipId?: string
  teamId?: string
  datasetVersion: string
  settingsVersion: number
  role: Role
  memberStatus: AccessContext['memberStatus']
  signups: Signup[]
  media: MediaAsset[]
  membershipApplications: MembershipApplication[]
  matchStats: MatchStatRecord[]
  subscriptionEnabled: boolean
  notices: TeamNotice[]
  feePlans: FeePlan[]
  feeAssignments: PlayerFeeAssignment[]
  feePayments: FeePaymentRecord[]
  matches: MatchInternal[]
  teamRoles: TeamRoleAssignment[]
  permissionAudits: PermissionAudit[]
  playerAvatars: Record<string, string>
  playerOverrides: Record<string, Partial<Player>>
  feeChangeRequests: FeeChangeRequest[]
  managerOperationLogs: ManagerOperationLog[]
  playerAddRequests: PlayerAddRequest[]
}

type FeeChangeInput = {
  playerId: string
  feePlanId: FeePlanId
  effectiveFrom: string
  effectiveTo?: string
  reason: string
  notify?: boolean
}

const initialState = (): PersistedState => ({
  playerId: undefined,
  membershipId: undefined,
  teamId: undefined,
  datasetVersion: DATASET_VERSION,
  settingsVersion: SETTINGS_VERSION,
  role: 'visitor',
  memberStatus: 'none',
  signups: fixtureSignups,
  media: fixtureMedia,
  membershipApplications: fixtureMembershipApplications,
  matchStats: fixtureMatchStats,
  subscriptionEnabled: true,
  notices: fixtureNotices,
  feePlans: fixtureFeePlans,
  feeAssignments: fixtureFeeAssignments,
  feePayments: fixtureFeePayments,
  matches: fixtureMatches.map((match) => ({ ...match, capacityEnabled: match.capacityEnabled ?? true })),
  teamRoles: fixturePlayers.map((player) => ({
    playerId: player.id,
    role: player.id === 'p-huang' ? 'owner' : player.id === 'p-yin-weiming' ? 'admin' : 'player',
    updatedAt: '2026-07-23T00:00:00+08:00',
    updatedBy: '系统初始化'
  })),
  permissionAudits: [],
  playerAvatars: {},
  playerOverrides: {},
  feeChangeRequests: [],
  managerOperationLogs: [],
  playerAddRequests: []
})

const safeLoad = (): PersistedState => {
  try {
    const value = Taro.getStorageSync<PersistedState>(STORAGE_KEY)
    if (!value || !value.role) return initialState()
    const defaults = initialState()
    const rosterIsCurrent = value.datasetVersion === DATASET_VERSION
    const settingsAreCurrent = value.settingsVersion === SETTINGS_VERSION
    return {
      ...defaults,
      ...value,
      datasetVersion: DATASET_VERSION,
      settingsVersion: SETTINGS_VERSION,
      signups: value.signups ?? defaults.signups,
      media: value.media ?? defaults.media,
      membershipApplications: value.membershipApplications ?? defaults.membershipApplications,
      matchStats: rosterIsCurrent ? value.matchStats ?? defaults.matchStats : defaults.matchStats,
      subscriptionEnabled: settingsAreCurrent ? value.subscriptionEnabled ?? true : true,
      notices: value.notices ?? defaults.notices,
      feePlans: rosterIsCurrent ? value.feePlans ?? defaults.feePlans : defaults.feePlans,
      feeAssignments: rosterIsCurrent ? value.feeAssignments ?? defaults.feeAssignments : defaults.feeAssignments,
      feePayments: value.feePayments ?? defaults.feePayments,
      matches: (rosterIsCurrent ? value.matches ?? defaults.matches : defaults.matches).map((match) => ({
        ...match,
        jerseyRequirement: normalizeJerseyRequirement(match.jerseyRequirement)
      })),
      teamRoles: rosterIsCurrent ? value.teamRoles ?? defaults.teamRoles : defaults.teamRoles,
      permissionAudits: value.permissionAudits ?? defaults.permissionAudits,
      playerAvatars: value.playerAvatars ?? defaults.playerAvatars,
      playerOverrides: value.playerOverrides ?? defaults.playerOverrides,
      feeChangeRequests: value.feeChangeRequests ?? defaults.feeChangeRequests,
      managerOperationLogs: value.managerOperationLogs ?? defaults.managerOperationLogs,
      playerAddRequests: value.playerAddRequests ?? defaults.playerAddRequests
    }
  } catch {
    return initialState()
  }
}

export class LocalStore {
  private state = safeLoad()
  private cloudAuthoritative = false
  private matches: MatchInternal[] = this.state.matches.map((match) => ({ ...match }))
  private players: Player[] = fixturePlayers.map((player) => ({
    ...player,
    ...this.state.playerOverrides[player.id],
    avatarUrl: this.state.playerAvatars[player.id] ?? this.state.playerOverrides[player.id]?.avatarUrl ?? player.avatarUrl
  }))
  private yearbook: YearbookEntry[] = fixtureYearbook.map((entry) => ({ ...entry }))

  private autoCompleteExpiredMatches(now = Date.now()): void {
    if (this.cloudAuthoritative) return
    const expired = this.matches.filter((match) => shouldAutoCompleteMatch(match, now))
    if (!expired.length) return
    for (const match of expired) {
      match.status = 'completed_pending_score'
      match.homeScore = null
      match.awayScore = null
    }
    this.syncMatches()
    this.persist()
  }

  /**
   * Replace the read cache with records returned by CloudBase.  Mutations still
   * go through the domain methods above so local and cloud modes share the same
   * validation rules.
   */
  hydrateFromCloud(snapshot: {
    access?: Pick<AccessContext, 'role' | 'memberStatus' | 'membershipId' | 'teamId' | 'playerId'>
    matches?: MatchInternal[]
    players?: Player[]
    yearbook?: YearbookEntry[]
    signups?: Signup[]
    media?: MediaAsset[]
    matchStats?: MatchStatRecord[]
    notices?: TeamNotice[]
    subscriptionEnabled?: boolean
    membershipApplications?: MembershipApplication[]
    teamRoles?: TeamRoleAssignment[]
    feePlans?: FeePlan[]
    feeAssignments?: PlayerFeeAssignment[]
    feePayments?: FeePaymentRecord[]
    feeChangeRequests?: FeeChangeRequest[]
    managerOperationLogs?: ManagerOperationLog[]
    playerAddRequests?: PlayerAddRequest[]
  }) {
    this.cloudAuthoritative = true
    if (snapshot.access) {
      this.state.role = snapshot.access.role
      this.state.memberStatus = snapshot.access.memberStatus
      this.state.membershipId = snapshot.access.membershipId
      this.state.teamId = snapshot.access.teamId
      this.state.playerId = snapshot.access.playerId
      if (snapshot.access.memberStatus !== 'approved') {
        this.matches = []
        this.players = []
        this.yearbook = []
        this.state.signups = []
        this.state.media = []
        this.state.notices = []
        this.state.membershipApplications = []
        this.state.teamRoles = []
        this.state.feePlans = []
        this.state.feeAssignments = []
        this.state.feePayments = []
        this.state.feeChangeRequests = []
        this.state.managerOperationLogs = []
        this.state.playerAddRequests = []
      }
    }
    if (snapshot.matches) this.matches = snapshot.matches.map((match) => ({ ...match }))
    if (snapshot.players) this.players = snapshot.players.map((player) => ({ ...player }))
    if (snapshot.yearbook) this.yearbook = snapshot.yearbook.map((entry) => ({ ...entry }))
    if (snapshot.signups) this.state.signups = snapshot.signups.map((signup) => ({ ...signup }))
    if (snapshot.media) this.state.media = snapshot.media.map((asset) => ({ ...asset }))
    if (snapshot.matchStats) this.state.matchStats = snapshot.matchStats.map((row) => ({ ...row }))
    if (snapshot.notices) this.state.notices = snapshot.notices.map((notice) => ({ ...notice }))
    if (snapshot.subscriptionEnabled !== undefined) this.state.subscriptionEnabled = snapshot.subscriptionEnabled
    if (snapshot.membershipApplications) this.state.membershipApplications = snapshot.membershipApplications.map((application) => ({ ...application }))
    if (snapshot.teamRoles) this.state.teamRoles = snapshot.teamRoles.map((assignment) => ({ ...assignment }))
    if (snapshot.feePlans) this.state.feePlans = snapshot.feePlans.map((plan) => ({ ...plan }))
    if (snapshot.feeAssignments) this.state.feeAssignments = snapshot.feeAssignments.map((assignment) => ({ ...assignment }))
    if (snapshot.feePayments) this.state.feePayments = snapshot.feePayments.map((payment) => ({ ...payment }))
    if (snapshot.feeChangeRequests) this.state.feeChangeRequests = snapshot.feeChangeRequests.map((request) => ({ ...request }))
    if (snapshot.managerOperationLogs) this.state.managerOperationLogs = snapshot.managerOperationLogs.map((log) => ({ ...log }))
    if (snapshot.playerAddRequests) this.state.playerAddRequests = snapshot.playerAddRequests.map((request) => ({ ...request }))
    this.syncMatches()
    this.persist()
  }

  private persist() {
    try {
      Taro.setStorageSync(STORAGE_KEY, this.state)
    } catch {
      // Web tests and restricted environments may not provide persistent storage.
    }
  }

  private managerSignature(): string {
    const access = this.getAccess()
    const player = access.playerId ? this.players.find((item) => item.id === access.playerId) : undefined
    const role = access.role === 'owner' ? '队长' : '管理员'
    return `${player?.displayName ?? role}（${role}）`
  }

  private recordManagerOperation(action: string, summary: string, note?: string): void {
    if (!canManage(this.state.role)) return
    this.state.managerOperationLogs.unshift({
      id: `manager-operation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      summary,
      note: note?.trim() || undefined,
      signedBy: this.managerSignature(),
      createdAt: new Date().toISOString()
    })
  }

  listManagerOperationLogs(): ManagerOperationLog[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有管理员和队长可以查看操作记录')
    return this.state.managerOperationLogs.map((item) => ({ ...item }))
  }

  getAccess(): AccessContext {
    const approved = this.state.memberStatus === 'approved'
    const playerId = this.state.playerId || (this.state.role === 'admin' ? 'p-yin-weiming' : 'p-huang')
    return {
      role: this.state.role,
      memberStatus: this.state.memberStatus,
      membershipId: this.state.membershipId,
      teamId: this.state.teamId,
      playerId: approved && this.state.role !== 'visitor' ? playerId : undefined,
      canManage: approved && canManage(this.state.role),
      canAppointAdmins: approved && this.state.role === 'owner'
    }
  }

  listTeamRoles(): TeamRoleAssignment[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有成员权限查看权限')
    return this.state.teamRoles.map((assignment) => ({ ...assignment }))
  }

  listPlayerAddRequests(status: PlayerAddRequest['status'] = 'pending'): PlayerAddRequest[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有新球员管理权限')
    return this.state.playerAddRequests
      .filter((request) => request.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map((request) => ({ ...request }))
  }

  createPlayerRequest(input: Pick<PlayerAddRequest, 'displayName' | 'shirtNumber' | 'position' | 'joinYear' | 'feePlanId'>): PlayerAddRequest {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以新增球员')
    const displayName = input.displayName.trim()
    const position = input.position.trim()
    if (!displayName || !position) throw new DomainError('INVALID_PLAYER', '请填写完整球员资料')
    if (!Number.isInteger(input.shirtNumber) || input.shirtNumber < 0 || input.shirtNumber > 999) {
      throw new DomainError('INVALID_SHIRT_NUMBER', '球衣号码应为 0 至 999 的整数')
    }
    if (!Number.isInteger(input.joinYear) || input.joinYear < 1900 || input.joinYear > 2100) {
      throw new DomainError('INVALID_JOIN_YEAR', '入队年份无效')
    }
    if (this.players.some((player) => player.status === 'active' && player.shirtNumber === input.shirtNumber)) {
      throw new DomainError('SHIRT_NUMBER_CONFLICT', '该号码已被现役球员使用')
    }
    if (this.state.playerAddRequests.some((request) => request.status === 'pending' && request.shirtNumber === input.shirtNumber)) {
      throw new DomainError('SHIRT_NUMBER_CONFLICT', '该号码已有待审核申请')
    }
    if (input.feePlanId && !this.state.feePlans.some((plan) => plan.id === input.feePlanId && plan.active)) {
      throw new DomainError('FEE_PLAN_NOT_FOUND', '会费类型不存在')
    }
    const now = new Date().toISOString()
    const request: PlayerAddRequest = {
      id: `player-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayName,
      shirtNumber: input.shirtNumber,
      position,
      joinYear: input.joinYear,
      feePlanId: input.feePlanId,
      status: this.state.role === 'owner' ? 'approved' : 'pending',
      requestedBy: this.managerSignature(),
      requestedAt: now,
      version: 1
    }
    if (request.status === 'approved') {
      const playerId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.players.push({
        id: playerId,
        displayName,
        sourceName: displayName,
        memberType: 'formal',
        status: 'active',
        shirtNumber: input.shirtNumber,
        position,
        joinYear: input.joinYear,
        publicAuthorized: true,
        showAvatar: true,
        showPhotos: true,
        stats: { apps: 0, goals: 0, assists: 0 },
        seasonStats: { apps: 0, goals: 0, assists: 0 }
      })
      request.playerId = playerId
      if (input.feePlanId) this.addInitialPlayerFeeAssignment(playerId, input.feePlanId)
      request.reviewedBy = this.managerSignature()
      request.reviewedAt = now
    }
    this.state.playerAddRequests.unshift(request)
    this.recordManagerOperation(request.status === 'approved' ? '新增球员' : '提交新球员', `${displayName} · ${input.shirtNumber} 号`)
    this.persist()
    return { ...request }
  }

  reviewPlayerAddRequest(id: string, approved: boolean): PlayerAddRequest {
    if (this.state.role !== 'owner') throw new DomainError('FORBIDDEN', '只有队长可以审核新球员')
    const request = this.state.playerAddRequests.find((item) => item.id === id)
    if (!request) throw new DomainError('PLAYER_ADD_REQUEST_NOT_FOUND', '新球员申请不存在')
    if (request.status !== 'pending') throw new DomainError('PLAYER_ADD_REQUEST_REVIEWED', '该申请已经处理')
    if (approved && this.players.some((player) => player.status === 'active' && player.shirtNumber === request.shirtNumber)) {
      throw new DomainError('SHIRT_NUMBER_CONFLICT', '该号码已被现役球员使用')
    }
    const now = new Date().toISOString()
    request.status = approved ? 'approved' : 'rejected'
    request.reviewedBy = this.managerSignature()
    request.reviewedAt = now
    request.version += 1
    if (approved) {
      const playerId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.players.push({
        id: playerId,
        displayName: request.displayName,
        sourceName: request.displayName,
        memberType: 'formal',
        status: 'active',
        shirtNumber: request.shirtNumber,
        position: request.position,
        joinYear: request.joinYear,
        publicAuthorized: true,
        showAvatar: true,
        showPhotos: true,
        stats: { apps: 0, goals: 0, assists: 0 },
        seasonStats: { apps: 0, goals: 0, assists: 0 }
      })
      request.playerId = playerId
      if (request.feePlanId) this.addInitialPlayerFeeAssignment(playerId, request.feePlanId)
    }
    this.recordManagerOperation('审核新球员', `${approved ? '通过' : '驳回'} ${request.displayName}`)
    this.persist()
    return { ...request }
  }

  setAdministrator(playerId: string, enabled: boolean): TeamRoleAssignment {
    if (this.state.role !== 'owner') throw new DomainError('FORBIDDEN', '只有队长可以任命或撤销管理员')
    if (!this.players.some((player) => player.id === playerId)) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    let assignment = this.state.teamRoles.find((item) => item.playerId === playerId)
    if (assignment?.role === 'owner') throw new DomainError('OWNER_PROTECTED', '队长身份不能在此处修改')
    const beforeRole = assignment?.role ?? 'player'
    const afterRole = enabled ? 'admin' : 'player'
    if (!assignment) {
      assignment = { playerId, role: afterRole, updatedAt: new Date().toISOString(), updatedBy: '队长' }
      this.state.teamRoles.push(assignment)
    } else {
      assignment.role = afterRole
      assignment.updatedAt = new Date().toISOString()
      assignment.updatedBy = '队长'
    }
    if (beforeRole !== afterRole) {
      this.state.permissionAudits.unshift({
        id: `permission-${Date.now()}-${playerId}`,
        playerId,
        beforeRole,
        afterRole,
        operatedBy: '队长',
        createdAt: new Date().toISOString()
      })
      const player = this.players.find((item) => item.id === playerId)
      this.recordManagerOperation('管理员任命', `${enabled ? '任命' : '撤销'} ${player?.displayName ?? playerId} 的管理员权限`)
    }
    this.persist()
    return { ...assignment }
  }

  listPermissionAudits(): PermissionAudit[] {
    if (this.state.role !== 'owner') throw new DomainError('FORBIDDEN', '只有队长可以查看权限变更记录')
    return this.state.permissionAudits.map((item) => ({ ...item }))
  }

  setDemoRole(role: Role): AccessContext {
    this.state.role = role
    this.state.memberStatus = role === 'visitor' ? 'none' : 'approved'
    this.state.playerId = role === 'admin' ? 'p-yin-weiming' : role === 'visitor' ? undefined : 'p-huang'
    this.persist()
    return this.getAccess()
  }

  requestJoin(inviteCode: string, displayName: string): AccessContext {
    if (inviteCode.trim().toUpperCase() !== 'GBA2026') throw new DomainError('INVALID_INVITE_CODE', '邀请码无效')
    if (!displayName.trim()) throw new DomainError('INVALID_NAME', '请填写申请人姓名')
    this.state.role = 'visitor'
    this.state.memberStatus = 'pending'
    if (!this.state.membershipApplications.some((application) => application.displayName === displayName.trim() && application.status === 'pending')) {
      this.state.membershipApplications.push({
        id: `join-${Date.now()}`,
        displayName: displayName.trim(),
        requestedAt: new Date().toISOString(),
        status: 'pending',
        role: 'player',
        version: 1
      })
    }
    this.persist()
    return this.getAccess()
  }

  getMembershipApplications(): MembershipApplication[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有成员审核权限')
    return [...this.state.membershipApplications].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  }

  reviewMembership(id: string, status: MembershipApplication['status'], playerId?: string): MembershipApplication {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有成员审核权限')
    const application = this.state.membershipApplications.find((item) => item.id === id)
    if (!application) throw new DomainError('MEMBERSHIP_NOT_FOUND', '成员申请不存在')
    if (status === 'approved' && !playerId) throw new DomainError('PLAYER_NOT_BOUND', '通过申请前需要绑定球员档案')
    application.status = status
    application.playerId = status === 'approved' ? playerId : undefined
    application.version += 1
    this.recordManagerOperation('成员审核', `${status === 'approved' ? '通过' : '拒绝'} ${application.displayName} 的加入申请`, playerId ? `绑定球员档案：${this.players.find((item) => item.id === playerId)?.displayName ?? playerId}` : undefined)
    this.persist()
    return { ...application }
  }

  getHome(): HomeData {
    this.autoCompleteExpiredMatches()
    const publicMatches = this.matches.map(sanitizePublicMatch)
    const nextMatch = publicMatches
      .filter((match) => match.status === 'published')
      .sort((a, b) => a.matchDate.localeCompare(b.matchDate))[0]
    const historical = publicMatches
      .filter((match) => match.status.startsWith('completed'))
      .sort((a, b) => b.matchDate.localeCompare(a.matchDate))
    const countedHistorical = historical.filter((match) => match.countInStats !== false)
    return {
      nextMatch,
      season: 2026,
      seasonStats: {
        matches: countedHistorical.length,
        apps: countedHistorical.reduce((sum, match) => sum + (match.apps ?? 0), 0),
        goals: countedHistorical.reduce((sum, match) => sum + (match.goals ?? 0), 0),
        assists: countedHistorical.reduce((sum, match) => sum + (match.assists ?? 0), 0)
      },
      latestMatches: historical.slice(0, 3),
      featuredPlayers: this.listPlayers().slice(0, 4),
      featuredYearbook: this.yearbook.filter((entry) => entry.featured && entry.public).slice(0, 3)
    }
  }

  listMatches(): MatchPublic[] {
    this.autoCompleteExpiredMatches()
    return this.matches.map(sanitizePublicMatch).sort((a, b) => b.matchDate.localeCompare(a.matchDate))
  }

  getMatch(id: string): MatchPublic | MatchInternal {
    this.autoCompleteExpiredMatches()
    const match = this.matches.find((item) => item.id === id)
    if (!match) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    if (this.state.memberStatus !== 'approved') return sanitizePublicMatch(match)
    return { ...match }
  }

  listMatchStats(matchId: string): MatchStatRecord[] {
    return this.state.matchStats.filter((row) => row.matchId === matchId).map((row) => ({ ...row }))
  }

  listPlayers(includeAll = false): Player[] {
    return this.players
      .filter((player) => includeAll || (player.memberType === 'formal' && player.publicAuthorized))
      .sort((a, b) => b.stats.apps - a.stats.apps || a.displayName.localeCompare(b.displayName, 'zh-CN'))
  }

  getPlayer(id: string): Player {
    const player = this.players.find((item) => item.id === id)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    return player
  }

  updatePlayer(
    playerId: string,
    patch: Partial<Pick<Player, 'displayName' | 'shirtNumber' | 'position' | 'joinYear' | 'leaveYear' | 'status' | 'showAvatar' | 'showPhotos'>>
  ): Player {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以修改球员资料')
    const player = this.players.find((item) => item.id === playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    if (patch.displayName !== undefined && !patch.displayName.trim()) throw new DomainError('INVALID_NAME', '球员姓名不能为空')
    if (patch.shirtNumber !== undefined && (!Number.isInteger(patch.shirtNumber) || patch.shirtNumber < 0 || patch.shirtNumber > 999)) {
      throw new DomainError('INVALID_SHIRT_NUMBER', '球衣号码应为 0 至 999 的整数')
    }
    const nextStatus = patch.status ?? player.status
    const nextShirtNumber = patch.shirtNumber ?? player.shirtNumber
    if (nextStatus === 'active' && nextShirtNumber !== undefined && this.players.some((item) =>
      item.id !== player.id && item.status === 'active' && item.shirtNumber === nextShirtNumber
    )) throw new DomainError('SHIRT_NUMBER_CONFLICT', '该号码已被现役球员使用')
    if (patch.joinYear !== undefined && (!Number.isInteger(patch.joinYear) || patch.joinYear < 1900 || patch.joinYear > 2100)) {
      throw new DomainError('INVALID_JOIN_YEAR', '开始效力年份无效')
    }
    if (patch.leaveYear !== undefined && (!Number.isInteger(patch.leaveYear) || patch.leaveYear < 1900 || patch.leaveYear > 2100)) {
      throw new DomainError('INVALID_LEAVE_YEAR', '结束效力年份无效')
    }
    if (patch.joinYear && patch.leaveYear && patch.leaveYear < patch.joinYear) {
      throw new DomainError('INVALID_SERVICE_YEARS', '结束效力年份不能早于开始年份')
    }
    const normalizedPatch = { ...patch }
    if (patch.displayName !== undefined) normalizedPatch.displayName = patch.displayName.trim()
    if (patch.position !== undefined) normalizedPatch.position = patch.position.trim() || undefined
    Object.assign(player, normalizedPatch)
    this.state.playerOverrides[playerId] = {
      ...this.state.playerOverrides[playerId],
      ...normalizedPatch
    }
    this.recordManagerOperation('球员资料', `更新 ${player.displayName} 的球员资料`)
    this.persist()
    return { ...player }
  }

  setPlayerAvatar(fileUrl: string): Player {
    const access = this.getAccess()
    if (access.memberStatus !== 'approved' || !access.playerId) {
      throw new DomainError('MEMBERS_ONLY', '仅审核通过的球队成员可以更新头像')
    }
    return this.setPlayerAvatarFor(access.playerId, fileUrl)
  }

  setPlayerAvatarFor(playerId: string, fileUrl: string): Player {
    const access = this.getAccess()
    const isSelf = access.memberStatus === 'approved' && access.playerId === playerId
    if (!isSelf && !access.canManage) {
      throw new DomainError('FORBIDDEN', '只有本人、队长或管理员可以更新头像')
    }
    if (!fileUrl.trim()) throw new DomainError('INVALID_AVATAR', '头像文件无效')
    const player = this.players.find((item) => item.id === playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    this.state.media.push({
      id: `avatar-${Date.now()}-${player.id}`,
      uploaderId: access.playerId ?? player.id,
      mediaPurpose: 'player_avatar',
      complianceVersion: '2026-08-01',
      complianceAcceptedAt: new Date().toISOString(),
      playerId: player.id,
      fileUrl,
      thumbnailUrl: fileUrl,
      reviewStatus: 'pending_review',
      isCover: false,
      isFeatured: false,
      createdAt: new Date().toISOString()
    })
    if (access.canManage && !isSelf) this.recordManagerOperation('球员头像', `提交 ${player.displayName} 的头像审批`)
    this.persist()
    return { ...player }
  }

  getFeePlans(): FeePlan[] {
    return this.state.feePlans.filter((plan) => plan.active).map((plan) => ({ ...plan }))
  }

  private addInitialPlayerFeeAssignment(playerId: string, feePlanId: FeePlanId): PlayerFeeAssignment {
    const plan = this.state.feePlans.find((item) => item.id === feePlanId && item.active)
    if (!plan) throw new DomainError('FEE_PLAN_NOT_FOUND', '会费类型不存在')
    const assignment: PlayerFeeAssignment = {
      id: `fee-initial-${Date.now()}-${playerId}`,
      playerId,
      feePlanId,
      effectiveFrom: beijingPeriod(),
      reason: '新增球员入册时设置',
      adjustedBy: this.managerSignature(),
      createdAt: new Date().toISOString()
    }
    this.state.feeAssignments.push(assignment)
    return assignment
  }

  canViewPlayerFee(playerId: string): boolean {
    const access = this.getAccess()
    return access.canManage || (access.memberStatus === 'approved' && access.playerId === playerId)
  }

  getPlayerFeeProfile(playerId: string, period = beijingPeriod()): PlayerFeeProfile {
    if (!this.canViewPlayerFee(playerId)) throw new DomainError('FORBIDDEN', '无权查看该球员的会费信息')
    const player = this.players.find((item) => item.id === playerId)
    if (!player) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    const history = this.state.feeAssignments
      .filter((assignment) => assignment.playerId === playerId)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt))
    const activeAssignment = history.find((assignment) =>
      assignment.effectiveFrom <= period && (!assignment.effectiveTo || assignment.effectiveTo >= period)
    )
    if (!activeAssignment) throw new DomainError('FEE_ASSIGNMENT_NOT_FOUND', '该球员尚未设置会费类型')
    const plans = this.getFeePlans()
    const basePlan = plans.find((plan) => plan.id === activeAssignment.feePlanId)
    if (!basePlan) throw new DomainError('FEE_PLAN_NOT_FOUND', '会费类型不存在')
    const billedPlan = resolveBilledFeePlan(basePlan, plans, period)
    return {
      playerId,
      period,
      basePlan,
      billedPlan,
      amountDue: billedPlan.monthlyAmount,
      activeAssignment: { ...activeAssignment },
      history: history.map((assignment) => ({ ...assignment })),
      holidayAdjusted: billedPlan.id !== basePlan.id
    }
  }

  listPlayerFeeProfiles(period = beijingPeriod()): Array<PlayerFeeProfile & { player: Player }> {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有会费管理权限')
    return this.players
      .filter((player) => player.memberType === 'formal' && player.status === 'active')
      .map((player) => {
        try {
          return { ...this.getPlayerFeeProfile(player.id, period), player: { ...player } }
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'FEE_ASSIGNMENT_NOT_FOUND') throw error
          return null
        }
      })
      .filter((profile): profile is PlayerFeeProfile & { player: Player } => Boolean(profile))
      .sort((a, b) => b.amountDue - a.amountDue || a.player.displayName.localeCompare(b.player.displayName, 'zh-CN'))
  }

  listPlayerFeeLedger(period = beijingPeriod()): PlayerFeeLedgerRow[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有会费管理权限')
    return this.players
      .filter((player) => player.memberType === 'formal' && player.status === 'active')
      .map((player): PlayerFeeLedgerRow => {
        try {
          return {
            playerId: player.id,
            period,
            player: { ...player },
            status: 'configured',
            profile: this.getPlayerFeeProfile(player.id, period)
          }
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'FEE_ASSIGNMENT_NOT_FOUND') throw error
          return { playerId: player.id, period, player: { ...player }, status: 'pending' }
        }
      })
      .sort((a, b) => (b.profile?.amountDue ?? -1) - (a.profile?.amountDue ?? -1) || a.player.displayName.localeCompare(b.player.displayName, 'zh-CN'))
  }

  listFeePayments(period: string): FeePaymentRecord[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有会费管理权限')
    if (!/^\d{4}-\d{2}$/.test(period)) throw new DomainError('INVALID_FEE_PERIOD', '请选择正确的会费月份')
    return this.state.feePayments
      .filter((record) => record.period === period)
      .map((record) => ({ ...record }))
  }

  setFeePaymentStatus(input: {
    playerId: string
    period: string
    amount: number
    status: FeePaymentStatus
  }): FeePaymentRecord {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以更新缴费状态')
    if (!this.players.some((player) => player.id === input.playerId)) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    if (!/^\d{4}-\d{2}$/.test(input.period)) throw new DomainError('INVALID_FEE_PERIOD', '请选择正确的会费月份')
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new DomainError('INVALID_FEE_AMOUNT', '会费金额无效')
    const now = new Date().toISOString()
    const existing = this.state.feePayments.find((record) =>
      record.playerId === input.playerId && record.period === input.period
    )
    const values = {
      amount: input.amount,
      status: input.status,
      paidAt: input.status === 'paid' ? existing?.paidAt ?? now : undefined,
      updatedAt: now,
      updatedBy: this.state.role === 'owner' ? '队长' : '管理员'
    }
    let saved: FeePaymentRecord
    if (existing) {
      Object.assign(existing, values)
      saved = existing
    } else {
      saved = {
        id: `fee-payment-${input.period}-${input.playerId}`,
        playerId: input.playerId,
        period: input.period,
        ...values
      }
      this.state.feePayments.push(saved)
    }
    const player = this.players.find((item) => item.id === input.playerId)
    this.recordManagerOperation('缴费状态', `将 ${player?.displayName ?? input.playerId} 标记为${input.status === 'paid' ? '已付' : '未付'}`, `${input.period} · ¥${input.amount}`)
    this.persist()
    return { ...saved }
  }

  private validateFeeChange(input: FeeChangeInput): FeePlan {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以调整会费')
    if (!this.players.some((player) => player.id === input.playerId)) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
    const plan = this.state.feePlans.find((item) => item.id === input.feePlanId && item.active)
    if (!plan) throw new DomainError('FEE_PLAN_NOT_FOUND', '会费类型不存在')
    if (!/^\d{4}-\d{2}$/.test(input.effectiveFrom)) throw new DomainError('INVALID_FEE_PERIOD', '请选择生效月份')
    if (input.effectiveTo && (!/^\d{4}-\d{2}$/.test(input.effectiveTo) || input.effectiveTo < input.effectiveFrom)) {
      throw new DomainError('INVALID_FEE_PERIOD', '结束月份不能早于生效月份')
    }
    if (!input.reason.trim()) throw new DomainError('FEE_REASON_REQUIRED', '请填写调整原因')
    return plan
  }

  private applyPlayerFeeChange(input: FeeChangeInput, adjustedBy: string): PlayerFeeProfile {
    const plan = this.state.feePlans.find((item) => item.id === input.feePlanId && item.active)
    if (!plan) throw new DomainError('FEE_PLAN_NOT_FOUND', '会费类型不存在')
    const assignment: PlayerFeeAssignment = {
      id: `fee-${Date.now()}`,
      playerId: input.playerId,
      feePlanId: input.feePlanId,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo || undefined,
      reason: input.reason.trim(),
      adjustedBy,
      createdAt: new Date().toISOString()
    }
    this.state.feeAssignments.push(assignment)
    if (input.notify) {
      const player = this.players.find((item) => item.id === input.playerId)!
      this.state.notices.unshift({
        id: `notice-fee-${Date.now()}`,
        type: 'fee_due',
        title: '个人会费类型已调整',
        content: `${player.displayName}的会费类型已调整为“${plan.name}”，自 ${input.effectiveFrom} 起生效。调整原因：${assignment.reason}`,
        audience: 'individual',
        targetPlayerId: input.playerId,
        feeAmount: plan.monthlyAmount,
        createdAt: new Date().toISOString(),
        createdBy: assignment.adjustedBy,
        readBy: [],
        delivery: { total: 1, delivered: this.state.subscriptionEnabled ? 1 : 0, unavailable: this.state.subscriptionEnabled ? 0 : 1 }
      })
    }
    const player = this.players.find((item) => item.id === input.playerId)
    this.recordManagerOperation('会费调整生效', `将 ${player?.displayName ?? input.playerId} 调整为${plan.name}`, `${input.effectiveFrom}${input.effectiveTo ? ` 至 ${input.effectiveTo}` : ' 起'} · ${input.reason.trim()}`)
    this.persist()
    return this.getPlayerFeeProfile(input.playerId, input.effectiveFrom)
  }

  updatePlayerFee(input: FeeChangeInput): PlayerFeeProfile | undefined {
    this.validateFeeChange(input)
    if (this.state.role === 'admin') {
      if (this.state.feeChangeRequests.some((request) => request.playerId === input.playerId && request.status === 'pending')) {
        throw new DomainError('FEE_CHANGE_PENDING', '该球员已有一条会费调整等待队长审核')
      }
      const now = new Date().toISOString()
      this.state.feeChangeRequests.unshift({
        id: `fee-change-${Date.now()}-${input.playerId}`,
        playerId: input.playerId,
        feePlanId: input.feePlanId,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo || undefined,
        reason: input.reason.trim(),
        notify: Boolean(input.notify),
        status: 'pending',
        requestedBy: '管理员',
        requestedAt: now
      })
      const player = this.players.find((item) => item.id === input.playerId)!
      this.state.notices.unshift({
        id: `notice-fee-review-${Date.now()}`,
        type: 'fee_due',
        title: '会费调整待队长审核',
        content: `管理员申请调整 ${player.displayName} 的会费档次，请队长前往会费管理确认。`,
        audience: 'managers',
        createdAt: now,
        createdBy: '管理员',
        readBy: [],
        delivery: { total: 1, delivered: this.state.subscriptionEnabled ? 1 : 0, unavailable: this.state.subscriptionEnabled ? 0 : 1 }
      })
      this.recordManagerOperation('提交会费调整', `申请调整 ${player.displayName} 的会费档次`, `${input.effectiveFrom}${input.effectiveTo ? ` 至 ${input.effectiveTo}` : ' 起'} · ${input.reason.trim()}`)
      this.persist()
      return undefined
    }
    return this.applyPlayerFeeChange(input, '队长')
  }

  listFeeChangeRequests(status: FeeChangeRequestStatus = 'pending'): FeeChangeRequest[] {
    if (this.state.role !== 'owner') throw new DomainError('FORBIDDEN', '只有队长可以查看会费调整审核')
    return this.state.feeChangeRequests
      .filter((request) => request.status === status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .map((request) => ({ ...request }))
  }

  reviewFeeChangeRequest(id: string, decision: Extract<FeeChangeRequestStatus, 'approved' | 'rejected'>): FeeChangeRequest {
    if (this.state.role !== 'owner') throw new DomainError('FORBIDDEN', '只有队长可以审核会费调整')
    const request = this.state.feeChangeRequests.find((item) => item.id === id)
    if (!request) throw new DomainError('FEE_CHANGE_NOT_FOUND', '会费调整申请不存在')
    if (request.status !== 'pending') throw new DomainError('FEE_CHANGE_REVIEWED', '该会费调整申请已经处理')
    request.status = decision
    request.reviewedBy = '队长'
    request.reviewedAt = new Date().toISOString()
    if (decision === 'approved') {
      this.applyPlayerFeeChange(request, `队长审核（${request.requestedBy}提交）`)
    } else {
      const player = this.players.find((item) => item.id === request.playerId)
      this.recordManagerOperation('审核会费调整', `驳回 ${player?.displayName ?? request.playerId} 的会费调整申请`, request.reason)
      this.persist()
    }
    return { ...request }
  }

  getLeaderboard(metric: LeaderboardMetric, includeAll = false): LeaderboardRow[] {
    return buildLeaderboard(this.players, metric, includeAll)
  }

  getYearbook(year = 2026): YearbookEntry[] {
    return this.yearbook.filter((entry) => entry.year === year && (entry.public || canManage(this.state.role))).sort((a, b) => b.date.localeCompare(a.date))
  }

  getYearbookEntry(id: string): YearbookEntry {
    const entry = this.yearbook.find((item) => item.id === id)
    if (!entry) throw new DomainError('YEARBOOK_NOT_FOUND', '年鉴章节不存在')
    if (!entry.public && !canManage(this.state.role)) throw new DomainError('YEARBOOK_NOT_FOUND', '年鉴章节不存在')
    return { ...entry }
  }

  updateYearbookEntry(id: string, patch: Partial<Pick<YearbookEntry, 'summary' | 'coverUrl' | 'cloudAlbumUrl' | 'cloudAlbumLabel' | 'featured' | 'public'>>): YearbookEntry {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有管理员可以编辑年鉴')
    const entry = this.yearbook.find((item) => item.id === id)
    if (!entry) throw new DomainError('YEARBOOK_NOT_FOUND', '年鉴章节不存在')
    Object.assign(entry, patch)
    return { ...entry }
  }

  getSignups(matchId: string): Signup[] {
    if (this.state.memberStatus !== 'approved') throw new DomainError('MEMBERS_ONLY', '仅审核通过的球队成员可以查看报名名单')
    this.processDuePendingReminders()
    return this.state.signups.filter((signup) => signup.matchId === matchId)
  }

  updateSignup(
    matchId: string,
    playerId: string,
    choice: SignupChoice,
    pendingUntil?: string,
    note?: string,
    signupType: SignupType = 'self',
    companionName?: string
  ): Signup[] {
    const match = this.matches.find((item) => item.id === matchId)
    if (!match) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    const deadlinePassed = match.registrationDeadline ? Date.now() > new Date(match.registrationDeadline).getTime() : false
    if ((match.status !== 'published' || deadlinePassed) && !canManage(this.state.role)) {
      throw new DomainError('REGISTRATION_CLOSED', '报名已经截止')
    }
    if (this.state.memberStatus !== 'approved') throw new DomainError('MEMBERS_ONLY', '仅审核通过的球队成员可以报名')
    if (choice === 'maybe') {
      validatePendingUntil(pendingUntil, match.registrationDeadline || `${match.matchDate}T${match.kickoffTime || '23:59'}:00+08:00`)
    }
    if (signupType !== 'self' && !companionName?.trim()) throw new DomainError('COMPANION_NAME_REQUIRED', '请填写同行人员姓名')
    const now = new Date().toISOString()
    const existing = this.state.signups.find((signup) => signup.matchId === matchId && signup.playerId === playerId)
    const previousChoice = existing?.choice
    const previousNote = existing?.note || ''
    if (existing) {
      existing.choice = choice
      existing.pendingUntil = choice === 'maybe' ? pendingUntil : undefined
      existing.note = note?.trim() || undefined
      existing.signupType = signupType
      existing.companionName = signupType === 'self' ? undefined : companionName?.trim()
      existing.approvalStatus = signupType === 'self' ? 'not_required' : 'pending'
      existing.reminderStatus = choice === 'maybe' ? 'scheduled' : existing.reminderStatus === 'sent' ? 'sent' : 'cancelled'
      existing.updatedAt = now
      existing.version += 1
    } else {
      this.state.signups.push({
        id: `${matchId}:${playerId}`,
        matchId,
        playerId,
        choice,
        pendingUntil: choice === 'maybe' ? pendingUntil : undefined,
        note: note?.trim() || undefined,
        signupType,
        companionName: signupType === 'self' ? undefined : companionName?.trim(),
        approvalStatus: signupType === 'self' ? 'not_required' : 'pending',
        reminderStatus: choice === 'maybe' ? 'scheduled' : 'not_required',
        placement: 'not_applicable',
        createdAt: now,
        updatedAt: now,
        version: 1
      })
    }
    const other = this.state.signups.filter((signup) => signup.matchId !== matchId)
    const current = recalculateSignupPlacements(
      this.state.signups.filter((signup) => signup.matchId === matchId),
      match.capacity,
      match.capacityEnabled !== false
    )
    this.state.signups = [...other, ...current]
    match.registrationCount = current.filter((signup) => signup.choice === 'attending' && signup.placement === 'confirmed').length
    if (!existing || previousChoice !== choice || previousNote !== (note?.trim() || '')) {
      const player = this.players.find((item) => item.id === playerId)
      const action = choice === 'attending' && previousChoice !== 'attending'
        ? '报名参加'
        : previousChoice === 'attending' && choice !== 'attending'
          ? '取消报名'
          : '更新报名状态'
      const choiceLabel = choice === 'attending' ? '参加' : choice === 'maybe' ? '待定' : '缺席'
      this.state.notices.unshift({
        id: `notice-signup-${Date.now()}`,
        type: 'signup_activity',
        title: `${player?.displayName || '球员'}${action}`,
        content: `${match.title} · 当前状态：${choiceLabel}${note?.trim() ? ` · 备注：${note.trim()}` : ''}`,
        audience: 'managers',
        matchId,
        createdAt: now,
        createdBy: player?.displayName || '球队成员',
        readBy: [],
        delivery: { total: 2, delivered: this.state.subscriptionEnabled ? 2 : 0, unavailable: this.state.subscriptionEnabled ? 0 : 2 }
      })
    }
    this.syncMatches()
    this.persist()
    return current
  }

  reviewSpecialSignup(signupId: string, approved: boolean): Signup[] {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以审核特殊报名')
    const signup = this.state.signups.find((item) => item.id === signupId)
    if (!signup) throw new DomainError('SIGNUP_NOT_FOUND', '报名记录不存在')
    if (!signup.signupType || signup.signupType === 'self') throw new DomainError('SIGNUP_NOT_REVIEWABLE', '该报名无需审核')
    signup.approvalStatus = approved ? 'approved' : 'rejected'
    signup.updatedAt = new Date().toISOString()
    signup.version += 1
    const match = this.matches.find((item) => item.id === signup.matchId)
    if (!match) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    const other = this.state.signups.filter((item) => item.matchId !== signup.matchId)
    const current = recalculateSignupPlacements(
      this.state.signups.filter((item) => item.matchId === signup.matchId),
      match.capacity,
      match.capacityEnabled !== false
    )
    this.state.signups = [...other, ...current]
    match.registrationCount = current.filter((item) => item.choice === 'attending' && item.placement === 'confirmed').length
    this.syncMatches()
    this.persist()
    return current
  }

  remindPendingSignup(matchId: string, playerId: string): TeamNotice {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以提醒待定人员')
    const signup = this.state.signups.find((item) => item.matchId === matchId && item.playerId === playerId && item.choice === 'maybe')
    if (!signup) throw new DomainError('PENDING_SIGNUP_NOT_FOUND', '该成员当前未处于待定状态')
    const match = this.matches.find((item) => item.id === matchId)
    const notice: TeamNotice = {
      id: `notice-pending-manual-${Date.now()}-${playerId}`,
      type: 'pending_confirmation',
      title: '请确认本场比赛是否参加',
      content: `${match?.title || '赛事'} · 你的状态仍为待定，请选择参加或缺席。`,
      audience: 'individual',
      matchId,
      targetPlayerId: playerId,
      dueAt: signup.pendingUntil,
      createdAt: new Date().toISOString(),
      createdBy: this.state.role === 'owner' ? '队长' : '管理员',
      readBy: [],
      delivery: { total: 1, delivered: this.state.subscriptionEnabled ? 1 : 0, unavailable: this.state.subscriptionEnabled ? 0 : 1 }
    }
    this.state.notices.unshift(notice)
    this.persist()
    return notice
  }

  private processDuePendingReminders(): void {
    if (this.cloudAuthoritative) return
    const now = Date.now()
    let changed = false
    for (const signup of this.state.signups) {
      if (
        signup.choice !== 'maybe' ||
        signup.reminderStatus === 'sent' ||
        signup.reminderStatus === 'cancelled' ||
        !signup.pendingUntil ||
        new Date(signup.pendingUntil).getTime() > now
      ) continue
      const match = this.matches.find((item) => item.id === signup.matchId)
      this.state.notices.unshift({
        id: `notice-pending-auto-${signup.id}-${Date.now()}`,
        type: 'pending_confirmation',
        title: '待定时间已到，请确认',
        content: `${match?.title || '赛事'} · 请尽快选择参加或缺席。`,
        audience: 'individual',
        matchId: signup.matchId,
        targetPlayerId: signup.playerId,
        dueAt: signup.pendingUntil,
        createdAt: new Date().toISOString(),
        createdBy: '自动提醒',
        readBy: [],
        delivery: { total: 1, delivered: this.state.subscriptionEnabled ? 1 : 0, unavailable: this.state.subscriptionEnabled ? 0 : 1 }
      })
      signup.reminderStatus = 'sent'
      signup.reminderSentAt = new Date().toISOString()
      changed = true
    }
    if (changed) this.persist()
  }

  private syncMatches(): void {
    this.state.matches = this.matches.map((match) => ({ ...match }))
  }

  rosterText(matchId: string): string {
    const match = this.getMatch(matchId)
    return buildRosterText(match, this.getSignups(matchId), this.players)
  }

  saveMatch(input: MatchInternal): MatchInternal {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有管理员可以维护赛事')
    const index = this.matches.findIndex((match) => match.id === input.id)
    if (index >= 0) this.matches[index] = { ...input }
    else this.matches.push({ ...input })
    this.syncMatches()
    this.recordManagerOperation(index >= 0 ? '编辑赛事' : '创建赛事', input.title, input.internalNote)
    this.persist()
    return input
  }

  deleteMatch(matchId: string): MatchInternal {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以删除历史赛事')
    this.autoCompleteExpiredMatches()
    const index = this.matches.findIndex((match) => match.id === matchId)
    if (index < 0) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    const match = this.matches[index]
    if (!match) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    if (!isHistoricalMatch(match.status)) throw new DomainError('MATCH_NOT_HISTORICAL', '只有历史赛事可以删除')

    this.matches.splice(index, 1)
    const removedStats = this.state.matchStats.filter((row) => row.matchId === matchId)
    this.state.matchStats = this.state.matchStats.filter((row) => row.matchId !== matchId)
    for (const row of removedStats) {
      const player = this.players.find((item) => item.id === row.playerId)
      if (!player) continue
      player.stats = {
        apps: Math.max(0, player.stats.apps - 1),
        goals: Math.max(0, player.stats.goals - row.goals),
        assists: Math.max(0, player.stats.assists - row.assists)
      }
      player.seasonStats = { ...player.stats }
    }
    this.state.signups = this.state.signups.filter((signup) => signup.matchId !== matchId)
    this.state.notices = this.state.notices.filter((notice) => notice.matchId !== matchId)
    this.yearbook = this.yearbook.filter((entry) => entry.matchId !== matchId)
    this.syncMatches()
    this.recordManagerOperation('删除赛事', match.title)
    this.persist()
    return { ...match }
  }

  updateMatchStatus(matchId: string, status: MatchInternal['status']): MatchInternal {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有管理员可以调整赛事状态')
    const match = this.matches.find((item) => item.id === matchId)
    if (!match) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    match.status = status
    if (status === 'cancelled') match.countInStats = false
    this.syncMatches()
    this.recordManagerOperation('赛事状态', `将 ${match.title} 更新为${matchStatusLabel(status)}`)
    this.persist()
    return { ...match }
  }

  publishStats(matchId: string, rows: MatchStatInput[], scores: { home: number | null; away: number | null }, _expectedVersion?: number): MatchPublic {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有管理员可以发布赛后数据')
    validateMatchStats(rows)
    if ((scores.home === null) !== (scores.away === null)) throw new DomainError('PARTIAL_SCORE', '两个比分必须同时填写或同时留空')
    if ([scores.home, scores.away].some((score) => score !== null && (!Number.isInteger(score) || score < 0))) {
      throw new DomainError('INVALID_SCORE', '比分必须是非负整数或留空')
    }
    const match = this.matches.find((item) => item.id === matchId)
    if (!match) throw new DomainError('MATCH_NOT_FOUND', '赛事不存在')
    const previous = this.state.matchStats.filter((row) => row.matchId === matchId)
    for (const player of this.players) {
      const before = previous.find((row) => row.playerId === player.id)
      const after = rows.find((row) => row.playerId === player.id)
      const appDelta = Number(Boolean(after?.played)) - Number(Boolean(before?.played))
      const goalDelta = (after?.goals ?? 0) - (before?.goals ?? 0)
      const assistDelta = (after?.assists ?? 0) - (before?.assists ?? 0)
      player.stats = {
        apps: Math.max(0, player.stats.apps + appDelta),
        goals: Math.max(0, player.stats.goals + goalDelta),
        assists: Math.max(0, player.stats.assists + assistDelta)
      }
      player.seasonStats = { ...player.stats }
    }
    this.state.matchStats = [
      ...this.state.matchStats.filter((row) => row.matchId !== matchId),
      ...rows.filter((row) => row.played).map((row) => ({ ...row, matchId }))
    ]
    match.apps = rows.filter((row) => row.played).length
    const personalGoals = rows.reduce((sum, row) => sum + row.goals, 0)
    match.goals = scores.home === null ? personalGoals : scores.home
    match.assists = rows.reduce((sum, row) => sum + row.assists, 0)
    match.homeScore = scores.home
    match.awayScore = scores.away
    match.status = scores.home === null ? 'completed_pending_score' : 'completed'
    const yearbookId = `y-${match.id}`
    const entry: YearbookEntry = {
      id: yearbookId,
      year: Number(match.matchDate.slice(0, 4)),
      type: match.eventType === 'event' ? 'team_activity' : 'match',
      matchId: match.id,
      title: match.title,
      date: match.matchDate,
      summary: `${match.apps} 人出场 · ${match.goals} 球 · ${match.assists} 助攻`,
      featured: false,
      public: true
    }
    const yearbookIndex = this.yearbook.findIndex((item) => item.id === yearbookId)
    if (yearbookIndex >= 0) this.yearbook[yearbookIndex] = { ...this.yearbook[yearbookIndex], ...entry }
    else this.yearbook.push(entry)
    this.syncMatches()
    this.recordManagerOperation('赛后录入', match.title, `${match.apps} 人出场 · ${match.goals} 球 · ${match.assists} 助攻`)
    this.persist()
    return sanitizePublicMatch(match)
  }

  getMedia(): MediaAsset[] {
    return [...this.state.media].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  reviewMedia(id: string, status: MediaAsset['reviewStatus'], rejectReason?: string): MediaAsset {
    if (this.state.role !== 'owner') throw new DomainError('FORBIDDEN', '只有队长可以审批图片')
    const asset = this.state.media.find((item) => item.id === id)
    if (!asset) throw new DomainError('MEDIA_NOT_FOUND', '照片不存在')
    asset.reviewStatus = status
    asset.rejectReason = rejectReason
    if (asset.mediaPurpose === 'player_avatar') {
      asset.isCover = status === 'approved'
      if (status === 'approved' && asset.playerId) {
        const player = this.players.find((item) => item.id === asset.playerId)
        if (!player) throw new DomainError('PLAYER_NOT_FOUND', '球员不存在')
        for (const item of this.state.media) {
          if (item.id !== asset.id && item.playerId === player.id && item.isCover) item.isCover = false
        }
        player.avatarUrl = asset.fileUrl
        player.showAvatar = true
        this.state.playerAvatars[player.id] = asset.fileUrl
        this.state.playerOverrides[player.id] = {
          ...this.state.playerOverrides[player.id],
          avatarUrl: asset.fileUrl,
          showAvatar: true
        }
      }
    }
    this.recordManagerOperation('图片审批', `${status === 'approved' ? '通过' : '驳回'}图片 ${id}`, rejectReason)
    this.persist()
    return asset
  }

  addLocalMedia(fileUrl: string, options: Pick<MediaAsset, 'playerId' | 'matchId'> = {}): MediaAsset {
    if (this.state.memberStatus !== 'approved') throw new DomainError('MEMBERS_ONLY', '仅审核通过的球队成员可以上传照片')
    const asset: MediaAsset = {
      id: `media-${Date.now()}`,
      uploaderId: this.getAccess().playerId ?? 'local-member',
      mediaPurpose: 'gallery',
      complianceVersion: '2026-08-01',
      complianceAcceptedAt: new Date().toISOString(),
      ...options,
      fileUrl,
      thumbnailUrl: fileUrl,
      reviewStatus: 'pending_review',
      isCover: false,
      isFeatured: false,
      createdAt: new Date().toISOString()
    }
    this.state.media.push(asset)
    this.persist()
    return asset
  }

  setMediaPresentation(id: string, values: { isCover?: boolean; isFeatured?: boolean; hidden?: boolean }): MediaAsset {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有管理员可以设置照片展示状态')
    const asset = this.state.media.find((item) => item.id === id)
    if (!asset) throw new DomainError('MEDIA_NOT_FOUND', '照片不存在')
    if (values.isCover && asset.matchId) {
      for (const item of this.state.media) if (item.matchId === asset.matchId) item.isCover = false
    }
    if (values.isCover !== undefined) asset.isCover = values.isCover
    if (values.isFeatured !== undefined) asset.isFeatured = values.isFeatured
    if (values.hidden) {
      asset.reviewStatus = 'hidden'
      if (asset.mediaPurpose === 'player_avatar' && asset.playerId) {
        const player = this.players.find((item) => item.id === asset.playerId)
        if (player?.avatarUrl === asset.fileUrl) {
          delete player.avatarUrl
          delete this.state.playerAvatars[player.id]
          this.state.playerOverrides[player.id] = {
            ...this.state.playerOverrides[player.id],
            avatarUrl: undefined
          }
        }
      }
    }
    this.recordManagerOperation('照片展示', `更新照片 ${id} 的展示状态`, values.hidden ? '隐藏照片' : values.isCover ? '设为封面' : values.isFeatured ? '设为精选' : undefined)
    this.persist()
    return { ...asset }
  }

  getSubscriptionEnabled(): boolean {
    return this.state.subscriptionEnabled
  }

  setSubscriptionEnabled(enabled: boolean): boolean {
    if (this.state.memberStatus !== 'approved') throw new DomainError('MEMBERS_ONLY', '仅审核通过的球队成员可以订阅赛事提醒')
    this.state.subscriptionEnabled = enabled
    this.persist()
    return enabled
  }

  listNotices(): TeamNotice[] {
    if (this.state.memberStatus !== 'approved') throw new DomainError('MEMBERS_ONLY', '审核通过后可查看球队通知')
    this.processDuePendingReminders()
    const playerId = this.getAccess().playerId
    return this.state.notices
      .filter((notice) =>
        (
          notice.audience !== 'individual' ||
          notice.targetPlayerId === playerId ||
          notice.targetPlayerIds?.includes(playerId ?? '') ||
          canManage(this.state.role)
        ) &&
        (notice.audience !== 'managers' || canManage(this.state.role))
      )
      .map((notice) => {
        if (canManage(this.state.role) || !playerId) return notice
        const detail = notice.recipientDetails?.find((item) => item.playerId === playerId)
        return detail ? { ...notice, content: detail.content } : notice
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  createNotice(input: {
    type: NotificationType
    title: string
    content: string
    audience: NoticeAudience
    matchId?: string
    targetPlayerId?: string
    targetPlayerIds?: string[]
    feePeriod?: string
    recipientDetails?: TeamNotice['recipientDetails']
    feeAmount?: number
    dueAt?: string
  }): TeamNotice {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '只有队长或管理员可以发布通知')
    if (!input.title.trim() || !input.content.trim()) throw new DomainError('INVALID_NOTICE', '请填写通知标题和内容')
    const targetPlayerIds = [...new Set(input.targetPlayerIds ?? (input.targetPlayerId ? [input.targetPlayerId] : []))]
    if (input.audience === 'individual' && !targetPlayerIds.length) {
      throw new DomainError('TARGET_PLAYER_REQUIRED', '请至少选择一名推送对象')
    }
    if (targetPlayerIds.some((id) => !this.players.some((player) => player.id === id && player.status === 'active'))) {
      throw new DomainError('TARGET_PLAYER_INVALID', '推送对象不属于当前球队')
    }
    const total = input.audience === 'individual'
      ? targetPlayerIds.length
      : input.audience === 'managers'
        ? 2
      : input.audience === 'pending_players'
      ? this.state.signups.filter((item) => item.matchId === input.matchId && item.choice === 'maybe').length
      : input.audience === 'unregistered'
        ? Math.max(0, this.players.filter((item) => item.status === 'active').length - this.state.signups.filter((item) => item.matchId === input.matchId).length)
        : this.players.filter((item) => item.status === 'active').length
    const notice: TeamNotice = {
      id: `notice-${Date.now()}`,
      ...input,
      targetPlayerIds: targetPlayerIds.length ? targetPlayerIds : undefined,
      recipientDetails: input.recipientDetails?.map((detail) => ({
        ...detail,
        deliveryStatus: this.state.subscriptionEnabled ? 'delivered' : 'unavailable'
      })),
      title: input.title.trim(),
      content: input.content.trim(),
      createdAt: new Date().toISOString(),
      createdBy: this.state.role === 'owner' ? '队长' : '管理员',
      readBy: [],
      delivery: {
        total,
        delivered: this.state.subscriptionEnabled ? total : 0,
        unavailable: this.state.subscriptionEnabled ? 0 : total
      }
    }
    this.state.notices.unshift(notice)
    this.recordManagerOperation('发布通知', notice.title, notice.content)
    this.persist()
    return notice
  }

  markNoticeRead(id: string): void {
    const notice = this.state.notices.find((item) => item.id === id)
    const playerId = this.getAccess().playerId
    if (notice && playerId && !notice.readBy.includes(playerId)) {
      notice.readBy.push(playerId)
      this.persist()
    }
  }

  getUnreadNoticeCount(): number {
    if (this.state.memberStatus !== 'approved') return 0
    const playerId = this.getAccess().playerId
    if (!playerId) return 0
    return this.listNotices().filter((notice) => !notice.readBy.includes(playerId)).length
  }

  getAdminDashboard(): AdminDashboard {
    if (!canManage(this.state.role)) throw new DomainError('FORBIDDEN', '没有管理权限')
    return {
      pendingMembers: this.state.membershipApplications.filter((application) => application.status === 'pending').length,
      pendingPlayerAdditions: this.state.playerAddRequests.filter((request) => request.status === 'pending').length,
      pendingMedia: this.state.role === 'owner'
        ? this.state.media.filter((asset) => asset.reviewStatus === 'pending_review').length
        : 0,
      migrationIssues: 2,
      draftMatches: this.matches.filter((match) => match.status === 'draft').length,
      pendingSignupApprovals: this.state.signups.filter((signup) => signup.approvalStatus === 'pending').length,
      pendingFeeChanges: this.state.feeChangeRequests.filter((request) => request.status === 'pending').length
    }
  }
}

export const localStore = new LocalStore()
