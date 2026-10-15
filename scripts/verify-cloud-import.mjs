import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const valueOf = (flag) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const inputDir = path.resolve(valueOf('--input-dir') || '.codex_tmp/cloud-import')
const manifest = JSON.parse(await fs.readFile(path.join(inputDir, 'manifest.json'), 'utf8'))
const secrets = JSON.parse(await fs.readFile(path.join(inputDir, 'deployment-secrets.local.json'), 'utf8'))
const readRows = async (collection) => {
  const value = await fs.readFile(path.join(inputDir, `${collection}.json`), 'utf8')
  return value.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line) }
    catch { throw new Error(`${collection}.json 第 ${index + 1} 行不是有效 JSON`) }
  })
}
const requireCheck = (condition, message) => {
  if (!condition) throw new Error(message)
}
const unique = (rows, field, collection) => {
  const values = rows.map((row) => row[field])
  requireCheck(values.every(Boolean), `${collection} 存在空 ${field}`)
  requireCheck(new Set(values).size === values.length, `${collection} 存在重复 ${field}`)
}

const collections = Object.fromEntries(await Promise.all(
  manifest.files.map(async ({ collection }) => [collection, await readRows(collection)])
))
for (const { collection, count } of manifest.files) {
  requireCheck(collections[collection].length === count, `${collection} 数量与 manifest 不一致`)
  unique(collections[collection], '_id', collection)
}
unique(collections.players, 'sourceKey', 'players')
unique(collections.matches, 'sourceKey', 'matches')
unique(collections.appearances, 'uniqueKey', 'appearances')
unique(collections.player_match_stats, 'uniqueKey', 'player_match_stats')

const playerIds = new Set(collections.players.map((row) => row._id))
const matchIds = new Set(collections.matches.map((row) => row._id))
requireCheck(collections.players.filter((row) => row.memberType === 'formal').length === 49, '正式球员应为 49 人')
requireCheck(collections.players.filter((row) => row.memberType === 'trial').length === 6, '试训球员应为 6 人')
requireCheck(collections.players.filter((row) => row.memberType === 'guest').length === 2, '客串球员应为 2 人')
requireCheck(collections.matches.length === 14, '历史比赛应为 14 场')
requireCheck(collections.matches.filter((row) => row.migrationReviewStatus === 'pending').length === 2, '待核对比赛应为 2 场')
requireCheck(collections.matches.filter((row) => row.migrationReviewStatus === 'pending').every((row) => row.countInStats === false), '待核对比赛必须暂停计入统计')
requireCheck(collections.appearances.length === 235, '出场记录应为 235 条')
requireCheck(collections.appearances.every((row) => playerIds.has(row.playerId) && matchIds.has(row.matchId)), '出场记录存在无效外键')
requireCheck(collections.player_match_stats.every((row) => playerIds.has(row.playerId) && matchIds.has(row.matchId)), '比赛统计存在无效外键')
requireCheck(collections.player_match_stats.reduce((sum, row) => sum + row.goals, 0) === 94, '总进球应为 94')
requireCheck(collections.player_match_stats.reduce((sum, row) => sum + row.assists, 0) === 76, '总助攻应为 76')
requireCheck(collections.yearbook_entries.every((row) => !row.matchId || matchIds.has(row.matchId)), '年鉴存在无效比赛引用')
requireCheck(collections.player_fee_assignments.every((row) => playerIds.has(row.playerId)), '会费档案存在无效球员引用')

const invitation = collections.identity_invites[0]
const expectedHash = crypto.createHash('sha256')
  .update(secrets.bootstrapOwner.code.toUpperCase())
  .digest('hex')
requireCheck(invitation.codeHash === expectedHash, '队长一次性邀请码哈希不匹配')
requireCheck(invitation.playerId === secrets.bootstrapOwner.playerId, '队长邀请码绑定球员不匹配')
requireCheck(!JSON.stringify(collections).includes(secrets.bootstrapOwner.code), '导入文件泄露了队长明文邀请码')

console.log(JSON.stringify({
  status: 'verified',
  inputDir,
  collections: manifest.files.length,
  documents: manifest.files.reduce((sum, item) => sum + item.count, 0),
  checks: manifest.checks
}, null, 2))
