import fs from 'node:fs'
import crypto from 'node:crypto'
import { expect, it } from 'vitest'

it('个人首页接口返回与榜单一致的统计，覆盖旧seasonStats', async () => {
  const player = { _id: 'formal', memberType: 'formal', stats: { apps: 25, goals: 6, assists: 4 }, seasonStats: { apps: 23, goals: 5, assists: 3 } }
  const query: any = { where: () => query, limit: () => query, get: async () => ({ data: [] }), doc: () => ({ get: async () => ({ data: player }) }) }
  const common = {
    db: { collection: () => query },
    getAccess: async () => ({ memberStatus: 'approved', teamId: 'team', playerId: 'formal' }),
    ok: (_event: unknown, data: unknown) => ({ data }),
    handleError: (_event: unknown, error: Error) => { throw error }
  }
  const moduleRecord = { exports: {} as any }
  new Function('require', 'module', 'exports', fs.readFileSync('cloudfunctions-src/membership/index.js', 'utf8'))((id: string) => id === 'node:crypto' ? crypto : common, moduleRecord, moduleRecord.exports)
  const result = await moduleRecord.exports.main({ action: 'getAccountOverview' })
  expect(result.data.player.seasonStats).toEqual({ apps: 25, goals: 6, assists: 4 })
  expect(result.data.player.seasonStats).toEqual(result.data.player.stats)
})
