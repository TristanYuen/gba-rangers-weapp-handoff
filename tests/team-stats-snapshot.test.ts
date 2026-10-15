import fs from 'node:fs'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

describe('球队快照榜单', () => {
  it('用单场汇总替代过期累计值，保留试训球员档案', async () => {
    for (const source of ['cloudfunctions-src/team/index.js', '.codex_tmp/oct01-audit/deploy/team/index.js']) {
      if (!fs.existsSync(source)) continue
      const players = [
        { _id: 'formal', memberType: 'formal', stats: { apps: 23, goals: 36, assists: 11 }, seasonStats: { apps: 23, goals: 36, assists: 11 } },
        { _id: 'trial', memberType: 'trial', stats: { apps: 0, goals: 0, assists: 0 } }
      ]
      let aggregateLimit = 20
      const collection = (name: string) => {
        const query: any = {
          where: () => query, limit: (size: number) => { if (name === 'player_match_stats') aggregateLimit = size; return query }, orderBy: () => query,
          get: async () => ({ data: name === 'players' ? players : [] }),
          aggregate: () => query, match: () => query, group: () => query,
          end: async () => ({ list: [{ _id: 'formal', apps: 26, goals: 38, assists: 12 }] })
        }
        return query
      }
      const common = {
        db: { collection }, cloud: {}, command: { exists: () => false, aggregate: { sum: () => 0 } },
        getAccess: async () => ({ role: 'admin', memberStatus: 'approved', teamId: 'team', playerId: 'formal' }),
        ok: (_event: unknown, data: unknown) => ({ ok: true, data }),
        handleError: (_event: unknown, error: Error) => { throw error }
      }
      const moduleRecord = { exports: {} as any }
      new Function('require', 'module', 'exports', fs.readFileSync(source, 'utf8'))((id: string) => id === 'crypto' ? crypto : common, moduleRecord, moduleRecord.exports)
      const result = await moduleRecord.exports.main({ action: 'getSnapshot' })
      expect(aggregateLimit).toBe(200)
      expect(result.data.players[0].stats).toEqual({ apps: 26, goals: 38, assists: 12 })
      expect(result.data.players[0].seasonStats).toEqual(result.data.players[0].stats)
      expect(result.data.players[1].stats).toEqual({ apps: 0, goals: 0, assists: 0 })
    }
  })
})
