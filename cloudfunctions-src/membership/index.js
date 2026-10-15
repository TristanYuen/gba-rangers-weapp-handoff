const crypto = require('node:crypto')
const {
  db,
  command,
  now,
  ok,
  getAccess,
  requireManager,
  requireOwner,
  requireSameTeam,
  requireString,
  audit,
  transactionValue,
  handleError
} = require('./common')

const activeStatuses = ['pending', 'approved', 'suspended']
const allowedRoles = ['player', 'admin', 'owner']
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const membershipIdFor = (teamId, openid) => `member-${hash(`${teamId}:${openid}`).slice(0, 32)}`
const playerLockIdFor = (teamId, playerId) => `claim-${hash(`${teamId}:${playerId}`).slice(0, 32)}`
const activeKeys = (teamId, openid, playerId) => ({
  uniqueKey: `${teamId}:${openid}`,
  openidKey: `${teamId}:${openid}`,
  playerKey: `${teamId}:${playerId}`
})
const historicalKeys = (membershipId) => ({
  uniqueKey: `history:${membershipId}`,
  openidKey: `history:${membershipId}:openid`,
  playerKey: `history:${membershipId}:player`
})
const readOptionalDocument = async (document) => {
  try {
    return (await document.get()).data || null
  } catch (error) {
    const message = error?.message || error?.errMsg || String(error)
    if (message.includes('does not exist') || message.includes('DOCUMENT_NOT_FOUND')) return null
    throw error
  }
}

const getTeamByInviteCode = async (inviteCode) => {
  const code = requireString(inviteCode, 'INVALID_INVITE_CODE', '请输入球队邀请码', 80)
  const result = await db.collection('teams').where({
    inviteCode: code.toUpperCase(),
    deletedAt: command.exists(false)
  }).limit(1).get()
  if (!result.data[0]) {
    throw Object.assign(new Error('球队邀请码无效'), { code: 'INVALID_INVITE_CODE' })
  }
  return result.data[0]
}

const readPlayer = async (client, playerId, teamId) => {
  const result = await client.collection('players').doc(playerId).get()
  const player = result.data
  if (!player || player.teamId !== teamId || player.deletedAt || player.memberType !== 'formal' || player.status === 'former') {
    throw Object.assign(new Error('该球员不能认领'), { code: 'PLAYER_NOT_CLAIMABLE' })
  }
  return player
}

const listClaimablePlayers = async (payload) => {
  const team = await getTeamByInviteCode(payload.inviteCode)
  const [players, locks] = await Promise.all([
    db.collection('players').where({
      teamId: team._id,
      memberType: 'formal',
      deletedAt: command.exists(false)
    }).limit(200).get(),
    db.collection('identity_claim_locks').where({
      teamId: team._id,
      active: true
    }).limit(200).get()
  ])
  const occupied = new Set(locks.data.map((record) => record.playerId))
  return {
    team: { id: team._id, name: team.name || 'GBA RANGERS' },
    players: players.data
      .filter((player) => player.status !== 'former' && !occupied.has(player._id))
      .map((player) => ({
        id: player._id,
        displayName: player.displayName,
        shirtNumber: player.shirtNumber,
        position: player.position
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'))
  }
}

const getAccountOverview = async () => {
  const access = await getAccess()
  if (access.memberStatus !== 'approved') {
    return { access, player: null, subscriptionEnabled: true }
  }
  const [player, preferences] = await Promise.all([
    access.playerId ? readOptionalDocument(db.collection('players').doc(access.playerId)) : Promise.resolve(null),
    db.collection('notification_preferences').where({
      teamId: access.teamId,
      openid: access.openid
    }).limit(1).get()
  ])
  return {
    access,
    player: player ? { ...player, ...(player.memberType === 'formal' ? { seasonStats: { ...player.stats } } : {}), id: player.id || player._id } : null,
    subscriptionEnabled: preferences.data[0]?.enabled !== false
  }
}

const requestClaim = async (event, payload) => {
  const access = await getAccess()
  if (!access.openid) {
    throw Object.assign(new Error('无法获取微信身份'), { code: 'IDENTITY_UNAVAILABLE' })
  }
  if (activeStatuses.includes(access.memberStatus)) {
    throw Object.assign(new Error('当前微信已经提交过认领或完成绑定'), { code: 'MEMBERSHIP_EXISTS' })
  }
  const team = await getTeamByInviteCode(payload.inviteCode)
  const playerId = requireString(payload.playerId, 'PLAYER_REQUIRED', '请选择本人姓名', 100)
  const membershipId = membershipIdFor(team._id, access.openid)
  const lockId = playerLockIdFor(team._id, playerId)
  const transactionResult = await db.runTransaction(async (transaction) => {
    const existingMembership = await readOptionalDocument(
      transaction.collection('team_memberships').doc(membershipId)
    )
    if (existingMembership?.active !== false && activeStatuses.includes(existingMembership?.status)) {
      throw Object.assign(new Error('当前微信已经提交过认领或完成绑定'), { code: 'MEMBERSHIP_EXISTS' })
    }
    await readPlayer(transaction, playerId, team._id)
    const existingLock = await readOptionalDocument(
      transaction.collection('identity_claim_locks').doc(lockId)
    )
    if (existingLock?.active) {
      throw Object.assign(new Error('该球员已经被认领或正在审核'), { code: 'PLAYER_ALREADY_CLAIMED' })
    }
    const membership = {
      ...activeKeys(team._id, access.openid, playerId),
      teamId: team._id,
      openid: access.openid,
      playerId,
      role: 'player',
      status: 'pending',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      version: 1
    }
    await transaction.collection('team_memberships').doc(membershipId).set({ data: membership })
    await transaction.collection('identity_claim_locks').doc(lockId).set({
      data: {
        teamId: team._id,
        playerId,
        openid: access.openid,
        membershipId,
        status: 'pending',
        active: true,
        createdAt: now(),
        updatedAt: now()
      }
    })
    return {
      id: membershipId,
      teamId: team._id,
      playerId,
      role: membership.role,
      status: membership.status
    }
  })
  return ok(event, transactionValue(transactionResult))
}

const bootstrapOwner = async (event, payload) => {
  const access = await getAccess()
  if (!access.openid) {
    throw Object.assign(new Error('无法获取微信身份'), { code: 'IDENTITY_UNAVAILABLE' })
  }
  if (activeStatuses.includes(access.memberStatus)) {
    throw Object.assign(new Error('当前微信已经绑定球队身份'), { code: 'MEMBERSHIP_EXISTS' })
  }
  const code = requireString(payload.code, 'BOOTSTRAP_CODE_REQUIRED', '请输入专属队长邀请码', 120)
  const codeHash = hash(code.toUpperCase())
  const invitationResult = await db.collection('identity_invites').where({
    codeHash,
    type: 'bootstrap_owner',
    active: true
  }).limit(1).get()
  const invitation = invitationResult.data[0]
  if (!invitation) {
    throw Object.assign(new Error('专属队长邀请码无效'), { code: 'INVALID_BOOTSTRAP_CODE' })
  }
  const expiresAt = new Date(invitation.expiresAt).getTime()
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw Object.assign(new Error('专属队长邀请码已过期'), { code: 'BOOTSTRAP_CODE_EXPIRED' })
  }
  const membershipId = membershipIdFor(invitation.teamId, access.openid)
  const lockId = playerLockIdFor(invitation.teamId, invitation.playerId)
  const transactionResult = await db.runTransaction(async (transaction) => {
    const currentInvitation = (await transaction.collection('identity_invites').doc(invitation._id).get()).data
    if (!currentInvitation?.active || currentInvitation.usedAt) {
      throw Object.assign(new Error('专属队长邀请码已经使用'), { code: 'BOOTSTRAP_CODE_USED' })
    }
    await readPlayer(transaction, invitation.playerId, invitation.teamId)
    const existingLock = await readOptionalDocument(
      transaction.collection('identity_claim_locks').doc(lockId)
    )
    if (existingLock?.active) {
      throw Object.assign(new Error('黄震杰的身份已经被认领'), { code: 'PLAYER_ALREADY_CLAIMED' })
    }
    const existingMembership = await readOptionalDocument(
      transaction.collection('team_memberships').doc(membershipId)
    )
    if (existingMembership?.active !== false && activeStatuses.includes(existingMembership?.status)) {
      throw Object.assign(new Error('当前微信已经绑定球队身份'), { code: 'MEMBERSHIP_EXISTS' })
    }
    const membership = {
      ...activeKeys(invitation.teamId, access.openid, invitation.playerId),
      teamId: invitation.teamId,
      openid: access.openid,
      playerId: invitation.playerId,
      role: 'owner',
      status: 'approved',
      active: true,
      createdAt: now(),
      updatedAt: now(),
      approvedAt: now(),
      version: 1
    }
    await transaction.collection('team_memberships').doc(membershipId).set({ data: membership })
    await transaction.collection('identity_claim_locks').doc(lockId).set({
      data: {
        teamId: invitation.teamId,
        playerId: invitation.playerId,
        openid: access.openid,
        membershipId,
        status: 'approved',
        active: true,
        createdAt: now(),
        updatedAt: now()
      }
    })
    await transaction.collection('identity_invites').doc(invitation._id).update({
      data: {
        active: false,
        usedAt: now(),
        usedByOpenid: access.openid,
        updatedAt: now()
      }
    })
    await transaction.collection('teams').doc(invitation.teamId).update({
      data: { ownerCount: command.inc(1), updatedAt: now() }
    })
    await transaction.collection('audit_logs').add({
      data: {
        teamId: invitation.teamId,
        actorOpenid: access.openid,
        actorRole: 'owner',
        action: 'bootstrapOwner',
        entityType: 'team_membership',
        entityId: membershipId,
        before: null,
        after: { teamId: invitation.teamId, playerId: invitation.playerId, role: 'owner', status: 'approved' },
        requestId: event.requestId || null,
        createdAt: now()
      }
    })
    return {
      id: membershipId,
      teamId: invitation.teamId,
      playerId: invitation.playerId,
      role: membership.role,
      status: membership.status
    }
  })
  return ok(event, transactionValue(transactionResult))
}

const listPendingClaims = async (event) => {
  const actor = await requireManager()
  const memberships = await db.collection('team_memberships').where({
    teamId: actor.teamId,
    status: 'pending',
    active: true,
    deletedAt: command.exists(false)
  }).orderBy('createdAt', 'asc').limit(200).get()
  const rows = await Promise.all(memberships.data.map(async (membership) => {
    const player = (await db.collection('players').doc(membership.playerId).get()).data
    return {
      id: membership._id,
      playerId: membership.playerId,
      displayName: player?.displayName || '未知球员',
      shirtNumber: player?.shirtNumber,
      position: player?.position,
      requestedAt: membership.createdAt,
      status: membership.status,
      role: membership.role,
      version: membership.version
    }
  }))
  return ok(event, rows)
}

const reviewClaim = async (event, payload) => {
  const actor = await requireManager()
  const membershipId = requireString(payload.id, 'MEMBERSHIP_REQUIRED', '成员申请不存在', 100)
  if (!['approved', 'rejected'].includes(payload.status)) {
    throw Object.assign(new Error('审核结果无效'), { code: 'INVALID_REVIEW_STATUS' })
  }
  const before = (await db.collection('team_memberships').doc(membershipId).get()).data
  if (!before || before.status !== 'pending' || before.active !== true) {
    throw Object.assign(new Error('申请不存在或已经处理'), { code: 'MEMBERSHIP_NOT_PENDING' })
  }
  requireSameTeam(actor, before.teamId)
  const lockId = playerLockIdFor(before.teamId, before.playerId)
  const transactionResult = await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection('team_memberships').doc(membershipId).get()).data
    if (!current || current.status !== 'pending' || current.active !== true) {
      throw Object.assign(new Error('申请已经被其他管理员处理'), { code: 'MEMBERSHIP_ALREADY_REVIEWED' })
    }
    const lock = (await transaction.collection('identity_claim_locks').doc(lockId).get()).data
    if (!lock || lock.membershipId !== membershipId || !lock.active) {
      throw Object.assign(new Error('认领锁状态异常'), { code: 'CLAIM_LOCK_INVALID' })
    }
    if (payload.status === 'approved') {
      const approved = {
        status: 'approved',
        approvedBy: actor.openid,
        approvedAt: now(),
        updatedAt: now(),
        version: command.inc(1)
      }
      await transaction.collection('team_memberships').doc(membershipId).update({ data: approved })
      await transaction.collection('identity_claim_locks').doc(lockId).update({
        data: { status: 'approved', updatedAt: now() }
      })
      await transaction.collection('audit_logs').add({
        data: {
          teamId: current.teamId,
          actorOpenid: actor.openid,
          actorRole: actor.role,
          action: 'approveIdentityClaim',
          entityType: 'team_membership',
          entityId: membershipId,
          before: { status: 'pending', playerId: current.playerId },
          after: { status: 'approved', playerId: current.playerId, role: current.role },
          requestId: event.requestId || null,
          createdAt: now()
        }
      })
      return { id: membershipId, status: 'approved' }
    }
    const rejected = {
      ...historicalKeys(membershipId),
      status: 'rejected',
      active: false,
      rejectedBy: actor.openid,
      rejectedAt: now(),
      updatedAt: now(),
      version: command.inc(1)
    }
    await transaction.collection('team_memberships').doc(membershipId).update({ data: rejected })
    await transaction.collection('identity_claim_locks').doc(lockId).update({
      data: {
        status: 'released',
        active: false,
        releasedAt: now(),
        updatedAt: now()
      }
    })
    await transaction.collection('audit_logs').add({
      data: {
        teamId: current.teamId,
        actorOpenid: actor.openid,
        actorRole: actor.role,
        action: 'rejectIdentityClaim',
        entityType: 'team_membership',
        entityId: membershipId,
        before: { status: 'pending', playerId: current.playerId },
        after: { status: 'rejected', playerId: current.playerId },
        requestId: event.requestId || null,
        createdAt: now()
      }
    })
    return { id: membershipId, status: 'rejected', active: false }
  })
  return ok(event, transactionValue(transactionResult))
}

const listTeamMembers = async (event) => {
  const actor = await requireManager()
  const memberships = await db.collection('team_memberships').where({
    teamId: actor.teamId,
    status: 'approved',
    active: true,
    deletedAt: command.exists(false)
  }).limit(200).get()
  const rows = await Promise.all(memberships.data.map(async (membership) => {
    const player = (await db.collection('players').doc(membership.playerId).get()).data
    return {
      id: membership._id,
      playerId: membership.playerId,
      displayName: player?.displayName || '未知球员',
      shirtNumber: player?.shirtNumber,
      role: membership.role,
      status: membership.status,
      version: membership.version
    }
  }))
  return ok(event, rows.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN')))
}

const setRole = async (event, payload) => {
  const actor = await requireOwner()
  const membershipId = requireString(payload.id, 'MEMBERSHIP_REQUIRED', '成员不存在', 100)
  const role = requireString(payload.role, 'INVALID_ROLE', '成员角色无效', 20)
  if (!allowedRoles.includes(role)) {
    throw Object.assign(new Error('成员角色无效'), { code: 'INVALID_ROLE' })
  }
  const before = (await db.collection('team_memberships').doc(membershipId).get()).data
  if (!before || before.status !== 'approved' || before.active !== true) {
    throw Object.assign(new Error('成员不存在'), { code: 'MEMBERSHIP_NOT_FOUND' })
  }
  requireSameTeam(actor, before.teamId)
  if (before.role === role) return ok(event, { id: membershipId, ...before })
  const ownerCountResult = await db.collection('team_memberships').where({
    teamId: before.teamId,
    role: 'owner',
    status: 'approved',
    active: true
  }).count()
  if (before.role === 'owner' && role !== 'owner' && ownerCountResult.total <= 1) {
    throw Object.assign(new Error('球队必须至少保留一名队长'), { code: 'LAST_OWNER_PROTECTED' })
  }
  const after = {
    role,
    updatedAt: now(),
    updatedBy: actor.openid,
    version: command.inc(1)
  }
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection('team_memberships').doc(membershipId).get()).data
    if (!current || current.role !== before.role || current.version !== before.version) {
      throw Object.assign(new Error('成员权限已经发生变化，请刷新后重试'), { code: 'VERSION_CONFLICT' })
    }
    const team = (await transaction.collection('teams').doc(before.teamId).get()).data
    if (!team) throw Object.assign(new Error('球队不存在'), { code: 'TEAM_NOT_FOUND' })
    if (current.role === 'owner' && role !== 'owner' && Number(team.ownerCount || 0) <= 1) {
      throw Object.assign(new Error('球队必须至少保留一名队长'), { code: 'LAST_OWNER_PROTECTED' })
    }
    await transaction.collection('team_memberships').doc(membershipId).update({ data: after })
    const ownerDelta = (before.role === 'owner' ? -1 : 0) + (role === 'owner' ? 1 : 0)
    if (ownerDelta) {
      await transaction.collection('teams').doc(before.teamId).update({
        data: { ownerCount: command.inc(ownerDelta), updatedAt: now() }
      })
    }
    await transaction.collection('audit_logs').add({
      data: {
        teamId: before.teamId,
        actorOpenid: actor.openid,
        actorRole: actor.role,
        action: 'setMemberRole',
        entityType: 'team_membership',
        entityId: membershipId,
        before: { role: before.role },
        after: { role },
        requestId: event.requestId || null,
        createdAt: now()
      }
    })
  })
  return ok(event, { id: membershipId, ...before, ...after, role })
}

const unbindIdentity = async (event, payload) => {
  const actor = await requireOwner()
  const membershipId = requireString(payload.id, 'MEMBERSHIP_REQUIRED', '成员不存在', 100)
  const before = (await db.collection('team_memberships').doc(membershipId).get()).data
  if (!before || before.status !== 'approved' || before.active !== true) {
    throw Object.assign(new Error('成员不存在'), { code: 'MEMBERSHIP_NOT_FOUND' })
  }
  requireSameTeam(actor, before.teamId)
  if (before.role === 'owner') {
    const owners = await db.collection('team_memberships').where({
      teamId: before.teamId,
      role: 'owner',
      status: 'approved',
      active: true
    }).count()
    if (owners.total <= 1) {
      throw Object.assign(new Error('球队必须至少保留一名队长'), { code: 'LAST_OWNER_PROTECTED' })
    }
  }
  const lockId = playerLockIdFor(before.teamId, before.playerId)
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.collection('team_memberships').doc(membershipId).get()).data
    if (!current || current.active !== true || current.version !== before.version) {
      throw Object.assign(new Error('成员状态已经发生变化，请刷新后重试'), { code: 'VERSION_CONFLICT' })
    }
    const team = (await transaction.collection('teams').doc(before.teamId).get()).data
    if (!team) throw Object.assign(new Error('球队不存在'), { code: 'TEAM_NOT_FOUND' })
    if (current.role === 'owner' && Number(team.ownerCount || 0) <= 1) {
      throw Object.assign(new Error('球队必须至少保留一名队长'), { code: 'LAST_OWNER_PROTECTED' })
    }
    await transaction.collection('team_memberships').doc(membershipId).update({
      data: {
        ...historicalKeys(membershipId),
        status: 'unbound',
        active: false,
        unboundBy: actor.openid,
        unboundAt: now(),
        updatedAt: now(),
        version: command.inc(1)
      }
    })
    await transaction.collection('identity_claim_locks').doc(lockId).update({
      data: { status: 'released', active: false, releasedAt: now(), updatedAt: now() }
    })
    if (before.role === 'owner') {
      await transaction.collection('teams').doc(before.teamId).update({
        data: { ownerCount: command.inc(-1), updatedAt: now() }
      })
    }
    await transaction.collection('audit_logs').add({
      data: {
        teamId: before.teamId,
        actorOpenid: actor.openid,
        actorRole: actor.role,
        action: 'unbindIdentity',
        entityType: 'team_membership',
        entityId: membershipId,
        before: { playerId: before.playerId, role: before.role, status: before.status },
        after: { playerId: before.playerId, status: 'unbound' },
        requestId: event.requestId || null,
        createdAt: now()
      }
    })
  })
  return ok(event, { id: membershipId, status: 'unbound' })
}

exports.main = async (event) => {
  try {
    const payload = event.payload || {}
    if (event.action === 'getMyAccess' || event.action === 'getSession') return ok(event, await getAccess())
    if (event.action === 'getAccountOverview') return ok(event, await getAccountOverview())
    if (event.action === 'listClaimablePlayers') return ok(event, await listClaimablePlayers(payload))
    if (event.action === 'requestClaim') return await requestClaim(event, payload)
    if (event.action === 'bootstrapOwner') return await bootstrapOwner(event, payload)
    if (event.action === 'listPendingClaims') return await listPendingClaims(event)
    if (event.action === 'reviewClaim') return await reviewClaim(event, payload)
    if (event.action === 'listTeamMembers') return await listTeamMembers(event)
    if (event.action === 'setRole') return await setRole(event, payload)
    if (event.action === 'unbindIdentity') return await unbindIdentity(event, payload)
    if (['requestJoinTeam', 'reviewMembership', 'setAdministrator'].includes(event.action)) {
      throw Object.assign(new Error('当前客户端版本过旧，请更新后重试'), { code: 'CLIENT_UPDATE_REQUIRED' })
    }
    throw Object.assign(new Error('未知成员操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) { return handleError(event, error) }
}
