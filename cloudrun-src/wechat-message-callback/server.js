const http = require('http')
const crypto = require('crypto')
const cloudbase = require('@cloudbase/node-sdk')

const PORT = Number(process.env.PORT || 3000)
const TOKEN = process.env.WECHAT_PUSH_TOKEN || ''
const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''

if (!ENV_ID) throw new Error('CLOUDBASE_ENV_ID is required')
const app = cloudbase.init({ env: ENV_ID })
const db = app.database()

const textValue = (xml, tag) => {
  const pattern = new RegExp(`<${tag}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${tag}>`)
  const match = xml.match(pattern)
  return (match?.[1] ?? match?.[2] ?? '').trim()
}

const listBlocks = (xml, parentTag) => {
  const parent = new RegExp(`<${parentTag}>([\\s\\S]*?)</${parentTag}>`).exec(xml)?.[1] || ''
  const blocks = [...parent.matchAll(/<List>([\s\S]*?)<\/List>/g)].map((match) => match[1])
  return blocks.length ? blocks : [parent]
}

const verifySignature = (query) => {
  if (!TOKEN || !query.signature || !query.timestamp || !query.nonce) return false
  const source = [TOKEN, query.timestamp, query.nonce].sort().join('')
  return crypto.createHash('sha1').update(source).digest('hex') === query.signature
}

const updateSentResult = async ({ openid, templateId, msgId, errorCode, errorStatus }) => {
  let result = msgId
    ? await db.collection('notice_recipients').where({ wechatMsgId: msgId }).limit(1).get()
    : { data: [] }

  if (!result.data[0] && openid) {
    const memberships = await db.collection('team_memberships').where({ openid, status: 'approved', active: true }).limit(20).get()
    const playerIds = memberships.data.map((item) => item.playerId).filter(Boolean)
    for (const playerId of playerIds) {
      result = await db.collection('notice_recipients').where({
        playerId,
        wechatTemplateId: templateId,
        deliveryStatus: 'sent'
      }).orderBy('sentAt', 'desc').limit(1).get()
      if (result.data[0]) break
    }
  }

  const recipient = result.data[0]
  if (!recipient) return false
  const success = String(errorCode || '0') === '0'
  await db.collection('notice_recipients').doc(recipient._id).update({ data: {
    deliveryStatus: success ? 'sent' : 'failed',
    wechatMsgId: msgId || recipient.wechatMsgId || null,
    wechatTemplateId: templateId || recipient.wechatTemplateId || null,
    wechatDeliveryStatus: success ? 'sent' : 'failed',
    wechatErrorCode: success ? null : errorCode || 'UNKNOWN_ERROR',
    wechatErrorMessage: success ? null : errorStatus || '微信异步发送失败',
    callbackAt: new Date()
  } })
  return true
}

const updateSubscriptionChange = async ({ openid, templateId, status }) => {
  if (!openid || !templateId || status !== 'reject') return
  const result = await db.collection('notification_subscriptions').where({ openid, templateId }).limit(20).get()
  await Promise.all(result.data.map((item) => db.collection('notification_subscriptions').doc(item._id).update({ data: {
    remainingCount: 0,
    status: 'inactive',
    lastErrorCode: 'SUBSCRIBE_REJECTED',
    updatedAt: new Date()
  } })))
}

const handleXml = async (xml) => {
  const openid = textValue(xml, 'FromUserName')
  const event = textValue(xml, 'Event')
  if (event === 'subscribe_msg_sent_event') {
    for (const block of listBlocks(xml, 'SubscribeMsgSentEvent')) {
      await updateSentResult({
        openid,
        templateId: textValue(block, 'TemplateId'),
        msgId: textValue(block, 'MsgID'),
        errorCode: textValue(block, 'ErrorCode'),
        errorStatus: textValue(block, 'ErrorStatus')
      })
    }
  }
  if (event === 'subscribe_msg_change_event') {
    for (const block of listBlocks(xml, 'SubscribeMsgChangeEvent')) {
      await updateSubscriptionChange({
        openid,
        templateId: textValue(block, 'TemplateId'),
        status: textValue(block, 'SubscribeStatusString')
      })
    }
  }
}

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  request.on('error', reject)
})

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (request.method === 'GET' && url.pathname === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok')
    return
  }
  if (url.pathname !== '/api/wechat/message' || !verifySignature(Object.fromEntries(url.searchParams.entries()))) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('forbidden')
    return
  }
  if (request.method === 'GET') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(url.searchParams.get('echostr') || '')
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('method not allowed')
    return
  }
  try {
    await handleXml(await readBody(request))
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('success')
  } catch (error) {
    console.error('wechat callback failed', error)
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('failed')
  }
})

server.listen(PORT, '0.0.0.0', () => console.log(`wechat callback listening on ${PORT}`))
