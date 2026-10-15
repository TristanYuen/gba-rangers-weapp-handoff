const crypto = require('crypto')
const {
  db,
  now,
  ok,
  requireManager,
  requireOwner,
  requireSameTeam,
  requireString,
  audit,
  transactionValue,
  handleError
} = require('./common')

const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/
const paymentStatuses = new Set(['paid', 'unpaid'])
const reviewDecisions = new Set(['approved', 'rejected'])
const hashId = (prefix, value) => `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)}`
const withClientId = (record) => record ? { ...record, id: record.id || record._id } : record

const validatePeriod = (value, field = '月份') => {
  if (!periodPattern.test(value || '')) {
    throw Object.assign(new Error(`${field}格式无效`), { code: 'INVALID_FEE_PERIOD' })
  }
  return value
}

const readTeamPlayer = async (playerId, teamId, transaction = db) => {
  const player = (await transaction.collection('players').doc(playerId).get()).data
  if (!player || player.teamId !== teamId || player.deletedAt) {
    throw Object.assign(new Error('球员不存在'), { code: 'PLAYER_NOT_FOUND' })
  }
  return player
}

const readTeamPlan = async (feePlanId, teamId, transaction = db) => {
  const plan = (await transaction.collection('fee_plans').doc(feePlanId).get()).data
  if (!plan || plan.teamId !== teamId || plan.active !== true) {
    throw Object.assign(new Error('会费类型不存在或已停用'), { code: 'FEE_PLAN_NOT_FOUND' })
  }
  return plan
}

const validateFeeChange = async (payload, actor, transaction = db) => {
  const playerId = requireString(payload.playerId, 'PLAYER_REQUIRED', '请选择球员', 80)
  const feePlanId = requireString(payload.feePlanId, 'FEE_PLAN_REQUIRED', '请选择会费类型', 80)
  const effectiveFrom = validatePeriod(payload.effectiveFrom, '生效月份')
  const effectiveTo = payload.effectiveTo ? validatePeriod(payload.effectiveTo, '结束月份') : undefined
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw Object.assign(new Error('结束月份不能早于生效月份'), { code: 'INVALID_FEE_PERIOD' })
  }
  const reason = requireString(payload.reason, 'FEE_REASON_REQUIRED', '请填写调整原因', 500)
  const [player, plan] = await Promise.all([
    readTeamPlayer(playerId, actor.teamId, transaction),
    readTeamPlan(feePlanId, actor.teamId, transaction)
  ])
  return {
    player,
    plan,
    values: {
      teamId: actor.teamId,
      playerId,
      feePlanId,
      effectiveFrom,
      effectiveTo: effectiveTo || null,
      reason,
      notify: Boolean(payload.notify)
    }
  }
}

const createAssignment = async (transaction, values, actor, sourceRequestId) => {
  const assignmentId = hashId(
    'fee_assignment',
    `${actor.teamId}:${values.playerId}:${values.effectiveFrom}:${Date.now()}:${Math.random()}`
  )
  const assignment = {
    ...values,
    adjustedByOpenid: actor.openid,
    adjustedBy: actor.role === 'owner' ? '队长' : '管理员',
    sourceRequestId: sourceRequestId || null,
    createdAt: now(),
    updatedAt: now()
  }
  await transaction.collection('player_fee_assignments').doc(assignmentId).set({ data: assignment })
  return { id: assignmentId, ...assignment }
}

exports.main = async (event) => {
  try {
    const payload = event.payload || {}

    if (event.action === 'setPaymentStatus') {
      const actor = await requireManager()
      const playerId = requireString(payload.playerId, 'PLAYER_REQUIRED', '请选择球员', 80)
      const period = validatePeriod(payload.period)
      const amount = Number(payload.amount)
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
        throw Object.assign(new Error('会费金额无效'), { code: 'INVALID_FEE_AMOUNT' })
      }
      if (!paymentStatuses.has(payload.status)) {
        throw Object.assign(new Error('缴费状态无效'), { code: 'INVALID_FEE_STATUS' })
      }
      await readTeamPlayer(playerId, actor.teamId)
      const paymentKey = `${actor.teamId}:${playerId}:${period}`
      const id = hashId('fee_payment', paymentKey)
      let before = null
      try {
        before = (await db.collection('fee_payments').doc(id).get()).data || null
      } catch {
        before = null
      }
      if (before) requireSameTeam(actor, before.teamId)
      const record = {
        teamId: actor.teamId,
        playerId,
        period,
        amount,
        status: payload.status,
        paymentKey,
        ...(payload.status === 'paid' ? { paidAt: before?.paidAt || now() } : {}),
        updatedAt: now(),
        updatedByOpenid: actor.openid,
        updatedBy: actor.role === 'owner' ? '队长' : '管理员'
      }
      await db.collection('fee_payments').doc(id).set({ data: record })
      await audit({
        actor,
        action: 'setFeePaymentStatus',
        entityType: 'fee_payment',
        entityId: id,
        before,
        after: record,
        requestId: event.requestId
      })
      return ok(event, withClientId({ _id: id, ...record }))
    }

    if (event.action === 'requestFeeChange') {
      const actor = await requireManager()
      const validated = await validateFeeChange(payload, actor)
      if (actor.role === 'owner') {
        const assignment = transactionValue(await db.runTransaction(async (transaction) =>
          createAssignment(transaction, validated.values, actor)
        ))
        await audit({
          actor,
          action: 'applyFeeChange',
          entityType: 'player_fee_assignment',
          entityId: assignment.id,
          before: null,
          after: assignment,
          requestId: event.requestId
        })
        return ok(event, { mode: 'applied', assignment })
      }

      const pendingKey = `${actor.teamId}:${validated.values.playerId}`
      const existing = await db.collection('fee_change_requests').where({
        pendingKey,
        status: 'pending'
      }).limit(1).get()
      if (existing.data.length) {
        throw Object.assign(new Error('该球员已有一条会费调整等待队长审核'), { code: 'FEE_CHANGE_PENDING' })
      }
      const id = hashId('fee_change', `${pendingKey}:${Date.now()}:${Math.random()}`)
      const record = {
        ...validated.values,
        pendingKey,
        status: 'pending',
        requestedByOpenid: actor.openid,
        requestedBy: '管理员',
        requestedAt: now(),
        reviewedBy: null,
        reviewedAt: null
      }
      await db.collection('fee_change_requests').doc(id).set({ data: record })
      await audit({
        actor,
        action: 'requestFeeChange',
        entityType: 'fee_change_request',
        entityId: id,
        before: null,
        after: record,
        requestId: event.requestId
      })
      return ok(event, { mode: 'pending', request: withClientId({ _id: id, ...record }) })
    }

    if (event.action === 'reviewFeeChange') {
      const actor = await requireOwner()
      const id = requireString(payload.id, 'FEE_CHANGE_REQUIRED', '缺少会费调整申请 ID', 100)
      const decision = payload.decision
      if (!reviewDecisions.has(decision)) {
        throw Object.assign(new Error('审核结果无效'), { code: 'INVALID_REVIEW_DECISION' })
      }
      const result = transactionValue(await db.runTransaction(async (transaction) => {
        const before = (await transaction.collection('fee_change_requests').doc(id).get()).data
        if (!before) throw Object.assign(new Error('会费调整申请不存在'), { code: 'FEE_CHANGE_NOT_FOUND' })
        requireSameTeam(actor, before.teamId)
        if (before.status !== 'pending') {
          throw Object.assign(new Error('该会费调整申请已经处理'), { code: 'FEE_CHANGE_REVIEWED' })
        }
        await readTeamPlayer(before.playerId, actor.teamId, transaction)
        await readTeamPlan(before.feePlanId, actor.teamId, transaction)
        const reviewed = {
          status: decision,
          pendingKey: `closed:${id}`,
          reviewedByOpenid: actor.openid,
          reviewedBy: '队长',
          reviewedAt: now()
        }
        await transaction.collection('fee_change_requests').doc(id).update({ data: reviewed })
        const assignment = decision === 'approved'
          ? await createAssignment(transaction, {
            teamId: before.teamId,
            playerId: before.playerId,
            feePlanId: before.feePlanId,
            effectiveFrom: before.effectiveFrom,
            effectiveTo: before.effectiveTo || null,
            reason: before.reason,
            notify: Boolean(before.notify)
          }, actor, id)
          : null
        return { before, reviewed, assignment }
      }))
      await audit({
        actor,
        action: 'reviewFeeChange',
        entityType: 'fee_change_request',
        entityId: id,
        before: result.before,
        after: { ...result.reviewed, assignmentId: result.assignment?.id || null },
        requestId: event.requestId
      })
      return ok(event, {
        request: withClientId({ _id: id, ...result.before, ...result.reviewed }),
        assignment: result.assignment
      })
    }

    throw Object.assign(new Error('未知会费操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) {
    return handleError(event, error)
  }
}
