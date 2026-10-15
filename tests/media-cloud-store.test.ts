import { beforeEach, expect, it, vi } from 'vitest'
import type { LocalStore } from '@/services/localStore'
import { createCloudStore } from '@/services/cloudStore'

const cloud = vi.hoisted(() => ({ callCloudAction: vi.fn(), uploadCloudFile: vi.fn() }))
vi.mock('@/services/cloudService', () => cloud)

beforeEach(() => vi.resetAllMocks())

it('头像已提交后快照刷新失败仍返回已知球员，不重复提交', async () => {
  const player = { id: 'player-1', displayName: '测试球员' }
  const local = {
    getAccess: () => ({ teamId: 'team-1', playerId: 'player-1' }),
    getPlayer: () => player,
    setPlayerAvatar: () => player
  } as unknown as LocalStore
  cloud.uploadCloudFile.mockResolvedValue('cloud://env/team-assets/team-1/avatar.jpg')
  cloud.callCloudAction.mockResolvedValueOnce({ id: 'media-1' }).mockRejectedValueOnce(new Error('snapshot timeout'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await expect(createCloudStore(local).setPlayerAvatar('source.jpg')).resolves.toEqual(player)
  expect(cloud.uploadCloudFile).toHaveBeenCalledTimes(1)
  expect(cloud.callCloudAction.mock.calls.map(([name, action]) => [name, action])).toEqual([
    ['media', 'uploadPlayerAvatar'], ['team', 'getSnapshot']
  ])
  expect(log).toHaveBeenCalled()
  log.mockRestore()
})

it('云存储失败时不创建媒体记录', async () => {
  const local = {
    getAccess: () => ({ teamId: 'team-1', playerId: 'player-1' }),
    setPlayerAvatar: () => undefined
  } as unknown as LocalStore
  cloud.uploadCloudFile.mockRejectedValue(new Error('upload denied'))
  await expect(createCloudStore(local).setPlayerAvatar('source.jpg')).rejects.toThrow('upload denied')
  expect(cloud.callCloudAction).not.toHaveBeenCalled()
})
