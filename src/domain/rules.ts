import { DomainError } from './errors'
import type {
  FeePlan,
  LeaderboardMetric,
  LeaderboardRow,
  MatchInternal,
  MatchPublic,
  MatchStatInput,
  Player,
  Role,
  Signup
} from './types'
import { formatBeijingTime } from '@/utils/date'

export const canManage = (role: Role) => role === 'admin' || role === 'owner'

export const canReadInternal = (role: Role) => role === 'player' || canManage(role)

export const MATCH_AUTO_HISTORY_DELAY_MS = 24 * 60 * 60 * 1000

export const isHistoricalMatch = (status: MatchPublic['status']): boolean =>
  ['completed', 'completed_pending_score', 'cancelled'].includes(status)

export const matchKickoffTimestamp = (match: Pick<MatchPublic, 'matchDate' | 'kickoffTime'>): number => {
  if (!match.matchDate || !match.kickoffTime) return Number.NaN
  return new Date(`${match.matchDate}T${match.kickoffTime}:00+08:00`).getTime()
}

export const shouldAutoCompleteMatch = (
  match: Pick<MatchPublic, 'matchDate' | 'kickoffTime' | 'status'>,
  now = Date.now()
): boolean => {
  if (!['published', 'registration_closed'].includes(match.status)) return false
  const kickoff = matchKickoffTimestamp(match)
  return Number.isFinite(kickoff) && kickoff + MATCH_AUTO_HISTORY_DELAY_MS <= now
}

export const resolveBilledFeePlan = (
  basePlan: FeePlan,
  plans: FeePlan[],
  period: string
): FeePlan => {
  const month = Number(period.slice(5, 7))
  const isHolidayMonth = [1, 7, 8].includes(month)
  if (!isHolidayMonth || basePlan.holidayRule !== 'dongguan_rate') return basePlan
  return plans.find((plan) => plan.id === 'dongguan') ?? basePlan
}

export const sanitizePublicMatch = (match: MatchInternal): MatchPublic => {
  const { gatheringTime: _gatheringTime, kitNote: _kitNote, ...publicMatch } = match
  return publicMatch
}

export const scoreLabel = (match: Pick<MatchPublic, 'homeScore' | 'awayScore' | 'status'>): string => {
  if (match.status === 'cancelled') return '已取消'
  if (match.homeScore === null || match.awayScore === null) return '赛果待补'
  return `${match.homeScore}:${match.awayScore}`
}

export const matchStatusLabel = (status: MatchPublic['status']): string => ({
  draft: '草稿',
  published: '报名中',
  registration_closed: '报名截止',
  completed_pending_score: '赛果待补',
  completed: '已结束',
  cancelled: '已取消'
}[status])

export const recalculateSignupPlacements = (signups: Signup[], capacity: number, capacityEnabled = true): Signup[] => {
  let confirmed = 0
  return [...signups]
    .sort((a, b) => (a.createdAt ?? a.updatedAt).localeCompare(b.createdAt ?? b.updatedAt))
    .map((signup) => {
      if (signup.choice !== 'attending' || signup.approvalStatus === 'pending' || signup.approvalStatus === 'rejected') {
        return { ...signup, placement: 'not_applicable' }
      }
      confirmed += 1
      return { ...signup, placement: !capacityEnabled || confirmed <= capacity ? 'confirmed' : 'waitlisted' }
    })
}

export const validatePendingUntil = (pendingUntil: string | undefined, latestAllowed: string, now = Date.now()): string => {
  if (!pendingUntil) throw new DomainError('PENDING_UNTIL_REQUIRED', '请选择待定截止时间')
  const pendingTime = new Date(pendingUntil).getTime()
  const latestTime = new Date(latestAllowed).getTime()
  if (!Number.isFinite(pendingTime) || pendingTime <= now) throw new DomainError('INVALID_PENDING_UNTIL', '待定时间必须晚于当前时间')
  if (!Number.isFinite(latestTime) || pendingTime > latestTime) throw new DomainError('INVALID_PENDING_UNTIL', '待定时间不能晚于报名截止时间')
  return pendingUntil
}

export const validateMatchStats = (rows: MatchStatInput[]): void => {
  for (const row of rows) {
    if (!Number.isInteger(row.goals) || !Number.isInteger(row.assists) || row.goals < 0 || row.assists < 0) {
      throw new DomainError('INVALID_STAT', '进球和助攻必须是非负整数', row)
    }
    if (!row.played && (row.goals > 0 || row.assists > 0)) {
      throw new DomainError('STAT_WITHOUT_APPEARANCE', '未出场球员不能录入进球或助攻', row)
    }
  }
  const goals = rows.reduce((sum, row) => sum + row.goals, 0)
  const assists = rows.reduce((sum, row) => sum + row.assists, 0)
  if (assists > goals) {
    throw new DomainError('ASSISTS_EXCEED_GOALS', '助攻总数不能高于球队进球总数', { goals, assists })
  }
}

export const buildLeaderboard = (
  players: Player[],
  metric: LeaderboardMetric,
  includeNonFormal = false
): LeaderboardRow[] => {
  const filtered = players.filter((player) => includeNonFormal || player.memberType === 'formal')
  const sorted = [...filtered].sort((a, b) => {
    const metricDiff = b.stats[metric] - a.stats[metric]
    if (metricDiff !== 0) return metricDiff
    if (metric !== 'apps') {
      const appsDiff = a.stats.apps - b.stats.apps
      if (appsDiff !== 0) return appsDiff
    }
    return a.displayName.localeCompare(b.displayName, 'zh-CN')
  })
  return sorted.map((player, index) => ({
    playerId: player.id,
    displayName: player.displayName,
    memberType: player.memberType,
    ...player.stats,
    rank: index + 1
  }))
}

export const buildRosterText = (
  match: MatchPublic,
  signups: Signup[],
  players: Player[]
): string => {
  const playerName = (id: string) => players.find((player) => player.id === id)?.displayName ?? '未知球员'
  const group = (title: string, predicate: (signup: Signup) => boolean, showPendingTime = false) => {
    const names = signups.filter(predicate).map((signup, index) => {
      const pending = showPendingTime && signup.pendingUntil ? `（待定至 ${formatBeijingTime(signup.pendingUntil, { short: true })}）` : ''
      const note = signup.note ? `［${signup.note}］` : ''
      return `${index + 1}. ${playerName(signup.playerId)}${pending}${note}`
    })
    return `${title}（${names.length}）\n${names.length ? names.join('\n') : '暂无'}`
  }
  return [
    `【GBA RANGERS】${match.title}`,
    `${match.matchDate}${match.kickoffTime ? ` ${match.kickoffTime}` : ''}`,
    match.publicArea ? `区域：${match.publicArea}` : '',
    '',
    group('参加', (signup) => signup.choice === 'attending' && signup.placement === 'confirmed'),
    '',
    group('候补', (signup) => signup.choice === 'attending' && signup.placement === 'waitlisted'),
    '',
    group('待定', (signup) => signup.choice === 'maybe', true),
    '',
    group('缺席', (signup) => signup.choice === 'absent')
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n')
}
