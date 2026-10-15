const crypto = require('crypto')
const { cloud, db, command, now, ok, requireApproved, requireManager, requireSameTeam, requireString, handleError } = require('./common')

const allowedTypes = ['match_signup', 'signup_activity', 'fee_due', 'pending_confirmation']
const allowedAudiences = ['all_members', 'unregistered', 'pending_players', 'individual', 'managers']
const activityTemplateId = '07eNLzAyEfgkITBspP5GjYVxUz_FdWUfZlfA2J-WMuI'
const feeTemplateId = 'OTykVAMzMPofrB2Jw38l1T5O9Pm8ilK3vxYDyGuG2wI'
const allowedTemplateIds = new Set([activityTemplateId, feeTemplateId])
const hashId = (prefix, value) => `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)}`

exports.main = async (event) => {
  try {
    const payload = event.payload || {}
    if (event.action === 'listMyNotices') {
      const actor = await requireApproved()
      const result = await db.collection('notice_recipients').where({ teamId: actor.teamId, playerId: actor.playerId }).orderBy('createdAt', 'desc').limit(100).get()
      return ok(event, result.data)
    }
    if (event.action === 'markNoticeRead') {
      const actor = await requireApproved()
      const result = await db.collection('notice_recipients').where({ teamId: actor.teamId, noticeId: payload.id, playerId: actor.playerId }).limit(1).get()
      if (result.data[0]) await db.collection('notice_recipients').doc(result.data[0]._id).update({ data: { readAt: now() } })
      return ok(event, { id: payload.id, read: true })
    }
    if (event.action === 'setNotificationPreference') {
      const actor = await requireApproved()
      const memberPreferenceKey = `${actor.teamId}:${actor.openid}`
      const id = hashId('notification_preference', memberPreferenceKey)
      const record = {
        teamId: actor.teamId,
        playerId: actor.playerId,
        openid: actor.openid,
        memberPreferenceKey,
        enabled: Boolean(payload.enabled),
        updatedAt: now()
      }
      await db.collection('notification_preferences').doc(id).set({ data: record })
      return ok(event, { enabled: record.enabled })
    }
    if (event.action === 'recordSubscription') {
      const actor = await requireApproved()
      const templateIds = [...new Set(Array.isArray(payload.templateIds) ? payload.templateIds : [])]
        .filter((templateId) => allowedTemplateIds.has(templateId))
      if (!templateIds.length) throw Object.assign(new Error('没有可记录的微信订阅模板'), { code: 'INVALID_TEMPLATE' })
      const acceptedAt = now()
      for (const templateId of templateIds) {
        const id = hashId('notification_subscription', `${actor.teamId}:${actor.playerId}:${templateId}`)
        await db.runTransaction(async (transaction) => {
          const current = (await transaction.collection('notification_subscriptions').doc(id).get()).data
          if (current) {
            await transaction.collection('notification_subscriptions').doc(id).update({ data: {
              remainingCount: command.inc(1),
              status: 'active',
              lastAcceptedAt: acceptedAt,
              updatedAt: acceptedAt
            } })
            return
          }
          await transaction.collection('notification_subscriptions').doc(id).set({ data: {
            teamId: actor.teamId,
            playerId: actor.playerId,
            openid: actor.openid,
            templateId,
            subscriptionType: 'one_time',
            remainingCount: 1,
            status: 'active',
            lastAcceptedAt: acceptedAt,
            lastSentAt: null,
            lastErrorCode: null,
            updatedAt: acceptedAt
          } })
        })
      }
      return ok(event, { templateIds, acceptedCount: templateIds.length })
    }
    if (event.action === 'getSubscriptionStatus') {
      const actor = await requireApproved()
      const result = await db.collection('notification_subscriptions').where({
        teamId: actor.teamId,
        playerId: actor.playerId
      }).limit(10).get()
      const byTemplateId = new Map(result.data.map((item) => [item.templateId, item]))
      return ok(event, [...allowedTemplateIds].map((templateId) => ({
        templateId,
        remainingCount: byTemplateId.get(templateId)?.remainingCount || 0,
        status: byTemplateId.get(templateId)?.status || 'inactive'
      })))
    }
    if (event.action === 'remindPendingSignup') {
      const actor = await requireManager()
      const result = await db.collection('signups').where({
        teamId: actor.teamId,
        matchId: payload.matchId,
        playerId: payload.playerId,
        choice: 'maybe'
      }).limit(1).get()
      const signup = result.data[0]
      if (!signup) throw Object.assign(new Error('待定报名记录不存在'), { code: 'SIGNUP_NOT_FOUND' })
      requireSameTeam(actor, signup.teamId)
      const notice = {
        teamId: actor.teamId,
        type: 'pending_confirmation',
        title: '请确认本场比赛是否参加',
        content: '你的报名状态仍为待定，请尽快更新为参加或缺席。',
        audience: 'individual',
        matchId: payload.matchId,
        targetPlayerId: payload.playerId,
        createdBy: actor.playerId,
        createdAt: now()
      }
      const created = await db.collection('team_notices').add({ data: notice })
      await db.collection('notice_recipients').add({
        data: {
          teamId: actor.teamId,
          noticeId: created._id,
          playerId: payload.playerId,
          title: notice.title,
          content: notice.content,
          type: notice.type,
          deliveryStatus: 'pending',
          createdAt: now()
        }
      })
      await db.collection('notification_jobs').add({ data: {
        teamId: actor.teamId,
        noticeId: created._id,
        eventName: notice.type,
        audience: notice.audience,
        status: 'pending',
        createdAt: now()
      } })
      await db.collection('signups').doc(signup._id).update({
        data: { reminderStatus: 'sent', reminderSentAt: now(), updatedAt: now() }
      })
      return ok(event, { id: created._id, delivered: true })
    }
    if (event.action === 'createNotice') {
      const actor = await requireManager()
      if (!allowedTypes.includes(payload.type) || !allowedAudiences.includes(payload.audience)) throw Object.assign(new Error('通知类型或受众无效'), { code: 'INVALID_NOTICE' })
      const title = requireString(payload.title, 'INVALID_NOTICE', '请填写通知标题', 100)
      const content = requireString(payload.content, 'INVALID_NOTICE', '请填写通知内容', 2000)
      if (['unregistered', 'pending_players'].includes(payload.audience) && !payload.matchId) {
        throw Object.assign(new Error('请选择关联比赛'), { code: 'MATCH_REQUIRED' })
      }
      if (payload.matchId) {
        const match = (await db.collection('matches').doc(payload.matchId).get()).data
        if (!match || match.teamId !== actor.teamId || match.deletedAt) {
          throw Object.assign(new Error('赛事不存在'), { code: 'MATCH_NOT_FOUND' })
        }
      }
      let memberIds = []
      const requestedTargetIds = Array.isArray(payload.targetPlayerIds)
        ? [...new Set(payload.targetPlayerIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))]
        : []
      if (payload.audience === 'pending_players') {
        const signups = await db.collection('signups').where({ teamId: actor.teamId, matchId: payload.matchId, choice: 'maybe' }).limit(100).get()
        memberIds = signups.data.map((item) => item.playerId)
      } else if (payload.audience === 'unregistered') {
        const [members, signups] = await Promise.all([
          db.collection('team_memberships').where({ teamId: actor.teamId, status: 'approved', active: true }).limit(100).get(),
          db.collection('signups').where({ teamId: actor.teamId, matchId: payload.matchId }).limit(100).get()
        ])
        const registered = new Set(signups.data.map((item) => item.playerId))
        memberIds = members.data.map((item) => item.playerId).filter((id) => id && !registered.has(id))
      } else if (payload.audience === 'individual') {
        if (!requestedTargetIds.length && payload.targetPlayerId) requestedTargetIds.push(payload.targetPlayerId)
        if (!requestedTargetIds.length) throw Object.assign(new Error('请至少选择一名推送对象'), { code: 'TARGET_PLAYER_REQUIRED' })
        if (requestedTargetIds.length > 100) throw Object.assign(new Error('单次最多选择 100 名推送对象'), { code: 'TOO_MANY_TARGETS' })
        const memberships = await db.collection('team_memberships').where({
          teamId: actor.teamId,
          status: 'approved',
          active: true
        }).limit(200).get()
        const validPlayerIds = new Set(memberships.data.map((item) => item.playerId).filter(Boolean))
        memberIds = requestedTargetIds.filter((id) => validPlayerIds.has(id))
        if (memberIds.length !== requestedTargetIds.length) {
          throw Object.assign(new Error('部分推送对象未绑定当前球队身份'), { code: 'TARGET_PLAYER_INVALID' })
        }
      } else {
        const members = await db.collection('team_memberships').where({ teamId: actor.teamId, status: 'approved', active: true }).limit(100).get()
        memberIds = members.data
          .filter((item) => payload.audience !== 'managers' || ['admin', 'owner'].includes(item.role))
          .map((item) => item.playerId)
          .filter(Boolean)
      }
      const requestedDetails = Array.isArray(payload.recipientDetails) ? payload.recipientDetails : []
      const detailByPlayerId = new Map(requestedDetails
        .filter((detail) => detail && memberIds.includes(detail.playerId))
        .map((detail) => [detail.playerId, {
          playerId: detail.playerId,
          displayName: typeof detail.displayName === 'string' ? detail.displayName.slice(0, 100) : detail.playerId,
          feeAmount: Number.isFinite(Number(detail.feeAmount)) ? Number(detail.feeAmount) : null,
          content: requireString(detail.content || content, 'INVALID_NOTICE', '通知内容不能为空', 2000)
        }]))
      const recipientDetails = memberIds.map((playerId) => detailByPlayerId.get(playerId) || {
        playerId,
        displayName: playerId,
        feeAmount: null,
        content
      })
      const notice = {
        teamId: actor.teamId,
        type: payload.type,
        title,
        content,
        audience: payload.audience,
        matchId: payload.matchId || null,
        targetPlayerId: payload.targetPlayerId || null,
        targetPlayerIds: memberIds,
        feePeriod: /^\d{4}-\d{2}$/.test(payload.feePeriod || '') ? payload.feePeriod : null,
        recipientDetails,
        feeAmount: payload.feeAmount || null,
        dueAt: payload.dueAt || null,
        createdBy: actor.playerId,
        createdAt: now()
      }
      const created = await db.collection('team_notices').add({ data: notice })
      if (memberIds.length) {
        await Promise.all(memberIds.map((playerId) => db.collection('notice_recipients').add({
          data: {
            teamId: actor.teamId,
            noticeId: created._id,
            playerId,
            title: notice.title,
            content: detailByPlayerId.get(playerId)?.content || notice.content,
            type: notice.type,
            deliveryStatus: 'pending',
            createdAt: now()
          }
        })))
      }
      await db.collection('notification_jobs').add({ data: {
        teamId: actor.teamId,
        noticeId: created._id,
        eventName: notice.type,
        audience: payload.audience,
        status: 'pending',
        createdAt: now()
      } })
      return ok(event, { id: created._id, ...notice, recipientCount: memberIds.length })
    }
    if (event.action === 'getNoticeDeliverySummary') {
      const actor = await requireManager()
      const recipients = await db.collection('notice_recipients').where({ teamId: actor.teamId, noticeId: payload.id }).limit(100).get()
      const summary = recipients.data.reduce((result, item) => {
        result.total += 1
        const status = item.deliveryStatus || 'pending'
        result[status] = (result[status] || 0) + 1
        if (status === 'sent') result.delivered += 1
        return result
      }, { total: 0, delivered: 0, sent: 0, unavailable: 0, failed: 0, pending: 0, processing: 0, retrying: 0 })
      return ok(event, summary)
    }
    if (event.action === 'processPendingConfirmation') {
      const actor = await requireManager()
      const job = (await db.collection('notification_jobs').doc(payload.jobId).get()).data
      if (!job || job.eventName !== 'pending_confirmation' || !['scheduled', 'pending'].includes(job.status)) return ok(event, { skipped: true })
      if (job.teamId !== actor.teamId) throw Object.assign(new Error('不能操作其他球队的数据'), { code: 'CROSS_TEAM_FORBIDDEN' })
      const signup = await db.collection('signups').where({ uniqueKey: job.signupKey }).limit(1).get()
      const current = signup.data[0]
      if (!current || current.choice !== 'maybe') {
        await db.collection('notification_jobs').doc(payload.jobId).update({ data: { status: 'cancelled', updatedAt: now() } })
        return ok(event, { skipped: true, reason: 'status_changed' })
      }
      await db.collection('notice_recipients').add({ data: {
        teamId: actor.teamId,
        noticeId: `pending-${payload.jobId}`,
        playerId: current.playerId,
        title: '待定时间已到，请确认',
        content: '请尽快选择参加或缺席。',
        type: 'pending_confirmation',
        deliveryStatus: 'pending',
        createdAt: now()
      } })
      await db.collection('signups').doc(current._id).update({ data: { reminderStatus: 'sent', reminderSentAt: now(), updatedAt: now() } })
      await db.collection('notification_jobs').doc(payload.jobId).update({ data: { status: 'completed', updatedAt: now() } })
      return ok(event, { delivered: true })
    }
    throw Object.assign(new Error('未知通知操作'), { code: 'UNKNOWN_ACTION' })
  } catch (error) { return handleError(event, error) }
}
