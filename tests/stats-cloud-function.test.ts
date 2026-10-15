import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const loadStats = (deleted = false) => {
  const records: any = {
    matches: { match: { teamId: 'team', matchDate: '2026-08-01', title: '比赛', version: 1, countInStats: true } },
    players: { formal: { _id: 'formal', teamId: 'team', memberType: 'formal', ...(deleted ? { deletedAt: 'removed' } : {}) } },
    player_match_stats: { 'match:formal': { uniqueKey: 'match:formal', playerId: 'formal', teamId: 'team', matchId: 'match', countInStats: true, goals: 3, assists: 0 } },
    appearances: {}, yearbook_entries: {}
  }
  const collection = (name: string): any => ({
    doc: (id: string) => ({
      get: async () => ({ data: records[name][id] }),
      set: async ({ data }: any) => { records[name][id] = data },
      remove: async () => { delete records[name][id] },
      update: async ({ data }: any) => { Object.assign(records[name][id], data) }
    }),
    where: () => ({ limit: () => ({ get: async () => ({ data: Object.values(records[name]).filter((x: any) => !x.deletedAt) }) }), get: async () => ({ data: Object.values(records[name]).filter((x: any) => !x.deletedAt) }) }),
    add: async ({ data }: any) => { records[name].created = data },
    aggregate: () => ({ match: () => ({ group: () => ({ limit: () => ({ end: async () => {
      const totals = new Map<string, any>()
      Object.values(records.player_match_stats).filter((x: any) => x.countInStats).forEach((x: any) => {
        const value = totals.get(x.playerId) || { _id: x.playerId, apps: 0, goals: 0, assists: 0 }
        value.apps++; value.goals += x.goals; value.assists += x.assists; totals.set(x.playerId, value)
      })
      return { list: [...totals.values()] }
    } }) }) }) })
  })
  const db = { collection, runTransaction: async (callback: any) => callback({ collection }) }
  const common = {
    db, command: { exists: () => false, inc: () => 2, aggregate: { sum: () => 0 } },
    now: () => 'now', requireManager: async () => ({ teamId: 'team' }),
    requireSameTeam: (_actor: any, teamId: string) => { if (teamId !== 'team') throw new Error('team') },
    audit: async () => undefined, ok: (_event: any, data: any) => ({ ok: true, data }),
    handleError: (_event: any, error: any) => ({ ok: false, error })
  }
  const moduleRecord = { exports: {} as any }
  new Function('require', 'module', 'exports', fs.readFileSync('cloudfunctions-src/stats/index.js', 'utf8'))(() => common, moduleRecord, moduleRecord.exports)
  const publish = (rows: any[], version = 1) => moduleRecord.exports.main({ action: 'publishMatchStats', payload: { matchId: 'match', expectedVersion: version, homeScore: 3, awayScore: 0, rows } })
  return { records, publish }
}

describe('赛后云端保存与榜单', () => {
  it('发布后更新正式球员累计值，排除凑脚球员', async () => {
    const { publish, records } = loadStats()
    expect((await publish([{ playerId: 'formal', played: true, goals: 1, assists: 0 }, { playerId: 'guest', played: true, displayName: '凑脚球员', memberType: 'guest', goals: 2, assists: 0 }])).ok).toBe(true)
    expect(records.players.formal.stats).toEqual({ apps: 1, goals: 1, assists: 0 })
    expect(records.players.formal.seasonStats).toEqual(records.players.formal.stats)
    expect(records.player_match_stats['match:guest'].countInStats).toBe(false)
  })
  it('允许取消已删除球员的历史出场', async () => {
    const { publish, records } = loadStats(true)
    expect((await publish([{ playerId: 'formal', played: false, goals: 0, assists: 0 }])).ok).toBe(true)
    expect(records.player_match_stats['match:formal']).toBeUndefined()
  })
  it('保留已删除球员的单场历史记录，排除正式累计', async () => {
    const { publish, records } = loadStats(true)
    expect((await publish([{ playerId: 'formal', played: true, goals: 3, assists: 0 }])).ok).toBe(true)
    expect(records.player_match_stats['match:formal']).toMatchObject({ goals: 3, countInStats: false, memberType: 'guest' })
  })
  it('拒绝未存在的正式球员与过期版本，保留历史记录', async () => {
    const { publish, records } = loadStats()
    expect((await publish([{ playerId: 'unknown', played: true, goals: 0, assists: 0 }])).error.code).toBe('PLAYER_NOT_FOUND')
    expect((await publish([{ playerId: 'formal', played: true, goals: 0, assists: 0 }], 0)).error.code).toBe('VERSION_CONFLICT')
    expect(records.player_match_stats['match:formal'].goals).toBe(3)
  })
})
