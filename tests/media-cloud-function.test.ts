import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

interface CloudResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: { code: string; message: string }
}

interface LoadedMedia {
  main(event: { action: string; payload?: Record<string, unknown>; requestId?: string }): Promise<CloudResult>
}

const loadMedia = (initialRole: 'player' | 'admin' | 'owner' = 'player') => {
  const role = { current: initialRole }
  const mediaWrites: Record<string, unknown>[] = []
  const playerWrites: Record<string, unknown>[] = []
  const mediaRecord = {
    _id: 'media-1',
    teamId: 'team-1',
    uploaderOpenid: 'openid-1',
    uploaderPlayerId: 'player-1',
    mediaPurpose: 'player_avatar',
    playerId: 'player-1',
    fileId: 'cloud://env/team-assets/team-1/avatar.jpg',
    thumbnailFileId: 'cloud://env/team-assets/team-1/avatar.jpg',
    reviewStatus: 'pending_review',
    isCover: false,
    isFeatured: false
  }
  const player = { _id: 'player-1', teamId: 'team-1', displayName: '测试球员' }
  const db = {
    collection: (collection: string) => ({
      add: async ({ data }: { data: Record<string, unknown> }) => {
        mediaWrites.push(data)
        return { _id: 'media-created' }
      },
      doc: (_id: string) => ({
        get: async () => ({ data: collection === 'players' ? player : mediaRecord }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          if (collection === 'players') playerWrites.push(data)
          else mediaWrites.push(data)
        }
      }),
      where: () => ({ update: async ({ data }: { data: Record<string, unknown> }) => mediaWrites.push(data) })
    })
  }
  const actor = () => ({
    role: role.current,
    teamId: 'team-1',
    openid: 'openid-1',
    playerId: 'player-1'
  })
  const common = {
    db,
    command: { neq: (value: unknown) => ({ neq: value }), remove: () => ({ remove: true }) },
    now: () => '2026-08-01T12:00:00.000Z',
    ok: (_event: unknown, data: Record<string, unknown>) => ({ ok: true, data }),
    requireApproved: async () => actor(),
    requireManager: async () => actor(),
    requireSameTeam: (current: { teamId: string }, teamId: string) => {
      if (current.teamId !== teamId) throw Object.assign(new Error('球队不匹配'), { code: 'TEAM_MISMATCH' })
    },
    audit: async () => undefined,
    handleError: (_event: unknown, error: Error & { code?: string }) => ({
      ok: false,
      error: { code: error.code || 'INTERNAL_ERROR', message: error.message }
    })
  }
  const source = fs.readFileSync(path.resolve('cloudfunctions-src/media/index.js'), 'utf8')
  const moduleRecord: { exports: Partial<LoadedMedia> } = { exports: {} }
  const factory = new Function('require', 'module', 'exports', source) as (
    require: (id: string) => unknown,
    module: typeof moduleRecord,
    exports: typeof moduleRecord.exports
  ) => void
  factory((id) => {
    if (id === './common') return common
    throw new Error(`Unexpected module: ${id}`)
  }, moduleRecord, moduleRecord.exports)
  return { media: moduleRecord.exports as LoadedMedia, role, mediaWrites, playerWrites }
}

describe('media 云函数图片审批', () => {
  it('头像上传只生成待审记录', async () => {
    const { media, mediaWrites, playerWrites } = loadMedia('player')
    const result = await media.main({
      action: 'uploadPlayerAvatar',
      payload: { fileId: 'cloud://env/team-assets/team-1/avatar.jpg', complianceAccepted: true }
    })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({ mediaPurpose: 'player_avatar', reviewStatus: 'pending_review', isCover: false })
    expect(mediaWrites[0]).toMatchObject({ mediaPurpose: 'player_avatar', reviewStatus: 'pending_review' })
    expect(playerWrites).toHaveLength(0)
  })

  it('未确认合规声明时拒绝创建图片记录', async () => {
    const { media, mediaWrites } = loadMedia('player')
    await expect(media.main({
      action: 'uploadPlayerAvatar',
      payload: { fileId: 'cloud://env/team-assets/team-1/avatar.jpg' }
    })).resolves.toMatchObject({ ok: false, error: { code: 'MEDIA_COMPLIANCE_REQUIRED' } })
    expect(mediaWrites).toHaveLength(0)
  })

  it('管理员无法批准待审图片，队长批准后写入公开头像', async () => {
    const { media, role, playerWrites } = loadMedia('admin')
    await expect(media.main({
      action: 'reviewMedia',
      payload: { id: 'media-1', status: 'approved' }
    })).resolves.toMatchObject({ ok: false, error: { code: 'OWNER_REQUIRED' } })
    expect(playerWrites).toHaveLength(0)

    role.current = 'owner'
    await expect(media.main({
      action: 'reviewMedia',
      payload: { id: 'media-1', status: 'approved' }
    })).resolves.toMatchObject({ ok: true })
    expect(playerWrites).toContainEqual(expect.objectContaining({
      avatarUrl: 'cloud://env/team-assets/team-1/avatar.jpg',
      showAvatar: true
    }))
  })
})
