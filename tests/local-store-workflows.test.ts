import { describe, expect, it } from 'vitest'
import { LocalStore } from '@/services/localStore'
import { beijingPeriod } from '@/utils/date'

describe('头像与会费审核流程', () => {
  it('读取赛事时会把超过开球时间24小时的进行中赛事转为待补比分', () => {
    const store = new LocalStore()
    const match = store.getMatch('m-next')
    expect(match.status).toBe('completed_pending_score')
    expect(match.homeScore).toBeNull()
    expect(match.awayScore).toBeNull()
  })

  it('头像上传后等待队长审批，通过后才写回球员档案', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const player = store.setPlayerAvatar('data:image/png;base64,avatar-test')
    const pending = store.getMedia().find((asset) => asset.playerId === player.id && asset.mediaPurpose === 'player_avatar')

    expect(player.id).toBe('p-yin-weiming')
    expect(store.getPlayer(player.id).avatarUrl).toBeUndefined()
    expect(pending).toMatchObject({ reviewStatus: 'pending_review', isCover: false })
    expect(() => store.reviewMedia(pending!.id, 'approved')).toThrow(/只有队长/)

    store.setDemoRole('owner')
    store.reviewMedia(pending!.id, 'approved')
    expect(store.getPlayer(player.id).avatarUrl).toContain('avatar-test')
    expect(store.getMedia().find((asset) => asset.id === pending!.id)).toMatchObject({ reviewStatus: 'approved', isCover: true })
  })

  it('管理员会费调整等待队长审核，通过后才生效', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    store.updatePlayerFee({
      playerId: 'p-chen-shujian',
      feePlanId: 'student_high',
      effectiveFrom: '2027-02',
      reason: '测试审批流程',
      notify: false
    })

    expect(store.getPlayerFeeProfile('p-chen-shujian', '2027-02').basePlan.id).toBe('dongguan')
    expect(() => store.listFeeChangeRequests()).toThrow(/只有队长/)

    store.setDemoRole('owner')
    const [request] = store.listFeeChangeRequests()
    expect(request?.status).toBe('pending')
    store.reviewFeeChangeRequest(request!.id, 'approved')

    expect(store.getPlayerFeeProfile('p-chen-shujian', '2027-02').basePlan.id).toBe('student_high')
    expect(store.listFeeChangeRequests()).toHaveLength(0)
    expect(store.listManagerOperationLogs().some((log) => log.signedBy.includes('队长'))).toBe(true)
  })

  it('普通成员无法读取管理员操作记录', () => {
    const store = new LocalStore()
    store.setDemoRole('player')
    expect(() => store.listManagerOperationLogs()).toThrow(/只有管理员和队长/)
  })

  it('队长和管理员可以代传其他球员头像，公开前仍需队长审批', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const updated = store.updatePlayer('p-chen-shujian', {
      position: '前锋',
      shirtNumber: 10,
      joinYear: 2020
    })
    const avatar = store.setPlayerAvatarFor('p-chen-shujian', 'data:image/png;base64,managed-avatar')

    expect(updated).toMatchObject({ displayName: '陈树健', position: '前锋', shirtNumber: 10, joinYear: 2020 })
    expect(avatar.avatarUrl).toBeUndefined()
    const pendingAvatar = store.getMedia().find((asset) => asset.playerId === 'p-chen-shujian' && asset.mediaPurpose === 'player_avatar')
    expect(pendingAvatar?.reviewStatus).toBe('pending_review')

    store.setDemoRole('owner')
    store.reviewMedia(pendingAvatar!.id, 'approved')
    expect(store.getPlayer('p-chen-shujian').avatarUrl).toContain('managed-avatar')

    store.setDemoRole('player')
    expect(() => store.updatePlayer('p-chen-shujian', { position: '门将' })).toThrow(/只有队长或管理员/)
    expect(() => store.setPlayerAvatarFor('p-chen-shujian', 'avatar')).toThrow(/只有本人、队长或管理员/)
  })

  it('通知支持一次选择多名成员并保留个性化发送明细', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const notice = store.createNotice({
      type: 'fee_due',
      title: '2026 年 7 月会费催收',
      content: '你好，{姓名}。请缴纳 {月份} 会费 ¥{金额}。',
      audience: 'individual',
      targetPlayerIds: ['p-yin-weiming', 'p-chen-shujian'],
      feePeriod: '2026-07',
      recipientDetails: [
        {
          playerId: 'p-yin-weiming',
          displayName: '尹伟明',
          feeAmount: 50,
          content: '你好，尹伟明。请缴纳 2026-07 会费 ¥50。'
        },
        {
          playerId: 'p-chen-shujian',
          displayName: '陈树健',
          feeAmount: 50,
          content: '你好，陈树健。请缴纳 2026-07 会费 ¥50。'
        }
      ]
    })

    expect(notice.delivery.total).toBe(2)
    expect(notice.targetPlayerIds).toEqual(['p-yin-weiming', 'p-chen-shujian'])
    expect(notice.recipientDetails?.map((detail) => detail.displayName)).toEqual(['尹伟明', '陈树健'])
  })

  it('通知逐条打开后减少当前用户未读数量', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const notice = store.createNotice({
      type: 'match_signup',
      title: '测试通知',
      content: '逐条读取测试',
      audience: 'individual',
      targetPlayerIds: ['p-yin-weiming']
    })
    const before = store.getUnreadNoticeCount()
    store.markNoticeRead(notice.id)
    expect(store.getUnreadNoticeCount()).toBe(before - 1)
  })

  it('管理员新增球员需队长审核，批准后进入正式名册', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const request = store.createPlayerRequest({ displayName: '测试新球员', shirtNumber: 98, position: '中场', joinYear: 2026, feePlanId: 'dongguan' })
    expect(request.status).toBe('pending')
    expect(store.listPlayers(true).some((player) => player.displayName === '测试新球员')).toBe(false)

    store.setDemoRole('owner')
    const reviewed = store.reviewPlayerAddRequest(request.id, true)
    expect(reviewed.status).toBe('approved')
    expect(store.listPlayers(true).some((player) => player.displayName === '测试新球员')).toBe(true)
    expect(store.getPlayerFeeProfile(reviewed.playerId!, beijingPeriod()).basePlan.id).toBe('dongguan')
    expect(() => store.createPlayerRequest({ displayName: '号码冲突球员', shirtNumber: 98, position: '后卫', joinYear: 2026 })).toThrow(/号码已被现役球员使用/)
  })

  it('新增球员留空会费时进入待设置台账，管理员可后续补设', () => {
    const store = new LocalStore()
    store.setDemoRole('owner')
    const request = store.createPlayerRequest({ displayName: '待设置球员', shirtNumber: 96, position: '后卫', joinYear: 2026 })
    const row = store.listPlayerFeeLedger('2026-08').find((item) => item.playerId === request.playerId)

    expect(row).toMatchObject({ status: 'pending', player: { displayName: '待设置球员' } })

    store.setDemoRole('admin')
    store.updatePlayerFee({ playerId: request.playerId!, feePlanId: 'student_low', effectiveFrom: '2026-08', reason: '补充会费档案', notify: false })
    expect(store.listPlayerFeeLedger('2026-08').find((item) => item.playerId === request.playerId)?.status).toBe('pending')

    store.setDemoRole('owner')
    const [changeRequest] = store.listFeeChangeRequests()
    store.reviewFeeChangeRequest(changeRequest!.id, 'approved')
    expect(store.listPlayerFeeLedger('2026-08').find((item) => item.playerId === request.playerId)?.profile?.basePlan.id).toBe('student_low')
  })

  it('队长和管理员可以删除历史赛事，普通成员无权删除', () => {
    const store = new LocalStore()
    store.setDemoRole('admin')
    const deleted = store.deleteMatch('m-history-1')
    expect(deleted.id).toBe('m-history-1')
    expect(() => store.getMatch('m-history-1')).toThrow(/赛事不存在/)

    store.setDemoRole('owner')
    expect(() => store.deleteMatch('m-history-2')).not.toThrow()

    store.setDemoRole('player')
    expect(() => store.deleteMatch('m-history-3')).toThrow(/只有队长或管理员/)
  })
})
