import { describe, expect, it } from 'vitest'
import { fixtureFeeAssignments, fixtureFeePayments, fixtureFeePlans, fixtureMatchStats, fixtureMatches, fixturePlayers } from '@/data/fixtures'
import { resolveBilledFeePlan } from '@/domain/rules'

describe('2026-09-20人员、会费与比赛数据', () => {
  const activePlayers = fixturePlayers.filter((player) => player.status === 'active')
  const alumni = fixturePlayers.filter((player) => player.status === 'alumni')

  it('包含最新数据中的 52 名现役成员', () => {
    expect(activePlayers).toHaveLength(52)
    expect(new Set(activePlayers.map((player) => player.displayName)).size).toBe(52)
  })

  it('历史成员仅保留 7 号卢华杰', () => {
    expect(alumni.map((player) => ({
      displayName: player.displayName,
      shirtNumber: player.shirtNumber,
      legacySpecialAmount: player.legacySpecialAmount,
      legacyAmount: player.legacyAmount
    }))).toEqual([{ displayName: '卢华杰', shirtNumber: 7, legacySpecialAmount: 37263, legacyAmount: 197042.15 }])
  })

  it('52名现役成员都有会费档案', () => {
    const assignedIds = new Set(fixtureFeeAssignments.map((assignment) => assignment.playerId))
    expect(activePlayers.filter((player) => assignedIds.has(player.id))).toHaveLength(52)
    expect(activePlayers.filter((player) => !assignedIds.has(player.id))).toEqual([])
  })

  it('载入 7 月 19 日至 8 月 28 日的 9 场最新比赛', () => {
    expect(fixtureMatches.slice(-9).map((match) => [match.matchDate, match.opponent, match.homeScore, match.awayScore])).toEqual([
      ['2026-07-19', '广金', 4, 2], ['2026-07-22', '元银', 7, 5], ['2026-08-01', '瑞悟', 7, 6],
      ['2026-08-06', '蓝纯', 9, 5], ['2026-08-10', '聚乐部', 12, 7], ['2026-08-13', '落雨', 9, 5],
      ['2026-08-16', '骆绍菊', 4, 9], ['2026-08-21', '荣郡', 9, 4], ['2026-08-28', '东莞韩国人FC', 13, 5]
    ])
    expect(fixtureMatches.slice(-9).map((match) => [match.apps, match.goals, match.assists])).toEqual([
      [17, 4, 3], [14, 7, 4], [17, 7, 5], [17, 9, 6], [18, 12, 8], [9, 9, 7], [16, 4, 3], [15, 9, 5], [11, 13, 9]
    ])
  })

  it('逐场保留Excel中的现役球员出场、进球和助攻明细', () => {
    expect(new Set(fixtureMatchStats.map((row) => row.matchId))).toEqual(new Set(fixtureMatches.slice(1).map((match) => match.id)))
    expect(fixtureMatchStats).toHaveLength(374)
    const latestByPlayer = fixtureMatchStats.filter((row) => row.matchId === 'm-history-23')
    expect(latestByPlayer).toContainEqual({ matchId: 'm-history-23', playerId: 'p-li-weiqi', played: true, goals: 3, assists: 0 })
    expect(fixtureMatchStats.filter((row) => row.playerId === 'p-ouyang-zhiwei')).toHaveLength(3)
    expect(fixtureMatchStats.filter((row) => row.playerId === 'p-he-jiashen')).toHaveLength(4)
    expect(fixtureMatchStats).toContainEqual(expect.objectContaining({
      matchId: 'm-history-23',
      playerId: 'match-trial-shaozhongwen',
      displayName: '（试训）邵仲文',
      memberType: 'trial',
      goals: 4,
      assists: 2
    }))
  })

  it('号码、位置和入队年份按最新名单固定', () => {
    expect(activePlayers.find((player) => player.displayName === '袁梓皓')).toMatchObject({ shirtNumber: 5, position: '后卫', joinYear: 2023 })
    expect(activePlayers.find((player) => player.displayName === '黎响')).toMatchObject({ shirtNumber: 56, position: '前锋', joinYear: 2020 })
    expect(activePlayers.find((player) => player.displayName === '欧阳志威')).toMatchObject({ shirtNumber: 19, position: '后卫', joinYear: 2026 })
    expect(activePlayers.find((player) => player.displayName === '何佳珅')).toMatchObject({ shirtNumber: 3, position: '中场', joinYear: 2026 })
    expect(activePlayers.filter((player) => player.position === '未分类').map((player) => player.displayName)).toEqual([
      '马君豪', '尹智', '何泽锋', '王基权', '陈智民', '陈昊翔'
    ])
  })

  it('四名新成员在 2026 年 9 月前暂免并于 10 月恢复在莞档次', () => {
    const temporarilyExempt = fixtureFeeAssignments.filter((assignment) =>
      assignment.feePlanId === 'temporary_exempt' &&
      assignment.effectiveTo === '2026-09'
    )
    expect(temporarilyExempt).toHaveLength(4)
    for (const assignment of temporarilyExempt) {
      expect(fixtureFeeAssignments).toContainEqual(expect.objectContaining({
        playerId: assignment.playerId,
        feePlanId: 'dongguan',
        effectiveFrom: '2026-10'
      }))
    }
  })

  it('两名新成员在2026年12月前暂免并于2027年1月恢复低出勤学生档次', () => {
    for (const playerId of ['p-ouyang-zhiwei', 'p-he-jiashen']) {
      expect(fixtureFeeAssignments).toContainEqual(expect.objectContaining({
        playerId,
        feePlanId: 'temporary_exempt',
        effectiveTo: '2026-12'
      }))
      expect(fixtureFeeAssignments).toContainEqual(expect.objectContaining({
        playerId,
        feePlanId: 'student_low',
        effectiveFrom: '2027-01'
      }))
    }
  })

  it('袁梓皓按留学生档次计费', () => {
    expect(fixtureFeeAssignments).toContainEqual(expect.objectContaining({
      playerId: 'p-yuan-zihao',
      feePlanId: 'overseas'
    }))
  })

  it('1月至8月待缴名单人数和金额与文件一致', () => {
    const expected: Record<string, [number, number]> = {
      '2026-01': [5, 210], '2026-02': [6, 220], '2026-03': [11, 375], '2026-04': [8, 250],
      '2026-05': [9, 210], '2026-06': [5, 140], '2026-07': [6, 220], '2026-08': [7, 230]
    }
    for (const [period, [count, amount]] of Object.entries(expected)) {
      const unpaid = fixtureFeePayments.filter((payment) => payment.period === period && payment.status === 'unpaid')
      expect(unpaid).toHaveLength(count)
      expect(unpaid.reduce((sum, payment) => sum + payment.amount, 0)).toBe(amount)
    }
  })

  it('历史待缴金额与对应月份会费档案一致', () => {
    for (const payment of fixtureFeePayments.filter((item) => item.status === 'unpaid')) {
      const assignment = fixtureFeeAssignments
        .filter((item) => item.playerId === payment.playerId && item.effectiveFrom <= payment.period && (!item.effectiveTo || item.effectiveTo >= payment.period))
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
      const basePlan = fixtureFeePlans.find((plan) => plan.id === assignment?.feePlanId)
      expect(basePlan).toBeDefined()
      expect(resolveBilledFeePlan(basePlan!, fixtureFeePlans, payment.period).monthlyAmount).toBe(payment.amount)
    }
  })

  it('8月待缴名单逐人一致', () => {
    const playerNameById = new Map(activePlayers.map((player) => [player.id, player.displayName]))
    expect(fixtureFeePayments
      .filter((payment) => payment.period === '2026-08' && payment.status === 'unpaid')
      .map((payment) => [playerNameById.get(payment.playerId), payment.amount]))
      .toEqual([
        ['胡敬钧', 50], ['王振懿', 10], ['唐添翼', 10], ['袁梓皓', 10], ['陈智威', 50], ['郝嘉旭', 50], ['向浩麟', 50]
      ])
  })
})
