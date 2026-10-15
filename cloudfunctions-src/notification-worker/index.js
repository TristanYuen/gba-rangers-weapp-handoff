const crypto = require('crypto')
const { cloud, db, command, now, ok, transactionValue, handleError } = require('./common')

const ACTIVITY_TEMPLATE_ID = '07eNLzAyEfgkITBspP5GjYVxUz_FdWUfZlfA2J-WMuI'
const FEE_TEMPLATE_ID = 'OTykVAMzMPofrB2Jw38l1T5O9Pm8ilK3vxYDyGuG2wI'
const MAX_RETRIES = 3
const PROCESSING_TIMEOUT_MS = 10 * 60 * 1000
const autoHistoryDelayMs = 24 * 60 * 60 * 1000
const supportedEventNames = new Set(['match_signup', 'signup_activity', 'fee_due', 'pending_confirmation'])
const unavailableWechatCodes = new Set(['40003', '41028', '41029', '41030', '43101', '47003', '48001'])

const stableId = (prefix, value) =>
  `${prefix}_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 40)}`

const subscriptionId = (teamId, playerId, templateId) =>
  stableId('notification_subscription', `${teamId}:${playerId}:${templateId}`)

const compact = (value, maxLength = 20) => {
  const text = String(value || '').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

const dateValue = (value) => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && value.$date) return new Date(value.$date)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatWechatTime = (value) => {
  const date = dateValue(value)
  if (!date) return '请查看球队通知'
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {})
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

const matchTime = (match, notice) => {
  if (match?.matchDate) return `${match.matchDate}${match.kickoffTime ? ` ${match.kickoffTime}` : ''}`
  return formatWechatTime(notice.createdAt)
}

/*
 * 这两个模板的关键词字段按当前后台模板配置接入：活动模板使用thing1/time2/thing3/thing4，
 * 缴费模板使用thing1/amount2/time3/thing4。若微信后台修改关键词，只需调整这里的字段映射。
 */
const buildTemplateData = ({ notice, recipient, match }) => {
  const detail = (notice.recipientDetails || []).find((item) => item.playerId === recipient.playerId) || {}
  const content = detail.content || recipient.content || notice.content
  if (notice.type === 'fee_due') {
    const amount = detail.feeAmount ?? notice.feeAmount
    const dueAt = notice.dueAt || `${notice.feePeriod || ''}-28T20:00:00+08:00`
    return {
      thing1: { value: compact(notice.title) },
      amount2: { value: `¥${Number.isFinite(Number(amount)) ? Number(amount).toFixed(2) : '待确认'}` },
      time3: { value: formatWechatTime(dueAt) },
      thing4: { value: compact(content) }
    }
  }
  return {
    thing1: { value: compact(notice.title) },
    time2: { value: compact(matchTime(match, notice), 16) },
    thing3: { value: compact(match?.publicArea || '详见球队通知') },
    thing4: { value: compact(content) }
  }
}

const templateIdForNotice = (notice) => notice.type === 'fee_due' ? FEE_TEMPLATE_ID : ACTIVITY_TEMPLATE_ID
const errorCodeOf = (error) => String(error?.code || error?.errCode || error?.errcode || 'UNKNOWN_ERROR')
const errorMessageOf = (error) => String(error?.message || error?.errMsg || error?.errmsg || '微信发送失败')

const getWechatError = (response) => {
  const code = response?.errcode ?? response?.errCode
  if (!response || code === undefined || code === null || String(code) === '0') return null
  return Object.assign(new Error(response.errmsg || response.errMsg || '微信发送失败'), {
    code: String(code),
    errMsg: response.errmsg || response.errMsg
  })
}

const kickoffTimestamp = (match) => {
  if (!match.matchDate || !match.kickoffTime) return Number.NaN
  return new Date(`${match.matchDate}T${match.kickoffTime}:00+08:00`).getTime()
}

const autoCompleteExpiredMatches = async () => {
  const candidates = await db.collection('matches').where({
    deletedAt: command.exists(false),
    status: command.in(['published', 'registration_closed'])
  }).limit(200).get()
  let autoCompleted = 0
  for (const candidate of candidates.data) {
    const kickoff = kickoffTimestamp(candidate)
    if (!Number.isFinite(kickoff) || kickoff + autoHistoryDelayMs > Date.now()) continue
    const changed = transactionValue(await db.runTransaction(async (transaction) => {
      const current = (await transaction.collection('matches').doc(candidate._id).get()).data
      const currentKickoff = kickoffTimestamp(current || {})
      if (!current || current.deletedAt || !['published', 'registration_closed'].includes(current.status) || !Number.isFinite(currentKickoff) || currentKickoff + autoHistoryDelayMs > Date.now()) return false
      await transaction.collection('matches').doc(candidate._id).update({
        data: { status: 'completed_pending_score', homeScore: null, awayScore: null, updatedAt: now(), version: command.inc(1) }
      })
      return true
    }))
    if (changed) autoCompleted += 1
  }
  return { scanned: candidates.data.length, autoCompleted }
}

const claimJob = async (jobId) => transactionValue(await db.runTransaction(async (transaction) => {
  const current = (await transaction.collection('notification_jobs').doc(jobId).get()).data
  const processingAt = dateValue(current?.processingAt)?.getTime() || 0
  if (!current || (current.status !== 'pending' && !(current.status === 'processing' && Date.now() - processingAt > PROCESSING_TIMEOUT_MS))) return false
  await transaction.collection('notification_jobs').doc(jobId).update({
    data: { status: 'processing', processingAt: now(), updatedAt: now() }
  })
  return true
}))

const claimRecipient = async (recipientId) => transactionValue(await db.runTransaction(async (transaction) => {
  const current = (await transaction.collection('notice_recipients').doc(recipientId).get()).data
  if (!current || current.deliveryStatus !== 'pending') return null
  if (Number(current.retryCount || 0) >= MAX_RETRIES) {
    await transaction.collection('notice_recipients').doc(recipientId).update({ data: {
      deliveryStatus: 'failed',
      wechatDeliveryStatus: 'retry_exhausted',
      updatedAt: now()
    } })
    return null
  }
  await transaction.collection('notice_recipients').doc(recipientId).update({ data: {
    deliveryStatus: 'processing',
    processingAt: now(),
    updatedAt: now()
  } })
  return current
}))

const reserveSubscription = async (teamId, playerId, templateId) => transactionValue(await db.runTransaction(async (transaction) => {
  const id = subscriptionId(teamId, playerId, templateId)
  const current = (await transaction.collection('notification_subscriptions').doc(id).get()).data
  if (!current || current.status === 'disabled' || Number(current.remainingCount || 0) <= 0) return false
  await transaction.collection('notification_subscriptions').doc(id).update({ data: {
    remainingCount: command.inc(-1),
    status: 'active',
    updatedAt: now()
  } })
  return true
}))

const restoreSubscription = async (teamId, playerId, templateId, code) => {
  const id = subscriptionId(teamId, playerId, templateId)
  await db.collection('notification_subscriptions').doc(id).update({ data: {
    remainingCount: command.inc(1),
    status: 'active',
    lastErrorCode: code,
    updatedAt: now()
  } })
}

const updateRecipient = (recipientId, data) =>
  db.collection('notice_recipients').doc(recipientId).update({ data: { ...data, updatedAt: now() } })

const recoverStaleRecipients = async (teamId, noticeId) => {
  const result = await db.collection('notice_recipients').where({
    teamId,
    noticeId,
    deliveryStatus: 'processing'
  }).limit(100).get()
  for (const recipient of result.data) {
    const processingAt = dateValue(recipient.processingAt)?.getTime() || 0
    if (processingAt && Date.now() - processingAt > PROCESSING_TIMEOUT_MS) {
      await updateRecipient(recipient._id, { deliveryStatus: 'pending' })
    }
  }
}

const markUnavailable = async (recipientId, templateId, code, message) => {
  await updateRecipient(recipientId, {
    deliveryStatus: 'unavailable',
    wechatTemplateId: templateId,
    wechatDeliveryStatus: 'unavailable',
    wechatErrorCode: code,
    wechatErrorMessage: message
  })
}

const processRecipient = async (job, notice, recipient, match) => {
  const claimed = await claimRecipient(recipient._id)
  if (!claimed) return 'skipped'
  const templateId = templateIdForNotice(notice)
  let reserved = false
  try {
    const [membershipResult, preferenceResult] = await Promise.all([
      db.collection('team_memberships').where({
        teamId: job.teamId,
        playerId: claimed.playerId,
        status: 'approved',
        active: true
      }).limit(1).get(),
      db.collection('notification_preferences').where({
        teamId: job.teamId,
        playerId: claimed.playerId
      }).limit(1).get()
    ])
    const membership = membershipResult.data[0]
    if (!membership?.openid) {
      await markUnavailable(claimed._id, templateId, 'OPENID_MISSING', '用户未绑定微信身份')
      return 'unavailable'
    }
    if (preferenceResult.data[0]?.enabled === false) {
      await markUnavailable(claimed._id, templateId, 'PREFERENCE_DISABLED', '用户已关闭球队通知')
      return 'unavailable'
    }
    reserved = await reserveSubscription(job.teamId, claimed.playerId, templateId)
    if (!reserved) {
      await markUnavailable(claimed._id, templateId, 'NO_SUBSCRIPTION_QUOTA', '用户没有剩余订阅额度')
      return 'unavailable'
    }
    const response = await cloud.openapi.subscribeMessage.send({
      touser: membership.openid,
      templateId,
      page: 'pages/notices/index',
      data: buildTemplateData({ notice, recipient: claimed, match })
    })
    const wechatError = getWechatError(response)
    if (wechatError) throw wechatError
    await db.collection('notification_subscriptions').doc(subscriptionId(job.teamId, claimed.playerId, templateId)).update({ data: {
      lastSentAt: now(),
      lastErrorCode: null,
      updatedAt: now()
    } })
    await updateRecipient(claimed._id, {
      deliveryStatus: 'sent',
      wechatMsgId: response?.msgid || response?.msgId || null,
      wechatTemplateId: templateId,
      wechatDeliveryStatus: 'sent',
      wechatErrorCode: null,
      wechatErrorMessage: null,
      sentAt: now()
    })
    return 'sent'
  } catch (error) {
    const code = errorCodeOf(error)
    const message = errorMessageOf(error)
    if (reserved && unavailableWechatCodes.has(code)) {
      await db.collection('notification_subscriptions').doc(subscriptionId(job.teamId, claimed.playerId, templateId)).update({ data: {
        remainingCount: 0,
        status: 'inactive',
        lastErrorCode: code,
        updatedAt: now()
      } })
      await markUnavailable(claimed._id, templateId, code, message)
      return 'unavailable'
    }
    if (reserved) await restoreSubscription(job.teamId, claimed.playerId, templateId, code)
    const retryCount = Number(claimed.retryCount || 0) + 1
    const exhausted = retryCount >= MAX_RETRIES
    await updateRecipient(claimed._id, {
      deliveryStatus: exhausted ? 'failed' : 'pending',
      retryCount,
      wechatTemplateId: templateId,
      wechatDeliveryStatus: exhausted ? 'failed' : 'retrying',
      wechatErrorCode: code,
      wechatErrorMessage: message
    })
    return exhausted ? 'failed' : 'retrying'
  }
}

const processPendingConfirmationJobs = async () => {
  const due = await db.collection('notification_jobs').where({
    eventName: 'pending_confirmation',
    status: command.in(['scheduled', 'pending']),
    runAt: command.lte(new Date())
  }).orderBy('runAt', 'asc').limit(100).get()
  let created = 0
  let cancelled = 0
  for (const job of due.data) {
    if (job.noticeId) continue
    const signupResult = await db.collection('signups').where({ teamId: job.teamId, uniqueKey: job.signupKey }).limit(1).get()
    const signup = signupResult.data[0]
    if (!signup || signup.choice !== 'maybe') {
      await db.collection('notification_jobs').doc(job._id).update({ data: { status: 'cancelled', updatedAt: now() } })
      cancelled += 1
      continue
    }
    const match = (await db.collection('matches').doc(job.matchId).get()).data
    const noticeId = stableId('pending_notice', job._id)
    const recipientId = stableId('notice_recipient', `${noticeId}:${signup.playerId}`)
    const changed = transactionValue(await db.runTransaction(async (transaction) => {
      const currentJob = (await transaction.collection('notification_jobs').doc(job._id).get()).data
      if (!currentJob || currentJob.noticeId || !['scheduled', 'pending'].includes(currentJob.status)) return false
      const currentSignup = (await transaction.collection('signups').doc(signup._id).get()).data
      if (!currentSignup || currentSignup.choice !== 'maybe') {
        await transaction.collection('notification_jobs').doc(job._id).update({ data: { status: 'cancelled', updatedAt: now() } })
        return false
      }
      const notice = {
        teamId: job.teamId,
        type: 'pending_confirmation',
        title: '待定时间已到，请确认',
        content: `${match?.title || '赛事'}：请尽快选择参加或缺席。`,
        audience: 'individual',
        matchId: job.matchId,
        targetPlayerId: signup.playerId,
        createdBy: 'system',
        createdAt: now()
      }
      await transaction.collection('team_notices').doc(noticeId).set({ data: notice })
      await transaction.collection('notice_recipients').doc(recipientId).set({ data: {
        teamId: job.teamId,
        noticeId,
        playerId: signup.playerId,
        title: notice.title,
        content: notice.content,
        type: notice.type,
        deliveryStatus: 'pending',
        createdAt: now()
      } })
      await transaction.collection('signups').doc(signup._id).update({ data: { reminderStatus: 'sent', reminderSentAt: now(), updatedAt: now() } })
      await transaction.collection('notification_jobs').doc(job._id).update({ data: { status: 'pending', noticeId, updatedAt: now() } })
      return true
    }))
    if (changed) created += 1
    else cancelled += 1
  }
  return { scanned: due.data.length, created, cancelled }
}

const processNotificationJobs = async () => {
  const jobs = await db.collection('notification_jobs').where({
    status: command.in(['pending', 'processing']),
    deletedAt: command.exists(false)
  }).orderBy('createdAt', 'asc').limit(50).get()
  let completed = 0
  let partial = 0
  let failed = 0
  let retried = 0
  for (const job of jobs.data) {
    const notice = (await db.collection('team_notices').doc(job.noticeId).get()).data
    const eventName = job.eventName || notice?.type
    if (!notice || !supportedEventNames.has(eventName)) continue
    if (!await claimJob(job._id)) continue
    await recoverStaleRecipients(job.teamId, job.noticeId)
    const [recipientsResult, matchResult] = await Promise.all([
      db.collection('notice_recipients').where({ teamId: job.teamId, noticeId: job.noticeId, deliveryStatus: 'pending' }).limit(100).get(),
      notice.matchId ? db.collection('matches').doc(notice.matchId).get() : Promise.resolve({ data: null })
    ])
    for (const recipient of recipientsResult.data) {
      const result = await processRecipient(job, notice, recipient, matchResult.data)
      if (result === 'retrying') retried += 1
    }
    const allRecipients = await db.collection('notice_recipients').where({ teamId: job.teamId, noticeId: job.noticeId }).limit(100).get()
    const hasPending = allRecipients.data.some((item) => ['pending', 'processing'].includes(item.deliveryStatus))
    const hasSent = allRecipients.data.some((item) => item.deliveryStatus === 'sent')
    const hasFailure = allRecipients.data.some((item) => ['failed', 'unavailable'].includes(item.deliveryStatus))
    const nextStatus = hasPending ? 'pending' : hasFailure && hasSent ? 'partially_sent' : hasFailure ? 'failed' : 'completed'
    await db.collection('notification_jobs').doc(job._id).update({ data: { status: nextStatus, eventName, updatedAt: now() } })
    if (nextStatus === 'completed') completed += 1
    else if (nextStatus === 'partially_sent') partial += 1
    else if (nextStatus === 'failed') failed += 1
  }
  return { scanned: jobs.data.length, completed, partial, failed, retried }
}

exports.main = async (event) => {
  try {
    const pendingConfirmation = await processPendingConfirmationJobs()
    const deliveries = await processNotificationJobs()
    const matchSweep = await autoCompleteExpiredMatches()
    return ok(event, {
      pendingConfirmation,
      deliveries,
      matchesScanned: matchSweep.scanned,
      autoCompleted: matchSweep.autoCompleted
    })
  } catch (error) {
    return handleError(event, error)
  }
}
