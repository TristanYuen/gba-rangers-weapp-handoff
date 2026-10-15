const crypto = require('crypto')
const { cloud, db, command, now, ok, getAccess, requireManager, requireOwner, audit, handleError } = require('./common')

const withClientId = (record) => record ? { ...record, id: record.id || record._id } : record
const playerPatchFields = new Set([
  'displayName',
  'shirtNumber',
  'position',
  'joinYear',
  'leaveYear',
  'status',
  'publicAuthorized',
  'showAvatar',
  'showPhotos'
])
const yearbookPatchFields = new Set([
  'summary',
  'cloudAlbumUrl',
  'cloudAlbumLabel',
  'featured',
  'public'
])
const pickPatch = (patch, fields) => Object.fromEntries(
  Object.entries(patch || {}).filter(([key]) => fields.has(key))
)
const hashId = (prefix, value) => `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)}`
const validateNewPlayer = (payload) => {
  const displayName = typeof payload?.displayName === 'string' ? payload.displayName.trim() : ''
  const position = typeof payload?.position === 'string' ? payload.position.trim() : ''
  const shirtNumber = Number(payload?.shirtNumber)
  const joinYear = Number(payload?.joinYear)
  if (!displayName || displayName.length > 50) throw Object.assign(new Error('请填写有效姓名'), { code: 'INVALID_PLAYER' })
  if (!position || position.length > 50) throw Object.assign(new Error('请选择球员位置'), { code: 'INVALID_PLAYER' })
  if (!Number.isInteger(shirtNumber) || shirtNumber < 0 || shirtNumber > 999) throw Object.assign(new Error('球衣号码无效'), { code: 'INVALID_PLAYER' })
  if (!Number.isInteger(joinYear) || joinYear < 1900 || joinYear > 2100) throw Object.assign(new Error('入队年份无效'), { code: 'INVALID_PLAYER' })
  return { displayName, position, shirtNumber, joinYear }
}
const ensurePlayerIdentityAvailable = async (teamId, values, excludedPlayerId) => {
  const [sameNumber, sameName, pendingNumber] = await Promise.all([
    db.collection('players').where({ teamId, status: 'active', shirtNumber: values.shirtNumber, deletedAt: command.exists(false) }).limit(5).get(),
    db.collection('players').where({ teamId, status: 'active', displayName: values.displayName, deletedAt: command.exists(false) }).limit(5).get(),
    db.collection('player_add_requests').where({ teamId, status: 'pending', shirtNumber: values.shirtNumber }).limit(5).get()
  ])
  if (sameNumber.data.some((record) => record._id !== excludedPlayerId)) throw Object.assign(new Error('该号码已被现役球员使用'), { code: 'SHIRT_NUMBER_CONFLICT' })
  if (sameName.data.some((record) => record._id !== excludedPlayerId)) throw Object.assign(new Error('现役名册中已有同名球员'), { code: 'PLAYER_NAME_CONFLICT' })
  return pendingNumber.data
}
const createPlayerRecord = async (actor, values, requestId) => {
  const id = hashId('player', `${actor.teamId}:${values.displayName}:${values.shirtNumber}:${Date.now()}:${Math.random()}`)
  const record = {
    teamId: actor.teamId,
    sourceKey: `app:${id}`,
    sourceName: values.displayName,
    displayName: values.displayName,
    memberType: 'formal',
    status: 'active',
    shirtNumber: values.shirtNumber,
    position: values.position,
    joinYear: values.joinYear,
    publicAuthorized: true,
    showAvatar: true,
    showPhotos: true,
    stats: { apps: 0, goals: 0, assists: 0 },
    seasonStats: { apps: 0, goals: 0, assists: 0 },
    version: 1,
    createdAt: now(),
    updatedAt: now()
  }
  await db.collection('players').doc(id).set({ data: record })
  await audit({ actor, action: 'createPlayer', entityType: 'player', entityId: id, before: null, after: record, requestId })
  return { id, ...record }
}
const validatePlayerPatch = (before, patch) => {
  if (patch.displayName !== undefined && (typeof patch.displayName !== 'string' || !patch.displayName.trim() || patch.displayName.trim().length > 50)) {
    throw Object.assign(new Error('球员姓名无效'), { code: 'INVALID_PLAYER' })
  }
  if (patch.shirtNumber !== undefined && (!Number.isInteger(patch.shirtNumber) || patch.shirtNumber < 0 || patch.shirtNumber > 999)) {
    throw Object.assign(new Error('球衣号码无效'), { code: 'INVALID_PLAYER' })
  }
  if (patch.position !== undefined && (typeof patch.position !== 'string' || patch.position.length > 50)) {
    throw Object.assign(new Error('球员位置无效'), { code: 'INVALID_PLAYER' })
  }
  for (const field of ['joinYear', 'leaveYear']) {
    if (patch[field] !== undefined && (!Number.isInteger(patch[field]) || patch[field] < 1900 || patch[field] > 2100)) {
      throw Object.assign(new Error('效力年份无效'), { code: 'INVALID_PLAYER' })
    }
  }
  const joinYear = patch.joinYear ?? before.joinYear
  const leaveYear = patch.leaveYear ?? before.leaveYear
  if (joinYear && leaveYear && leaveYear < joinYear) throw Object.assign(new Error('结束年份不能早于开始年份'), { code: 'INVALID_PLAYER' })
  if (patch.status !== undefined && !['active', 'alumni'].includes(patch.status)) throw Object.assign(new Error('球员状态无效'), { code: 'INVALID_PLAYER' })
  for (const field of ['publicAuthorized', 'showAvatar', 'showPhotos']) {
    if (patch[field] !== undefined && typeof patch[field] !== 'boolean') throw Object.assign(new Error('球员展示设置无效'), { code: 'INVALID_PLAYER' })
  }
}
const resolveTemporaryFileUrls = async (fileIds) => {
  const unique = [...new Set(fileIds.filter((value) => typeof value === 'string' && value.startsWith('cloud://')))]
  const resolved = new Map()
  for (let index = 0; index < unique.length; index += 50) {
    const result = await cloud.getTempFileURL({ fileList: unique.slice(index, index + 50) })
    for (const item of result.fileList || []) {
      if (item.fileID && item.tempFileURL) resolved.set(item.fileID, item.tempFileURL)
    }
  }
  return resolved
}

exports.main = async (event) => {
  try {
    if (event.action === 'updatePlayer') {
      const actor = await requireManager()
      const before = (await db.collection('players').doc(event.payload?.playerId).get()).data
      if (!before || before.teamId !== actor.teamId || before.deletedAt) throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
      const patch = pickPatch(event.payload?.patch, playerPatchFields)
      if (!Object.keys(patch).length) throw Object.assign(new Error('没有可更新的球员字段'), { code: 'EMPTY_PATCH' })
      validatePlayerPatch(before, patch)
      const nextStatus = patch.status ?? before.status
      const nextShirtNumber = patch.shirtNumber ?? before.shirtNumber
      const nextDisplayName = patch.displayName?.trim() || before.displayName
      if (nextStatus === 'active' && nextShirtNumber !== undefined) {
        await ensurePlayerIdentityAvailable(actor.teamId, {
          displayName: nextDisplayName,
          shirtNumber: nextShirtNumber
        }, before._id)
      }
      const after = { ...patch, updatedAt: db.serverDate() }
      await db.collection('players').doc(before._id).update({ data: after })
      await audit({ actor, action: 'updatePlayer', entityType: 'player', entityId: before._id, before, after, requestId: event.requestId })
      return ok(event, withClientId({ ...before, ...after }))
    }
    if (event.action === 'createPlayerRequest') {
      const actor = await requireManager()
      const values = validateNewPlayer(event.payload)
      const pending = await ensurePlayerIdentityAvailable(actor.teamId, values)
      if (pending.length) throw Object.assign(new Error('该号码已有待审核的新球员申请'), { code: 'SHIRT_NUMBER_CONFLICT' })
      const id = hashId('player_add', `${actor.teamId}:${values.displayName}:${values.shirtNumber}:${Date.now()}:${Math.random()}`)
      const approved = actor.role === 'owner'
      const player = approved ? await createPlayerRecord(actor, values, event.requestId) : null
      const record = {
        teamId: actor.teamId,
        ...values,
        status: approved ? 'approved' : 'pending',
        pendingKey: approved ? `closed:${id}` : `${actor.teamId}:${values.shirtNumber}`,
        requestedByOpenid: actor.openid,
        requestedByPlayerId: actor.playerId,
        requestedBy: actor.role === 'owner' ? '队长' : '管理员',
        requestedAt: now(),
        reviewedBy: approved ? '队长' : null,
        reviewedAt: approved ? now() : null,
        playerId: player?.id || null,
        version: 1
      }
      await db.collection('player_add_requests').doc(id).set({ data: record })
      await audit({ actor, action: approved ? 'createPlayerDirectly' : 'requestPlayerAddition', entityType: 'player_add_request', entityId: id, before: null, after: record, requestId: event.requestId })
      return ok(event, withClientId({ _id: id, ...record }))
    }
    if (event.action === 'reviewPlayerRequest') {
      const actor = await requireOwner()
      const id = event.payload?.id
      const before = (await db.collection('player_add_requests').doc(id).get()).data
      if (!before || before.teamId !== actor.teamId) throw Object.assign(new Error('新球员申请不存在'), { code: 'PLAYER_ADD_REQUEST_NOT_FOUND' })
      if (before.status !== 'pending') throw Object.assign(new Error('该申请已经处理'), { code: 'PLAYER_ADD_REQUEST_REVIEWED' })
      const approved = Boolean(event.payload?.approved)
      let player = null
      if (approved) {
        const conflicts = await ensurePlayerIdentityAvailable(actor.teamId, before)
        if (conflicts.some((record) => record._id !== before._id)) throw Object.assign(new Error('该号码已有其他待审核申请'), { code: 'SHIRT_NUMBER_CONFLICT' })
        player = await createPlayerRecord(actor, before, event.requestId)
      }
      const after = {
        status: approved ? 'approved' : 'rejected',
        pendingKey: `closed:${id}`,
        reviewedByOpenid: actor.openid,
        reviewedByPlayerId: actor.playerId,
        reviewedBy: '队长',
        reviewedAt: now(),
        playerId: player?.id || null,
        version: command.inc(1)
      }
      await db.collection('player_add_requests').doc(id).update({ data: after })
      await audit({ actor, action: approved ? 'approvePlayerAddition' : 'rejectPlayerAddition', entityType: 'player_add_request', entityId: id, before, after, requestId: event.requestId })
      return ok(event, withClientId({ ...before, ...after, _id: id, version: (before.version || 1) + 1 }))
    }
    if (event.action === 'updateYearbookEntry') {
      const actor = await requireManager()
      const before = (await db.collection('yearbook_entries').doc(event.payload?.id).get()).data
      if (!before || before.teamId !== actor.teamId || before.deletedAt) throw Object.assign(new Error('年鉴章节不存在'), { code: 'YEARBOOK_NOT_FOUND' })
      const patch = pickPatch(event.payload?.patch, yearbookPatchFields)
      if (!Object.keys(patch).length) throw Object.assign(new Error('没有可更新的年鉴字段'), { code: 'EMPTY_PATCH' })
      const after = { ...patch, updatedAt: db.serverDate() }
      await db.collection('yearbook_entries').doc(before._id).update({ data: after })
      await audit({ actor, action: 'updateYearbookEntry', entityType: 'yearbook_entry', entityId: before._id, before, after, requestId: event.requestId })
      return ok(event, withClientId({ ...before, ...after }))
    }
    if (event.action !== 'getSnapshot') throw Object.assign(new Error('未知球队数据操作'), { code: 'UNKNOWN_ACTION' })
    const access = await getAccess()
    if (access.memberStatus !== 'approved') return ok(event, { access, matches: [], matchStats: [], players: [], yearbook: [], signups: [], media: [], notices: [] })
    const canManage = ['admin', 'owner'].includes(access.role)
    const isOwner = access.role === 'owner'
    const feeRecordScope = canManage
      ? { teamId: access.teamId, deletedAt: command.exists(false) }
      : { teamId: access.teamId, playerId: access.playerId, deletedAt: command.exists(false) }
    const noticeRecipientScope = canManage
      ? { teamId: access.teamId }
      : { teamId: access.teamId, playerId: access.playerId }
    const [matches, matchStats, players, playerAggregates, yearbook, signups, media, notices, feePlans, feeAssignments, feePayments, feeChangeRequests, auditLogs, memberships, noticeRecipients, notificationPreferences, playerAddRequests] = await Promise.all([
      db.collection('matches').where({ teamId: access.teamId, deletedAt: command.exists(false) }).limit(200).get(),
      db.collection('player_match_stats').where({ teamId: access.teamId, deletedAt: command.exists(false) }).limit(2000).get(),
      db.collection('players').where({ teamId: access.teamId, deletedAt: command.exists(false) }).limit(200).get(),
      db.collection('player_match_stats').aggregate()
        .match({ teamId: access.teamId, countInStats: true, deletedAt: command.exists(false) })
        .group({ _id: '$playerId', goals: command.aggregate.sum('$goals'), assists: command.aggregate.sum('$assists'), apps: command.aggregate.sum(1) })
        .limit(200)
        .end(),
      db.collection('yearbook_entries').where({ teamId: access.teamId, deletedAt: command.exists(false) }).limit(200).get(),
      db.collection('signups').where({ teamId: access.teamId, deletedAt: command.exists(false) }).limit(1000).get(),
      db.collection('media_assets').where({ teamId: access.teamId, deletedAt: command.exists(false) }).limit(1000).get(),
      db.collection('team_notices').where({ teamId: access.teamId, deletedAt: command.exists(false) }).orderBy('createdAt', 'desc').limit(200).get(),
      db.collection('fee_plans').where({ teamId: access.teamId, active: true }).limit(100).get(),
      db.collection('player_fee_assignments').where(feeRecordScope).limit(1000).get(),
      db.collection('fee_payments').where(feeRecordScope).limit(1000).get(),
      canManage
        ? db.collection('fee_change_requests').where({ teamId: access.teamId }).limit(500).get()
        : Promise.resolve({ data: [] }),
      canManage
        ? db.collection('audit_logs').where({ teamId: access.teamId }).orderBy('createdAt', 'desc').limit(200).get()
        : Promise.resolve({ data: [] }),
      canManage
        ? db.collection('team_memberships').where({ teamId: access.teamId, active: true }).limit(200).get()
        : Promise.resolve({ data: [] }),
      db.collection('notice_recipients').where(noticeRecipientScope).limit(1000).get(),
      db.collection('notification_preferences').where({ teamId: access.teamId, openid: access.openid }).limit(1).get(),
      canManage
        ? db.collection('player_add_requests').where({ teamId: access.teamId }).orderBy('requestedAt', 'desc').limit(200).get()
        : Promise.resolve({ data: [] })
    ])
    const registrationCounts = new Map()
    for (const signup of signups.data) {
      if (signup.choice !== 'attending' || signup.placement !== 'confirmed' || ['pending', 'rejected'].includes(signup.approvalStatus)) continue
      registrationCounts.set(signup.matchId, (registrationCounts.get(signup.matchId) || 0) + 1)
    }
    const playerById = new Map(players.data.map((player) => [player._id, player]))
    const visibleMedia = media.data.filter((record) => {
      if (isOwner || record.reviewStatus === 'approved') return true
      if (access.role === 'admin' && record.reviewStatus === 'hidden') return true
      return record.uploaderOpenid === access.openid || record.uploaderPlayerId === access.playerId
    })
    const personalRecipientByNoticeId = new Map(
      noticeRecipients.data
        .filter((record) => record.playerId === access.playerId)
        .map((record) => [record.noticeId, record])
    )
    const recipientsByNoticeId = new Map()
    for (const recipient of noticeRecipients.data) {
      const values = recipientsByNoticeId.get(recipient.noticeId) || []
      values.push(recipient)
      recipientsByNoticeId.set(recipient.noticeId, values)
    }
    const temporaryFileUrls = await resolveTemporaryFileUrls([
      ...players.data.map((player) => player.avatarUrl),
      ...visibleMedia.flatMap((record) => [record.fileId, record.thumbnailFileId])
    ])
    const aggregateByPlayerId = new Map(playerAggregates.list.map((row) => [row._id, row]))
    return ok(event, {
      matches: matches.data.map((record) => withClientId({
        ...record,
        registrationCount: registrationCounts.get(record._id) || 0
      })),
      matchStats: matchStats.data.map((record) => ({
        matchId: record.matchId,
        playerId: record.playerId,
        ...(record.displayName ? { displayName: record.displayName, memberType: record.memberType || 'trial' } : {}),
        played: true,
        goals: Number(record.goals) || 0,
        assists: Number(record.assists) || 0
      })),
      players: players.data.map((record) => withClientId({
        ...record,
        ...(record.memberType === 'formal' ? { stats: { apps: Number(aggregateByPlayerId.get(record._id)?.apps) || 0, goals: Number(aggregateByPlayerId.get(record._id)?.goals) || 0, assists: Number(aggregateByPlayerId.get(record._id)?.assists) || 0 }, seasonStats: { apps: Number(aggregateByPlayerId.get(record._id)?.apps) || 0, goals: Number(aggregateByPlayerId.get(record._id)?.goals) || 0, assists: Number(aggregateByPlayerId.get(record._id)?.assists) || 0 } } : {}),
        avatarUrl: temporaryFileUrls.get(record.avatarUrl) || record.avatarUrl
      })),
      yearbook: yearbook.data.map(withClientId),
      signups: signups.data.map(withClientId),
      media: visibleMedia.map((record) => withClientId({
        ...record,
        uploaderId: record.uploaderId || record.uploaderPlayerId,
        fileUrl: record.fileUrl || temporaryFileUrls.get(record.fileId) || record.fileId,
        thumbnailUrl: record.thumbnailUrl || temporaryFileUrls.get(record.thumbnailFileId) || temporaryFileUrls.get(record.fileId) || record.thumbnailFileId || record.fileId
      })),
      notices: notices.data
        .filter((record) => canManage || personalRecipientByNoticeId.has(record._id))
        .map((record) => {
          const recipient = personalRecipientByNoticeId.get(record._id)
          const recipients = recipientsByNoticeId.get(record._id) || []
          const recipientStatusByPlayerId = new Map(recipients.map((item) => [item.playerId, item.deliveryStatus || 'pending']))
          return withClientId({
            ...record,
            targetPlayerId: record.targetPlayerId || null,
            targetPlayerIds: canManage ? record.targetPlayerIds || recipients.map((item) => item.playerId) : [access.playerId],
            recipientDetails: canManage
              ? (record.recipientDetails || []).map((detail) => ({
                  ...detail,
                  deliveryStatus: recipientStatusByPlayerId.get(detail.playerId) || 'pending'
                }))
              : undefined,
            content: canManage ? record.content : recipient?.content || record.content,
            readBy: (!recipient && canManage) || recipient?.readAt ? [access.playerId] : [],
            delivery: {
              total: canManage ? recipients.length : 1,
              delivered: canManage
                ? recipients.filter((item) => item.deliveryStatus === 'delivered').length
                : recipient?.deliveryStatus === 'delivered' ? 1 : 0,
              unavailable: canManage
                ? recipients.filter((item) => ['failed', 'unavailable'].includes(item.deliveryStatus)).length
                : ['failed', 'unavailable'].includes(recipient?.deliveryStatus) ? 1 : 0
            }
          })
        }),
      subscriptionEnabled: notificationPreferences.data[0]?.enabled !== false,
      feePlans: feePlans.data.map(withClientId),
      feeAssignments: feeAssignments.data.map(withClientId),
      feePayments: feePayments.data.map(withClientId),
      feeChangeRequests: feeChangeRequests.data.map(withClientId),
      playerAddRequests: playerAddRequests.data.map(withClientId),
      membershipApplications: memberships.data
        .filter((record) => record.status === 'pending')
        .map((record) => withClientId({
          _id: record._id,
          displayName: playerById.get(record.playerId)?.displayName || record.playerId,
          playerId: record.playerId,
          requestedAt: record.createdAt,
          status: record.status,
          role: record.role || 'player'
        })),
      teamRoles: memberships.data
        .filter((record) => record.status === 'approved' && record.playerId)
        .map((record) => ({
          playerId: record.playerId,
          role: record.role || 'player',
          updatedAt: record.updatedAt || record.createdAt,
          updatedBy: '云端权限记录'
        })),
      managerOperationLogs: auditLogs.data.map((record) => withClientId({
        _id: record._id,
        action: record.action,
        summary: `${record.entityType || 'record'}：${record.entityId || ''}`,
        note: record.requestId ? `请求 ID：${record.requestId}` : undefined,
        signedBy: `${playerById.get(record.actorPlayerId)?.displayName || '球队管理者'}（${record.actorRole === 'owner' ? '队长' : '管理员'}）`,
        createdAt: record.createdAt
      })),
      access
    })
  } catch (error) { return handleError(event, error) }
}
