const { db, command, now, ok, requireApproved, requireManager, requireSameTeam, audit, handleError } = require('./common')

const assertTeamFile = (fileId, teamId) => {
  if (typeof fileId !== 'string' || !fileId.includes(`/team-assets/${teamId}/`)) {
    throw Object.assign(new Error('云存储文件路径与当前球队不匹配'), { code: 'INVALID_MEDIA_PATH' })
  }
}

const assertComplianceAccepted = (payload) => {
  if (payload.complianceAccepted !== true) {
    throw Object.assign(new Error('上传前必须确认图片合规声明'), { code: 'MEDIA_COMPLIANCE_REQUIRED' })
  }
}

exports.main = async (event) => {
  try {
    const payload = event.payload || {}
    if (event.action === 'uploadMediaMeta') {
      const actor = await requireApproved()
      assertComplianceAccepted(payload)
      if (!payload.fileId) throw Object.assign(new Error('缺少云存储文件 ID'), { code: 'INVALID_MEDIA' })
      assertTeamFile(payload.fileId, actor.teamId)
      const playerId = ['admin', 'owner'].includes(actor.role) && payload.playerId ? payload.playerId : actor.playerId
      if (playerId) {
        const player = (await db.collection('players').doc(playerId).get()).data
        if (!player || player.teamId !== actor.teamId || player.deletedAt) {
          throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
        }
      }
      if (payload.matchId) {
        const match = (await db.collection('matches').doc(payload.matchId).get()).data
        if (!match || match.teamId !== actor.teamId || match.deletedAt) {
          throw Object.assign(new Error('赛事不存在'), { code: 'MATCH_NOT_FOUND' })
        }
      }
      const record = { teamId: actor.teamId, uploaderOpenid: actor.openid, uploaderPlayerId: actor.playerId, mediaPurpose: 'gallery', complianceVersion: '2026-08-01', complianceAcceptedAt: now(), playerId, matchId: payload.matchId, fileId: payload.fileId, thumbnailFileId: payload.thumbnailFileId || payload.fileId, reviewStatus: 'pending_review', isCover: false, isFeatured: false, createdAt: now(), updatedAt: now() }
      const result = await db.collection('media_assets').add({ data: record })
      return ok(event, { id: result._id, ...record })
    }
    if (event.action === 'uploadPlayerAvatar') {
      const actor = await requireApproved()
      assertComplianceAccepted(payload)
      assertTeamFile(payload.fileId, actor.teamId)
      const playerId = ['admin', 'owner'].includes(actor.role) && payload.playerId
        ? payload.playerId
        : actor.playerId
      if (!playerId) throw Object.assign(new Error('当前身份尚未绑定球员'), { code: 'PLAYER_NOT_BOUND' })
      const player = (await db.collection('players').doc(playerId).get()).data
      if (!player || player.teamId !== actor.teamId || player.deletedAt) {
        throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
      }
      const record = {
        teamId: actor.teamId,
        uploaderOpenid: actor.openid,
        uploaderPlayerId: actor.playerId,
        mediaPurpose: 'player_avatar',
        complianceVersion: '2026-08-01',
        complianceAcceptedAt: now(),
        playerId,
        fileId: payload.fileId,
        thumbnailFileId: payload.fileId,
        reviewStatus: 'pending_review',
        isCover: false,
        isFeatured: false,
        createdAt: now(),
        updatedAt: now()
      }
      const result = await db.collection('media_assets').add({ data: record })
      await audit({
        actor,
        action: 'submitPlayerAvatar',
        entityType: 'player',
        entityId: playerId,
        before: { avatarUrl: player.avatarUrl || null },
        after: { pendingAvatarFileId: payload.fileId },
        requestId: event.requestId
      })
      return ok(event, { id: result._id, ...record })
    }
    if (event.action === 'reviewMedia') {
      const actor = await requireManager()
      const before = (await db.collection('media_assets').doc(payload.id).get()).data
      if (!before) throw Object.assign(new Error('照片不存在'), { code: 'MEDIA_NOT_FOUND' })
      requireSameTeam(actor, before.teamId)
      if (!['approved', 'rejected', 'hidden', 'pending_review'].includes(payload.status)) throw Object.assign(new Error('照片审核状态无效'), { code: 'INVALID_MEDIA_STATUS' })
      const approvalDecision = (
        before.reviewStatus === 'pending_review' && ['approved', 'rejected'].includes(payload.status)
      ) || (
        payload.status === 'approved' && !['approved', 'hidden'].includes(before.reviewStatus)
      )
      if (approvalDecision && actor.role !== 'owner') {
        throw Object.assign(new Error('只有队长可以审批图片'), { code: 'OWNER_REQUIRED' })
      }
      const isPlayerAvatar = before.mediaPurpose === 'player_avatar'
      const after = {
        reviewStatus: payload.status,
        rejectReason: payload.rejectReason || command.remove(),
        ...(isPlayerAvatar ? { isCover: payload.status === 'approved' } : payload.isCover !== undefined ? { isCover: Boolean(payload.isCover) } : {}),
        ...(payload.isFeatured !== undefined ? { isFeatured: Boolean(payload.isFeatured) } : {}),
        ...(['rejected', 'hidden'].includes(payload.status) ? { isCover: false, isFeatured: false } : {}),
        updatedAt: now()
      }
      await db.collection('media_assets').doc(payload.id).update({ data: after })
      if (isPlayerAvatar && payload.status === 'approved') {
        const player = (await db.collection('players').doc(before.playerId).get()).data
        if (!player || player.teamId !== actor.teamId || player.deletedAt) {
          throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
        }
        await Promise.all([
          db.collection('players').doc(before.playerId).update({ data: { avatarUrl: before.fileId, showAvatar: true, updatedAt: now() } }),
          db.collection('media_assets').where({
            teamId: actor.teamId,
            playerId: before.playerId,
            _id: command.neq(payload.id)
          }).update({ data: { isCover: false, updatedAt: now() } })
        ])
      }
      if (isPlayerAvatar && ['rejected', 'hidden'].includes(payload.status)) {
        const player = (await db.collection('players').doc(before.playerId).get()).data
        if (player?.avatarUrl === before.fileId) {
          await db.collection('players').doc(before.playerId).update({ data: { avatarUrl: command.remove(), updatedAt: now() } })
        }
      }
      if (payload.isCover && before.matchId) await db.collection('media_assets').where({ teamId: actor.teamId, matchId: before.matchId, _id: command.neq(payload.id) }).update({ data: { isCover: false, updatedAt: now() } })
      await audit({ actor, action: 'reviewMedia', entityType: 'media_asset', entityId: payload.id, before, after, requestId: event.requestId })
      return ok(event, { id: payload.id, ...after })
    }
    throw Object.assign(new Error('未知媒体操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) { return handleError(event, error) }
}
