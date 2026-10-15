const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, throwOnNotFound: false })
const db = cloud.database({ throwOnNotFound: false })
const command = db.command

const now = () => db.serverDate()
const requestId = (event) => event.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ok = (event, data) => ({ ok: true, data, requestId: requestId(event) })
const fail = (event, code, message, details) => ({ ok: false, error: { code, message, details }, requestId: requestId(event) })
const transactionValue = (value) => (
  value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'result')
    ? value.result
    : value
)

const validMembershipStatuses = new Set(['pending', 'approved', 'rejected', 'suspended'])

const getAccess = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { role: 'visitor', memberStatus: 'none' }
  const memberships = await db.collection('team_memberships').where({
    openid: OPENID,
    deletedAt: command.exists(false)
  }).limit(20).get()
  const active = memberships.data.find((record) =>
    record.active !== false &&
    record.teamId &&
    validMembershipStatuses.has(record.status)
  )
  if (active) {
    return {
      role: active.role || 'player',
      memberStatus: active.status,
      membershipId: active._id,
      teamId: active.teamId,
      playerId: active.playerId,
      openid: OPENID
    }
  }
  const rejected = memberships.data.find((record) => record.status === 'rejected')
  if (rejected) {
    return {
      role: 'visitor',
      memberStatus: 'rejected',
      teamId: rejected.teamId,
      playerId: rejected.playerId,
      openid: OPENID
    }
  }
  return { role: 'visitor', memberStatus: 'none', openid: OPENID }
}

const requireApproved = async () => {
  const access = await getAccess()
  if (access.memberStatus !== 'approved') throw Object.assign(new Error('仅审核通过的球队成员可以执行此操作'), { code: 'MEMBERS_ONLY' })
  return access
}

const requireManager = async () => {
  const access = await requireApproved()
  if (!['admin', 'owner'].includes(access.role)) throw Object.assign(new Error('需要管理员权限'), { code: 'FORBIDDEN' })
  return access
}

const requireOwner = async () => {
  const access = await requireApproved()
  if (access.role !== 'owner') throw Object.assign(new Error('只有队长可以执行此操作'), { code: 'FORBIDDEN' })
  return access
}

const audit = async ({ actor, action, entityType, entityId, before, after, requestId: id }) => {
  await db.collection('audit_logs').add({ data: { teamId: actor.teamId || null, actorOpenid: actor.openid, actorPlayerId: actor.playerId || null, actorRole: actor.role, action, entityType, entityId, before: before || null, after: after || null, requestId: id, createdAt: now() } })
}

const requireSameTeam = (actor, teamId) => {
  if (!actor.teamId || actor.teamId !== teamId) {
    throw Object.assign(new Error('不能操作其他球队的数据'), { code: 'CROSS_TEAM_FORBIDDEN' })
  }
}

const requireString = (value, code, message, maxLength = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw Object.assign(new Error(message), { code })
  }
  return value.trim()
}

const publicMatch = (record) => {
  const { exactLocation, gatheringTime, fee, kitNote, internalNote, signupSummary, ...safe } = record
  return safe
}

const normalizeServiceError = (error) => {
  const rawCode = error?.code || error?.errCode || 'INTERNAL_ERROR'
  const rawMessage = error?.message || error?.errMsg || (typeof error === 'string' ? error : '')
  const fingerprint = `${rawCode} ${rawMessage}`.toLowerCase()
  if (
    fingerprint.includes('document.get:fail') ||
    fingerprint.includes('document_not_found') ||
    fingerprint.includes('does not exist')
  ) {
    return { code: 'RESOURCE_NOT_FOUND', message: '相关数据已不存在，请刷新后重试' }
  }
  if (
    rawCode === 'INTERNAL_ERROR' ||
    typeof rawCode === 'number' ||
    /callfunction|cloud\.callfunction|database|request:fail|system error|internal server|timeout|timed out|network|errcode/.test(fingerprint)
  ) {
    return { code: 'SERVICE_UNAVAILABLE', message: '云端服务暂时不可用，请稍后重试' }
  }
  return { code: String(rawCode), message: rawMessage || '服务暂时不可用，请稍后重试' }
}

const handleError = (event, error) => {
  const { code, message } = normalizeServiceError(error)
  return fail(event, code, message)
}

module.exports = {
  cloud,
  db,
  command,
  now,
  ok,
  fail,
  transactionValue,
  getAccess,
  requireApproved,
  requireManager,
  requireOwner,
  requireSameTeam,
  requireString,
  audit,
  publicMatch,
  normalizeServiceError,
  handleError
}
