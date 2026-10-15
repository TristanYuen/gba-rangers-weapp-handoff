const { db, command, now, ok, requireApproved, requireManager, requireSameTeam, requireString, audit, handleError } = require('./common')

const allowedMatchFields = new Set([
  'title',
  'opponent',
  'eventType',
  'matchDate',
  'kickoffTime',
  'publicArea',
  'exactLocation',
  'latitude',
  'longitude',
  'gatheringTime',
  'capacityEnabled',
  'capacity',
  'format',
  'jerseyRequirement',
  'jerseyCustomNote',
  'registrationDeadline',
  'status',
  'countInStats',
  'internalNote'
])
const sanitizeMatchInput = (input) => Object.fromEntries(
  Object.entries(input || {}).filter(([key]) => allowedMatchFields.has(key))
)
const syncRegistrationCount = async (teamId, matchId) => {
  const confirmed = await db.collection('signups').where({
    teamId,
    matchId,
    choice: 'attending',
    placement: 'confirmed'
  }).count()
  await db.collection('matches').doc(matchId).update({
    data: { registrationCount: confirmed.total, registrationCountUpdatedAt: now() }
  })
  return confirmed.total
}

exports.main = async (event) => {
  try {
    const payload = event.payload || {}
    if (event.action === 'createOrUpdateMatch') {
      const actor = await requireManager()
      const input = payload.match || {}
      const title = requireString(input.title, 'INVALID_MATCH', '请填写赛事标题', 120)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.matchDate || '') || !input.exactLocation || !input.gatheringTime) throw Object.assign(new Error('缺少必填赛事字段'), { code: 'INVALID_MATCH' })
      if (!['versus', 'event'].includes(input.eventType)) throw Object.assign(new Error('赛事类型无效'), { code: 'INVALID_MATCH' })
      if (!['5-a-side', '7-a-side', '8-a-side', '11-a-side', 'custom'].includes(input.format)) throw Object.assign(new Error('赛制无效'), { code: 'INVALID_MATCH' })
      if (!['draft', 'published', 'registration_closed', 'cancelled', 'completed', 'completed_pending_score'].includes(input.status)) throw Object.assign(new Error('赛事状态无效'), { code: 'INVALID_MATCH' })
      if (input.capacityEnabled !== false && (!Number.isInteger(input.capacity) || input.capacity <= 0 || input.capacity > 200)) throw Object.assign(new Error('报名人数上限无效'), { code: 'INVALID_MATCH' })
      const rawId = input._id || input.id
      const id = rawId ? requireString(rawId, 'INVALID_MATCH_ID', '赛事 ID 无效', 100) : undefined
      const before = id ? (await db.collection('matches').doc(id).get()).data : null
      if (before) requireSameTeam(actor, before.teamId)
      if (before && payload.expectedVersion !== before.version) throw Object.assign(new Error('赛事已被其他管理员修改，请刷新'), { code: 'VERSION_CONFLICT' })
      const record = {
        ...sanitizeMatchInput(input),
        title,
        teamId: actor.teamId,
        updatedAt: now(),
        version: before ? before.version + 1 : 1
      }
      let entityId = id
      if (before) await db.collection('matches').doc(id).update({ data: record })
      else if (id) await db.collection('matches').doc(id).set({ data: { ...record, createdAt: now() } })
      else entityId = (await db.collection('matches').add({ data: { ...record, createdAt: now() } }))._id
      await audit({ actor, action: 'createOrUpdateMatch', entityType: 'match', entityId, before, after: record, requestId: event.requestId })
      if (record.status === 'published' && before?.status !== 'published') {
        await db.collection('notification_jobs').add({ data: { teamId: actor.teamId, eventName: 'match_published', matchId: entityId, audience: 'approved_members', status: 'pending', createdAt: now() } })
      }
      return ok(event, { id: entityId, ...record })
    }
    if (event.action === 'updateSignup') {
      const actor = await requireApproved()
      const match = (await db.collection('matches').doc(payload.matchId).get()).data
      if (!match) throw Object.assign(new Error('赛事不存在'), { code: 'MATCH_NOT_FOUND' })
      requireSameTeam(actor, match.teamId)
      if (match.status !== 'published' && !['admin', 'owner'].includes(actor.role)) throw Object.assign(new Error('报名已经截止'), { code: 'REGISTRATION_CLOSED' })
      const playerId = actor.role === 'player' ? actor.playerId : payload.playerId
      if (!playerId) throw Object.assign(new Error('球员档案尚未绑定'), { code: 'PLAYER_NOT_BOUND' })
      if (!['attending', 'maybe', 'absent'].includes(payload.choice)) throw Object.assign(new Error('报名状态无效'), { code: 'INVALID_SIGNUP_CHOICE' })
      const player = (await db.collection('players').doc(playerId).get()).data
      if (!player || player.teamId !== actor.teamId || player.deletedAt) throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
      if (payload.choice === 'maybe') {
        if (!payload.pendingUntil) throw Object.assign(new Error('请选择待定截止时间'), { code: 'PENDING_UNTIL_REQUIRED' })
        const pendingTime = new Date(payload.pendingUntil).getTime()
        const latestTime = new Date(match.registrationDeadline || `${match.matchDate}T${match.kickoffTime || '23:59'}:00+08:00`).getTime()
        if (!Number.isFinite(pendingTime) || pendingTime <= Date.now() || pendingTime > latestTime) throw Object.assign(new Error('待定截止时间无效'), { code: 'INVALID_PENDING_UNTIL' })
      }
      const signupType = payload.signupType || 'self'
      if (!['self', 'trial_companion', 'guest_companion'].includes(signupType)) throw Object.assign(new Error('报名类型无效'), { code: 'INVALID_SIGNUP_TYPE' })
      const companionName = signupType !== 'self'
        ? requireString(payload.companionName, 'COMPANION_NAME_REQUIRED', '请填写同行人员姓名', 80)
        : undefined
      const note = payload.note
        ? requireString(payload.note, 'INVALID_SIGNUP_NOTE', '报名备注无效', 200)
        : undefined
      const uniqueKey = `${payload.matchId}:${playerId}`
      const existing = await db.collection('signups').where({ teamId: actor.teamId, uniqueKey }).limit(1).get()
      const currentConfirmed = await db.collection('signups').where({ teamId: actor.teamId, matchId: payload.matchId, choice: 'attending', placement: 'confirmed' }).count()
      const needsApproval = signupType !== 'self'
      const placement = payload.choice === 'attending' && !needsApproval
        ? (match.capacityEnabled === false || currentConfirmed.total < match.capacity || existing.data[0]?.placement === 'confirmed' ? 'confirmed' : 'waitlisted')
        : 'not_applicable'
      const record = {
        uniqueKey,
        teamId: actor.teamId,
        matchId: payload.matchId,
        playerId,
        choice: payload.choice,
        signupType,
        ...(needsApproval ? { companionName } : {}),
        approvalStatus: needsApproval ? 'pending' : 'not_required',
        reminderStatus: payload.choice === 'maybe' ? 'scheduled' : 'cancelled',
        ...(note ? { note } : {}),
        placement,
        ...(payload.choice === 'maybe' ? { pendingUntil: payload.pendingUntil } : {}),
        updatedAt: now(),
        version: (existing.data[0]?.version || 0) + 1
      }
      if (existing.data[0]) await db.collection('signups').doc(existing.data[0]._id).set({ data: record })
      else await db.collection('signups').add({ data: { ...record, createdAt: now() } })
      const registrationCount = await syncRegistrationCount(actor.teamId, payload.matchId)
      if (payload.choice === 'maybe') {
        await db.collection('notification_jobs').add({ data: { teamId: actor.teamId, eventName: 'pending_confirmation', matchId: payload.matchId, playerId, signupKey: uniqueKey, runAt: new Date(payload.pendingUntil), status: 'scheduled', createdAt: now() } })
      }
      return ok(event, { ...record, registrationCount })
    }
    if (event.action === 'reviewSpecialSignup') {
      const actor = await requireManager()
      const signup = (await db.collection('signups').doc(payload.signupId).get()).data
      if (!signup) throw Object.assign(new Error('报名记录不存在'), { code: 'SIGNUP_NOT_FOUND' })
      requireSameTeam(actor, signup.teamId)
      if (signup.signupType === 'self') throw Object.assign(new Error('该报名无需审核'), { code: 'SIGNUP_NOT_REVIEWABLE' })
      const match = (await db.collection('matches').doc(signup.matchId).get()).data
      const confirmed = await db.collection('signups').where({ teamId: actor.teamId, matchId: signup.matchId, choice: 'attending', placement: 'confirmed' }).count()
      const approved = Boolean(payload.approved)
      const placement = approved && signup.choice === 'attending'
        ? (match.capacityEnabled === false || confirmed.total < match.capacity ? 'confirmed' : 'waitlisted')
        : 'not_applicable'
      const after = { approvalStatus: approved ? 'approved' : 'rejected', placement, updatedAt: now(), version: command.inc(1) }
      await db.collection('signups').doc(payload.signupId).update({ data: after })
      const registrationCount = await syncRegistrationCount(actor.teamId, signup.matchId)
      await audit({ actor, action: approved ? 'approveSpecialSignup' : 'rejectSpecialSignup', entityType: 'signup', entityId: payload.signupId, before: signup, after, requestId: event.requestId })
      return ok(event, { id: payload.signupId, matchId: signup.matchId, registrationCount, ...after })
    }
    if (event.action === 'closeRegistration') {
      const actor = await requireManager()
      const before = (await db.collection('matches').doc(payload.matchId).get()).data
      if (!before) throw Object.assign(new Error('赛事不存在'), { code: 'MATCH_NOT_FOUND' })
      requireSameTeam(actor, before.teamId)
      await db.collection('matches').doc(payload.matchId).update({ data: { status: 'registration_closed', updatedAt: now(), version: command.inc(1) } })
      await audit({ actor, action: 'closeRegistration', entityType: 'match', entityId: payload.matchId, before, after: { status: 'registration_closed' }, requestId: event.requestId })
      return ok(event, { id: payload.matchId, status: 'registration_closed' })
    }
    if (event.action === 'changeMatchStatus') {
      const actor = await requireManager()
      const allowed = ['draft', 'published', 'registration_closed', 'cancelled']
      if (!allowed.includes(payload.status)) throw Object.assign(new Error('不支持的赛事状态'), { code: 'INVALID_STATUS' })
      const before = (await db.collection('matches').doc(payload.matchId).get()).data
      if (!before) throw Object.assign(new Error('赛事不存在'), { code: 'MATCH_NOT_FOUND' })
      requireSameTeam(actor, before.teamId)
      if (payload.expectedVersion !== before.version) throw Object.assign(new Error('赛事已被其他管理员修改，请刷新'), { code: 'VERSION_CONFLICT' })
      const after = { status: payload.status, countInStats: payload.status === 'cancelled' ? false : before.countInStats, updatedAt: now(), version: command.inc(1) }
      await db.collection('matches').doc(payload.matchId).update({ data: after })
      await audit({ actor, action: 'changeMatchStatus', entityType: 'match', entityId: payload.matchId, before, after, requestId: event.requestId })
      return ok(event, { id: payload.matchId, ...after })
    }
    if (event.action === 'deleteMatch') {
      const actor = await requireManager()
      const before = (await db.collection('matches').doc(payload.matchId).get()).data
      if (!before || before.deletedAt) throw Object.assign(new Error('赛事不存在'), { code: 'MATCH_NOT_FOUND' })
      requireSameTeam(actor, before.teamId)
      if (!['completed', 'completed_pending_score', 'cancelled'].includes(before.status)) {
        throw Object.assign(new Error('只有历史赛事可以删除'), { code: 'MATCH_NOT_HISTORICAL' })
      }
      if (payload.expectedVersion !== before.version) throw Object.assign(new Error('赛事已被其他管理员修改，请刷新'), { code: 'VERSION_CONFLICT' })
      const deletedAt = now()
      const after = { deletedAt, updatedAt: deletedAt, version: command.inc(1) }
      await db.collection('matches').doc(payload.matchId).update({ data: after })
      const relatedScopes = [
        ['signups', { teamId: actor.teamId, matchId: payload.matchId, deletedAt: command.exists(false) }],
        ['player_match_stats', { teamId: actor.teamId, matchId: payload.matchId, deletedAt: command.exists(false) }],
        ['appearances', { teamId: actor.teamId, matchId: payload.matchId, deletedAt: command.exists(false) }],
        ['yearbook_entries', { teamId: actor.teamId, matchId: payload.matchId, deletedAt: command.exists(false) }],
        ['notification_jobs', { teamId: actor.teamId, matchId: payload.matchId, deletedAt: command.exists(false) }]
      ]
      await Promise.all(relatedScopes.map(([collection, scope]) => db.collection(collection).where(scope).update({ data: { deletedAt, updatedAt: deletedAt } })))
      const [stats, players] = await Promise.all([
        db.collection('player_match_stats').aggregate()
          .match({ teamId: actor.teamId, countInStats: true, deletedAt: command.exists(false) })
          .group({
            _id: '$playerId',
            goals: command.aggregate.sum('$goals'),
            assists: command.aggregate.sum('$assists'),
            apps: command.aggregate.sum(1)
          })
          .limit(200)
        .end(),
        db.collection('players').where({ teamId: actor.teamId, deletedAt: command.exists(false) }).limit(200).get()
      ])
      const statsByPlayer = new Map(stats.list.map((row) => [row._id, row]))
      await Promise.all(players.data.map((player) => {
        const aggregate = statsByPlayer.get(player._id)
        return db.collection('players').doc(player._id).update({
          data: {
            stats: {
              apps: aggregate?.apps || 0,
              goals: aggregate?.goals || 0,
              assists: aggregate?.assists || 0
            },
seasonStats: {
              apps: aggregate?.apps || 0,
              goals: aggregate?.goals || 0,
              assists: aggregate?.assists || 0
            },
            updatedAt: deletedAt
          }
        })
      }))
      await audit({ actor, action: 'deleteMatch', entityType: 'match', entityId: payload.matchId, before, after: { deleted: true }, requestId: event.requestId })
      return ok(event, { id: payload.matchId, deleted: true })
    }
    throw Object.assign(new Error('未知赛事操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) { return handleError(event, error) }
}
