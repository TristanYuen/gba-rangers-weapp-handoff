import { describe, expect, it } from 'vitest'
import { DomainError } from '@/domain/errors'
import {
  buildLeaderboard,
  buildRosterText,
  isHistoricalMatch,
  recalculateSignupPlacements,
  resolveBilledFeePlan,
  sanitizePublicMatch,
  scoreLabel,
  shouldAutoCompleteMatch,
  validatePendingUntil,
  validateMatchStats
} from '@/domain/rules'
import type { FeePlan, MatchInternal, Player, Signup } from '@/domain/types'

const match: MatchInternal = {
  id: 'm1', title: 'GBA RANGERS VS 测试队', opponent: '测试队', eventType: 'versus', matchDate: '2026-07-23',
  kickoffTime: '20:00', publicArea: '大湾区', format: '7-a-side', capacity: 1, status: 'published', homeScore: null,
  awayScore: null, countInStats: true, exactLocation: '公开地址', gatheringTime: '19:30', internalNote: '内部备注'
}

const players: Player[] = [
  { id: 'p1', sourceName: '甲', displayName: '甲', memberType: 'formal', status: 'active', publicAuthorized: true, showAvatar: true, showPhotos: true, stats: { apps: 10, goals: 5, assists: 2 }, seasonStats: { apps: 10, goals: 5, assists: 2 } },
  { id: 'p2', sourceName: '乙', displayName: '乙', memberType: 'formal', status: 'active', publicAuthorized: true, showAvatar: true, showPhotos: true, stats: { apps: 8, goals: 5, assists: 3 }, seasonStats: { apps: 8, goals: 5, assists: 3 } },
  { id: 'p3', sourceName: '（试训）丙', displayName: '丙', memberType: 'trial', status: 'active', publicAuthorized: false, showAvatar: false, showPhotos: false, stats: { apps: 2, goals: 8, assists: 1 }, seasonStats: { apps: 2, goals: 8, assists: 1 } }
]

describe('赛事与权限规则', () => {
  it('公开赛事包含精确地点并隐藏队内字段', () => {
    const result = sanitizePublicMatch(match)
    expect(result.exactLocation).toBe('公开地址')
    expect(result).not.toHaveProperty('gatheringTime')
    expect(result.internalNote).toBe('内部备注')
  })

  it('空比分显示赛果待补', () => {
    expect(scoreLabel(match)).toBe('赛果待补')
  })

  it('开球超过24小时的进行中赛事需要自动归档', () => {
    const kickoff = new Date('2026-07-23T20:00:00+08:00').getTime()
    expect(shouldAutoCompleteMatch(match, kickoff + 24 * 60 * 60 * 1000)).toBe(true)
    expect(shouldAutoCompleteMatch(match, kickoff + 24 * 60 * 60 * 1000 - 1)).toBe(false)
    expect(shouldAutoCompleteMatch({ ...match, status: 'completed' }, Date.now())).toBe(false)
    expect(shouldAutoCompleteMatch({ ...match, kickoffTime: undefined }, Date.now())).toBe(false)
    expect(isHistoricalMatch('completed_pending_score')).toBe(true)
    expect(isHistoricalMatch('published')).toBe(false)
  })

  it('满员后的参加报名进入候补', () => {
    const signups: Signup[] = [
      { id: 's1', matchId: 'm1', playerId: 'p1', choice: 'attending', placement: 'not_applicable', updatedAt: '2026-01-01', version: 1 },
      { id: 's2', matchId: 'm1', playerId: 'p2', choice: 'attending', placement: 'not_applicable', updatedAt: '2026-01-02', version: 1 }
    ]
    const result = recalculateSignupPlacements(signups, 1)
    expect(result[0]?.placement).toBe('confirmed')
    expect(result[1]?.placement).toBe('waitlisted')
  })

  it('关闭人数限制后所有参加人员直接确认', () => {
    const signups: Signup[] = [
      { id: 's1', matchId: 'm1', playerId: 'p1', choice: 'attending', placement: 'not_applicable', updatedAt: '2026-01-01', version: 1 },
      { id: 's2', matchId: 'm1', playerId: 'p2', choice: 'attending', placement: 'not_applicable', updatedAt: '2026-01-02', version: 1 }
    ]
    expect(recalculateSignupPlacements(signups, 1, false).every((signup) => signup.placement === 'confirmed')).toBe(true)
  })

  it('待审核的特殊报名不会提前占用名额', () => {
    const signups: Signup[] = [
      { id: 's1', matchId: 'm1', playerId: 'p1', choice: 'attending', placement: 'not_applicable', approvalStatus: 'pending', signupType: 'trial_companion', updatedAt: '2026-01-01', version: 1 }
    ]
    expect(recalculateSignupPlacements(signups, 1)[0]?.placement).toBe('not_applicable')
  })

  it('待定必须选择有效且不晚于报名截止的时间', () => {
    const now = new Date('2026-07-25T12:00:00+08:00').getTime()
    expect(validatePendingUntil('2026-07-26T18:00:00+08:00', '2026-07-26T20:00:00+08:00', now)).toContain('18:00')
    expect(() => validatePendingUntil(undefined, '2026-07-26T20:00:00+08:00', now)).toThrow(/请选择/)
    expect(() => validatePendingUntil('2026-07-26T21:00:00+08:00', '2026-07-26T20:00:00+08:00', now)).toThrow(/不能晚于/)
  })

  it('更新报名不会改变原有排队顺序', () => {
    const signups: Signup[] = [
      { id: 's1', matchId: 'm1', playerId: 'p1', choice: 'attending', placement: 'not_applicable', createdAt: '2026-01-01', updatedAt: '2026-01-03', version: 2 },
      { id: 's2', matchId: 'm1', playerId: 'p2', choice: 'attending', placement: 'not_applicable', createdAt: '2026-01-02', updatedAt: '2026-01-02', version: 1 }
    ]
    const result = recalculateSignupPlacements(signups, 1)
    expect(result[0]?.playerId).toBe('p1')
    expect(result[0]?.placement).toBe('confirmed')
  })

  it('助攻超过进球时拒绝发布', () => {
    expect(() => validateMatchStats([{ playerId: 'p1', played: true, goals: 1, assists: 2 }])).toThrowError(DomainError)
  })

  it('未出场球员不能拥有 G/A', () => {
    expect(() => validateMatchStats([{ playerId: 'p1', played: false, goals: 1, assists: 0 }])).toThrowError(/未出场/)
  })
})

describe('榜单与名单', () => {
  it('正式射手榜同进球时较少出场优先', () => {
    const rows = buildLeaderboard(players, 'goals')
    expect(rows.map((row) => row.displayName)).toEqual(['乙', '甲'])
  })

  it('全部记录包含试训球员', () => {
    expect(buildLeaderboard(players, 'goals', true)[0]?.displayName).toBe('丙')
  })

  it('名单复制按参加和候补分组', () => {
    const signups: Signup[] = [
      { id: 's1', matchId: 'm1', playerId: 'p1', choice: 'attending', placement: 'confirmed', updatedAt: '', version: 1 },
      { id: 's2', matchId: 'm1', playerId: 'p2', choice: 'attending', placement: 'waitlisted', updatedAt: '', version: 1 }
    ]
    const text = buildRosterText(match, signups, players)
    expect(text).toContain('参加（1）')
    expect(text).toContain('候补（1）')
  })

  it('名单复制会带上球员报名备注', () => {
    const signups: Signup[] = [
      { id: 's1', matchId: 'm1', playerId: 'p1', choice: 'attending', placement: 'confirmed', note: '会晚到 10 分钟', updatedAt: '', version: 1 }
    ]
    expect(buildRosterText(match, signups, players)).toContain('［会晚到 10 分钟］')
  })
})

describe('会费规则', () => {
  const plans: FeePlan[] = [
    { id: 'dongguan', name: '在莞人士', monthlyAmount: 50, category: 'standard', holidayRule: 'keep_current', description: '', active: true },
    { id: 'non_dongguan', name: '非在莞人士', monthlyAmount: 40, category: 'standard', holidayRule: 'dongguan_rate', description: '', active: true },
    { id: 'student_low', name: '低出勤学生', monthlyAmount: 25, category: 'standard', holidayRule: 'dongguan_rate', description: '', active: true },
    { id: 'overseas', name: '留学人员', monthlyAmount: 10, category: 'standard', holidayRule: 'keep_current', description: '', active: true }
  ]

  it('学生在寒暑假月份自动执行在莞标准', () => {
    expect(resolveBilledFeePlan(plans[2]!, plans, '2026-07').id).toBe('dongguan')
  })

  it('留学人员在寒暑假保持原档次', () => {
    expect(resolveBilledFeePlan(plans[3]!, plans, '2026-07').id).toBe('overseas')
  })

  it('非在莞人士在寒暑假月份自动执行在莞标准', () => {
    expect(resolveBilledFeePlan(plans[1]!, plans, '2026-07').id).toBe('dongguan')
  })

  it('普通月份保持基础档次', () => {
    expect(resolveBilledFeePlan(plans[2]!, plans, '2026-06').id).toBe('student_low')
  })
})
