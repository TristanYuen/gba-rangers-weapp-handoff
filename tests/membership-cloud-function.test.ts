import fs from 'node:fs'
import path from 'node:path'
import * as crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

interface CloudResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: { code: string; message: string }
}

interface LoadedMembership {
  main(event: { action: string; payload?: Record<string, unknown>; requestId?: string }): Promise<CloudResult>
}

const loadMembership = (transactionFailure?: Error) => {
  const writes: Array<{ collection: string; id: string; data: Record<string, unknown> }> = []
  const team = { _id: 'team-1', name: 'GBA RANGERS' }
  const player = {
    _id: 'player-1',
    teamId: team._id,
    displayName: '测试球员',
    memberType: 'formal',
    status: 'active'
  }
  const transaction = {
    collection: (collection: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (collection === 'players') return { data: player }
          throw new Error(`document.get:fail document with _id ${id} does not exist`)
        },
        set: async ({ data }: { data: Record<string, unknown> }) => {
          writes.push({ collection, id, data })
          return { _id: id }
        }
      })
    })
  }
  const db = {
    collection: (collection: string) => ({
      where: () => ({
        limit: () => ({
          get: async () => ({ data: collection === 'teams' ? [team] : [] })
        })
      })
    }),
    runTransaction: async (callback: (client: typeof transaction) => Promise<Record<string, unknown>>) => {
      if (transactionFailure) throw transactionFailure
      return { result: await callback(transaction), errMsg: 'runTransaction:ok' }
    }
  }
  const common = {
    db,
    command: { exists: (value: boolean) => ({ exists: value }) },
    now: () => '2026-07-31T14:00:00.000Z',
    ok: (_event: unknown, data: Record<string, unknown>) => ({ ok: true, data }),
    getAccess: async () => ({ role: 'visitor', memberStatus: 'none', openid: 'openid-1' }),
    requireManager: async () => { throw new Error('unused') },
    requireOwner: async () => { throw new Error('unused') },
    requireSameTeam: () => undefined,
    requireString: (value: unknown, code: string, message: string) => {
      if (typeof value !== 'string' || !value.trim()) throw Object.assign(new Error(message), { code })
      return value.trim()
    },
    audit: async () => undefined,
    transactionValue: (value: unknown) => (
      value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result')
        ? (value as { result: unknown }).result
        : value
    ),
    handleError: (_event: unknown, error: Error & { code?: string }) => ({
      ok: false,
      error: { code: error.code || 'INTERNAL_ERROR', message: error.message }
    })
  }
  const source = fs.readFileSync(path.resolve('cloudfunctions-src/membership/index.js'), 'utf8')
  const moduleRecord: { exports: Partial<LoadedMembership> } = { exports: {} }
  const factory = new Function('require', 'module', 'exports', source) as (
    require: (id: string) => unknown,
    module: typeof moduleRecord,
    exports: typeof moduleRecord.exports
  ) => void
  factory((id) => {
    if (id === 'node:crypto') return crypto
    if (id === './common') return common
    throw new Error(`Unexpected module: ${id}`)
  }, moduleRecord, moduleRecord.exports)
  return { membership: moduleRecord.exports as LoadedMembership, writes }
}

describe('membership 云函数首次认领', () => {
  it('成员记录和认领锁都不存在时创建待审核申请', async () => {
    const { membership, writes } = loadMembership()

    const result = await membership.main({
      action: 'requestClaim',
      payload: { inviteCode: 'GBA-TEST', playerId: 'player-1' },
      requestId: 'request-1'
    })

    expect(result).toEqual({
      ok: true,
      data: {
        id: expect.stringMatching(/^member-/),
        teamId: 'team-1',
        playerId: 'player-1',
        role: 'player',
        status: 'pending'
      }
    })
    expect(writes.map(({ collection }) => collection)).toEqual([
      'team_memberships',
      'identity_claim_locks'
    ])
  })

  it('事务异常会转换成标准业务错误响应', async () => {
    const failure = Object.assign(new Error('事务暂时不可用'), { code: 'DATABASE_TRANSACTION_FAIL' })
    const { membership } = loadMembership(failure)

    await expect(membership.main({
      action: 'requestClaim',
      payload: { inviteCode: 'GBA-TEST', playerId: 'player-1' }
    })).resolves.toEqual({
      ok: false,
      error: { code: 'DATABASE_TRANSACTION_FAIL', message: '事务暂时不可用' }
    })
  })
})
