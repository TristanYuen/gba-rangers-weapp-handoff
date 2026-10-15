export type Role = 'visitor' | 'player' | 'admin' | 'owner'
export type MemberStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended'
export type PlayerType = 'formal' | 'trial' | 'guest'
export type PlayerStatus = 'active' | 'alumni'
export type MatchStatus =
  | 'draft'
  | 'published'
  | 'registration_closed'
  | 'completed_pending_score'
  | 'completed'
  | 'cancelled'
export type SignupChoice = 'attending' | 'maybe' | 'absent'
export type SignupPlacement = 'confirmed' | 'waitlisted' | 'not_applicable'
export type SignupType = 'self' | 'trial_companion' | 'guest_companion'
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'
export type ReminderStatus = 'not_required' | 'scheduled' | 'sent' | 'cancelled'
export type MatchFormat = '5-a-side' | '7-a-side' | '8-a-side' | '11-a-side' | 'custom'
export type JerseyRequirement = 'home' | 'away' | 'custom'
export type NotificationType = 'match_signup' | 'signup_activity' | 'fee_due' | 'pending_confirmation'
export type NoticeAudience = 'all_members' | 'unregistered' | 'pending_players' | 'individual' | 'managers'
export type MediaReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'hidden'
export type LeaderboardMetric = 'apps' | 'goals' | 'assists'
export type FeePlanId =
  | 'dongguan'
  | 'non_dongguan'
  | 'student_high'
  | 'student_low'
  | 'overseas'
  | 'special_buffer'
  | 'medical'
  | 'staff_exempt'
  | 'goalkeeper_exempt'
  | 'temporary_exempt'
  | 'sponsor_exempt'
  | 'professional_exempt'
export type FeePlanCategory = 'standard' | 'temporary' | 'exempt'
export type FeeHolidayRule = 'keep_current' | 'dongguan_rate'
export type FeePaymentStatus = 'paid' | 'unpaid'
export type PlayerAddRequestStatus = 'pending' | 'approved' | 'rejected'

export interface PlayerStats {
  apps: number
  goals: number
  assists: number
}

export interface Player {
  id: string
  displayName: string
  sourceName: string
  memberType: PlayerType
  status: PlayerStatus
  shirtNumber?: number
  position?: string
  joinYear?: number
  leaveYear?: number
  legacySpecialAmount?: number
  legacyAmount?: number
  avatarUrl?: string
  publicAuthorized: boolean
  showAvatar: boolean
  showPhotos: boolean
  stats: PlayerStats
  seasonStats: PlayerStats
}

export interface PlayerAddRequest {
  id: string
  displayName: string
  shirtNumber: number
  position: string
  joinYear: number
  feePlanId?: FeePlanId
  status: PlayerAddRequestStatus
  requestedBy: string
  requestedAt: string
  reviewedBy?: string
  reviewedAt?: string
  playerId?: string
  version: number
}

export interface FeePlan {
  id: FeePlanId
  name: string
  monthlyAmount: number
  category: FeePlanCategory
  holidayRule: FeeHolidayRule
  description: string
  active: boolean
}

export interface PlayerFeeAssignment {
  id: string
  playerId: string
  feePlanId: FeePlanId
  effectiveFrom: string
  effectiveTo?: string
  paymentMethod?: '年付' | '月付'
  reason: string
  adjustedBy: string
  createdAt: string
}

export type FeeChangeRequestStatus = 'pending' | 'approved' | 'rejected'

export interface FeeChangeRequest {
  id: string
  playerId: string
  feePlanId: FeePlanId
  effectiveFrom: string
  effectiveTo?: string
  reason: string
  notify: boolean
  status: FeeChangeRequestStatus
  requestedBy: string
  requestedAt: string
  reviewedBy?: string
  reviewedAt?: string
}

export interface PlayerFeeProfile {
  playerId: string
  period: string
  basePlan: FeePlan
  billedPlan: FeePlan
  amountDue: number
  activeAssignment: PlayerFeeAssignment
  history: PlayerFeeAssignment[]
  holidayAdjusted: boolean
}

export interface PlayerFeeLedgerRow {
  playerId: string
  period: string
  player: Player
  status: 'configured' | 'pending'
  profile?: PlayerFeeProfile
}

export interface FeePaymentRecord {
  id: string
  playerId: string
  period: string
  amount: number
  status: FeePaymentStatus
  paidAt?: string
  updatedAt: string
  updatedBy: string
}

export interface MatchPublic {
  id: string
  title: string
  opponent?: string
  eventType: 'versus' | 'event'
  matchDate: string
  kickoffTime?: string
  publicArea?: string
  exactLocation: string
  latitude?: number
  longitude?: number
  format: MatchFormat
  capacityEnabled?: boolean
  capacity: number
  jerseyRequirement?: JerseyRequirement
  jerseyCustomNote?: string
  registrationDeadline?: string
  status: MatchStatus
  homeScore: number | null
  awayScore: number | null
  countInStats: boolean
  coverUrl?: string
  apps?: number
  goals?: number
  assists?: number
  registrationCount?: number
  internalNote?: string
}

export interface MatchInternal extends MatchPublic {
  gatheringTime: string
  kitNote?: string
}

export interface Signup {
  id: string
  matchId: string
  playerId: string
  choice: SignupChoice
  placement: SignupPlacement
  pendingUntil?: string
  note?: string
  signupType?: SignupType
  companionName?: string
  approvalStatus?: ApprovalStatus
  reminderStatus?: ReminderStatus
  reminderSentAt?: string
  createdAt?: string
  updatedAt: string
  version: number
}

export interface TeamNotice {
  id: string
  type: NotificationType
  title: string
  content: string
  audience: NoticeAudience
  matchId?: string
  targetPlayerId?: string
  targetPlayerIds?: string[]
  feePeriod?: string
  recipientDetails?: NoticeRecipientDetail[]
  feeAmount?: number
  dueAt?: string
  createdAt: string
  createdBy: string
  readBy: string[]
  delivery: {
    total: number
    delivered: number
    unavailable: number
  }
}

export interface NoticeRecipientDetail {
  playerId: string
  displayName: string
  feeAmount?: number
  content: string
  deliveryStatus?: 'delivered' | 'sent' | 'processing' | 'retrying' | 'pending' | 'failed' | 'unavailable'
}

export interface MembershipApplication {
  id: string
  displayName: string
  requestedAt: string
  status: 'pending' | 'approved' | 'rejected'
  role: Exclude<Role, 'visitor' | 'owner'>
  playerId?: string
  version: number
}

export interface ClaimablePlayer {
  id: string
  displayName: string
  shirtNumber?: number
  position?: string
}

export interface ClaimableRoster {
  team: {
    id: string
    name: string
  }
  players: ClaimablePlayer[]
}

export interface TeamMemberIdentity {
  id: string
  playerId: string
  displayName: string
  shirtNumber?: number
  role: Extract<Role, 'player' | 'admin' | 'owner'>
  status: 'pending' | 'approved'
  version: number
  requestedAt?: string
}

export interface MatchStatRecord extends MatchStatInput {
  matchId: string
}

export interface MatchStatInput {
  playerId: string
  played: boolean
  goals: number
  assists: number
  displayName?: string
  memberType?: PlayerType
}

export interface MediaAsset {
  id: string
  uploaderId: string
  mediaPurpose?: 'player_avatar' | 'gallery'
  complianceVersion?: string
  complianceAcceptedAt?: string
  playerId?: string
  matchId?: string
  fileUrl: string
  thumbnailUrl: string
  reviewStatus: MediaReviewStatus
  rejectReason?: string
  isCover: boolean
  isFeatured: boolean
  createdAt: string
}

export interface YearbookEntry {
  id: string
  year: number
  type: 'match' | 'team_activity'
  matchId?: string
  title: string
  date: string
  summary: string
  coverUrl?: string
  cloudAlbumUrl?: string
  cloudAlbumLabel?: string
  featured: boolean
  public: boolean
}

export interface AccessContext {
  role: Role
  memberStatus: MemberStatus
  membershipId?: string
  teamId?: string
  playerId?: string
  canManage: boolean
  canAppointAdmins: boolean
}

export interface TeamRoleAssignment {
  playerId: string
  role: Extract<Role, 'player' | 'admin' | 'owner'>
  updatedAt: string
  updatedBy: string
}

export interface PermissionAudit {
  id: string
  playerId: string
  beforeRole: TeamRoleAssignment['role']
  afterRole: TeamRoleAssignment['role']
  operatedBy: string
  createdAt: string
}

export interface ManagerOperationLog {
  id: string
  action: string
  summary: string
  note?: string
  signedBy: string
  createdAt: string
}

export interface HomeData {
  nextMatch?: MatchPublic
  season: number
  seasonStats: PlayerStats & { matches: number }
  latestMatches: MatchPublic[]
  featuredPlayers: Player[]
  featuredYearbook: YearbookEntry[]
}

export interface LeaderboardRow extends PlayerStats {
  playerId: string
  displayName: string
  memberType: PlayerType
  rank: number
}

export interface AdminDashboard {
  pendingMembers: number
  pendingPlayerAdditions: number
  pendingMedia: number
  migrationIssues: number
  draftMatches: number
  pendingSignupApprovals: number
  pendingFeeChanges: number
}

export interface ApiError {
  code: string
  message: string
  details?: unknown
}

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: ApiError; requestId: string }
