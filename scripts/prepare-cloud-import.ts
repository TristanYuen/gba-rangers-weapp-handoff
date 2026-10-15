import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { LegacyBatch } from './lib/legacyParser'
import { fixtureFeeAssignments, fixtureFeePlans, fixturePlayers } from '../src/data/fixtures'

type JsonRecord = Record<string, unknown>

const args = process.argv.slice(2)
const valueOf = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

const sourceFile = path.resolve(valueOf('--source') || 'artifacts/migration/legacy-2026-7e1d7955d260.json')
const outputDir = path.resolve(valueOf('--output-dir') || '.codex_tmp/cloud-import')
const teamId = valueOf('--team-id') || '698a4c596a69ed84010a7c2e27709c78'
const teamName = 'GBA RANGERS'
const bootstrapExpiresAt = valueOf('--bootstrap-expires-at') || '2026-08-31T23:59:59+08:00'
const importedAt = new Date().toISOString()

const hash = (value: string, length = 32) =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, length)
const stableId = (prefix: string, sourceKey: string) => `${prefix}_${hash(sourceKey)}`
const cloudDate = (value: string) => ({ $date: new Date(value).toISOString() })
const randomCode = (prefix: string) => {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = crypto.randomBytes(10)
  return `${prefix}-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`
}
const writeJsonLines = async (collection: string, rows: JsonRecord[], importMode = 'Insert') => {
  const target = path.join(outputDir, `${collection}.json`)
  const body = rows.map((row) => JSON.stringify(row)).join('\n')
  await fs.writeFile(target, body ? `${body}\n` : '', 'utf8')
  return { collection, file: path.basename(target), count: rows.length, importMode }
}

const main = async () => {
  const batch = JSON.parse(await fs.readFile(sourceFile, 'utf8')) as LegacyBatch
  await fs.mkdir(outputDir, { recursive: true })

  const playerIdBySource = new Map(batch.players.map((player) => [
    player.sourceKey,
    stableId('player', player.sourceKey)
  ]))
  const playerIdByName = new Map(batch.players.map((player) => [
    player.displayName,
    playerIdBySource.get(player.sourceKey)!
  ]))
  const matchIdBySource = new Map(batch.matches.map((match) => [
    match.sourceKey,
    stableId('match', match.sourceKey)
  ]))
  const pendingMatchIds = new Set(
    batch.matches.filter((match) => match.migrationIssue === 'pending')
      .map((match) => matchIdBySource.get(match.sourceKey)!)
  )

  const aggregates = new Map<string, { apps: number; goals: number; assists: number }>()
  for (const player of batch.players) aggregates.set(player.sourceKey, { apps: 0, goals: 0, assists: 0 })
  for (const row of batch.playerMatchStats) {
    const matchId = matchIdBySource.get(row.matchSourceKey)!
    if (pendingMatchIds.has(matchId)) continue
    const stats = aggregates.get(row.playerSourceKey)!
    stats.apps += 1
    stats.goals += row.goals
    stats.assists += row.assists
  }

  const teamInviteCode = randomCode('GBA')
  const bootstrapCode = randomCode('CAPTAIN')
  const captain = batch.players.find((player) => player.displayName === '黄震杰' && player.memberType === 'formal')
  if (!captain) throw new Error('历史数据中找不到正式球员“黄震杰”')
  const captainPlayerId = playerIdBySource.get(captain.sourceKey)!

  const teams: JsonRecord[] = [{
    _id: teamId,
    name: teamName,
    inviteCode: teamInviteCode,
    ownerCount: 0,
    status: 'active',
    createdAt: cloudDate(importedAt),
    updatedAt: cloudDate(importedAt)
  }]

  const players: JsonRecord[] = batch.players.map((player) => ({
    _id: playerIdBySource.get(player.sourceKey),
    teamId,
    sourceKey: player.sourceKey,
    sourceName: player.sourceName,
    displayName: player.displayName,
    memberType: player.memberType,
    status: 'active',
    publicAuthorized: player.memberType === 'formal',
    showAvatar: true,
    showPhotos: true,
    stats: aggregates.get(player.sourceKey),
    seasonStats: aggregates.get(player.sourceKey),
    migrationBatchId: batch.batchId,
    version: 1,
    createdAt: cloudDate(batch.importedAt),
    updatedAt: cloudDate(importedAt)
  }))

  const matches: JsonRecord[] = batch.matches.map((match) => {
    const pending = match.migrationIssue === 'pending'
    return {
      _id: matchIdBySource.get(match.sourceKey),
      teamId,
      sourceKey: match.sourceKey,
      sourceHeader: match.sourceHeader,
      title: match.title,
      opponent: match.opponent,
      eventType: match.eventType,
      matchDate: match.matchDate,
      publicArea: '大湾区',
      exactLocation: '历史资料未记录',
      format: '7-a-side',
      capacityEnabled: false,
      capacity: 28,
      status: match.status,
      homeScore: null,
      awayScore: null,
      countInStats: !pending,
      migrationReviewStatus: pending ? 'pending' : 'verified',
      apps: match.apps,
      goals: match.goals,
      assists: match.assists,
      migrationBatchId: batch.batchId,
      version: 1,
      createdAt: cloudDate(batch.importedAt),
      updatedAt: cloudDate(importedAt)
    }
  })

  const appearances: JsonRecord[] = batch.appearances.map((row) => {
    const playerId = playerIdBySource.get(row.playerSourceKey)!
    const matchId = matchIdBySource.get(row.matchSourceKey)!
    const uniqueKey = `${matchId}:${playerId}`
    return {
      _id: uniqueKey,
      uniqueKey,
      teamId,
      matchId,
      playerId,
      migrationBatchId: batch.batchId,
      createdAt: cloudDate(batch.importedAt),
      updatedAt: cloudDate(importedAt)
    }
  })

  const stats: JsonRecord[] = batch.playerMatchStats.map((row) => {
    const playerId = playerIdBySource.get(row.playerSourceKey)!
    const matchId = matchIdBySource.get(row.matchSourceKey)!
    const match = batch.matches.find((item) => item.sourceKey === row.matchSourceKey)!
    const uniqueKey = `${matchId}:${playerId}`
    return {
      _id: uniqueKey,
      uniqueKey,
      teamId,
      matchId,
      matchDate: match.matchDate,
      playerId,
      goals: row.goals,
      assists: row.assists,
      countInStats: !pendingMatchIds.has(matchId),
      migrationBatchId: batch.batchId,
      createdAt: cloudDate(batch.importedAt),
      updatedAt: cloudDate(importedAt)
    }
  })

  const yearbook: JsonRecord[] = batch.matches.map((match) => {
    const matchId = matchIdBySource.get(match.sourceKey)!
    const pending = pendingMatchIds.has(matchId)
    return {
      _id: stableId('yearbook', match.sourceKey),
      teamId,
      year: Number(match.matchDate.slice(0, 4)),
      type: match.eventType === 'event' ? 'team_activity' : 'match',
      matchId,
      title: match.title,
      date: match.matchDate,
      summary: `${match.apps} 人出场 · ${match.goals} 球 · ${match.assists} 助攻`,
      featured: false,
      public: !pending,
      migrationReviewStatus: pending ? 'pending' : 'verified',
      migrationBatchId: batch.batchId,
      createdAt: cloudDate(batch.importedAt),
      updatedAt: cloudDate(importedAt)
    }
  })

  const migrationBatches: JsonRecord[] = [{
    _id: batch.batchId,
    teamId,
    fileHash: batch.fileHash,
    sourceFile: batch.sourceFile,
    totals: batch.totals,
    pendingIssueCount: batch.issues.filter((issue) => issue.severity === 'pending').length,
    status: 'prepared',
    importedAt: cloudDate(batch.importedAt),
    preparedAt: cloudDate(importedAt)
  }]

  const migrationIssues: JsonRecord[] = batch.issues.map((issue, index) => ({
    _id: stableId('migration_issue', `${batch.batchId}:${index}:${issue.message}`),
    teamId,
    migrationBatchId: batch.batchId,
    ...issue,
    status: issue.severity === 'pending' ? 'pending' : 'acknowledged',
    createdAt: cloudDate(importedAt)
  }))

  const feePlans: JsonRecord[] = fixtureFeePlans.map((plan) => ({
    _id: plan.id,
    teamId,
    ...plan,
    createdAt: cloudDate(importedAt),
    updatedAt: cloudDate(importedAt)
  }))

  const feeNameAliases = new Map([
    ['钟颖俊', '钟颍俊'],
    ['杨承炫', '杨承铉']
  ])
  const fixtureNameById = new Map(fixturePlayers.map((player) => [player.id, player.displayName]))
  const unresolvedFeeAssignments: string[] = []
  const feeAssignments: JsonRecord[] = fixtureFeeAssignments.flatMap((assignment) => {
    const playerName = fixtureNameById.get(assignment.playerId)
    const authoritativeName = playerName ? feeNameAliases.get(playerName) || playerName : undefined
    const playerId = authoritativeName ? playerIdByName.get(authoritativeName) : undefined
    if (!playerId) {
      unresolvedFeeAssignments.push(`${assignment.playerId}${playerName ? `（${playerName}）` : ''}`)
      return []
    }
    return [{
      _id: stableId('fee_assignment', `${assignment.id}:${playerId}`),
      teamId,
      ...assignment,
      playerId,
      createdAt: cloudDate(assignment.createdAt),
      updatedAt: cloudDate(importedAt)
    }]
  })
  for (const unresolved of unresolvedFeeAssignments) {
    migrationIssues.push({
      _id: stableId('migration_issue', `${batch.batchId}:unresolved-fee:${unresolved}`),
      teamId,
      migrationBatchId: batch.batchId,
      code: 'UNRESOLVED_FEE_ASSIGNMENT',
      severity: 'pending',
      message: `${unresolved} 仅存在于会费资料，未在权威历史球员名单中匹配到，暂不导入会费档案`,
      status: 'pending',
      createdAt: cloudDate(importedAt)
    })
  }
  migrationBatches[0]!.pendingIssueCount =
    batch.issues.filter((issue) => issue.severity === 'pending').length + unresolvedFeeAssignments.length

  const identityInvites: JsonRecord[] = [{
    _id: stableId('identity_invite', `${teamId}:${captainPlayerId}:bootstrap_owner`),
    teamId,
    playerId: captainPlayerId,
    type: 'bootstrap_owner',
    codeHash: hash(bootstrapCode.toUpperCase(), 64),
    active: true,
    expiresAt: cloudDate(bootstrapExpiresAt),
    createdAt: cloudDate(importedAt),
    updatedAt: cloudDate(importedAt)
  }]

  const collections: Array<[string, JsonRecord[], string?]> = [
    ['teams', teams, 'Upsert'],
    ['players', players],
    ['matches', matches],
    ['appearances', appearances],
    ['player_match_stats', stats],
    ['yearbook_entries', yearbook],
    ['migration_batches', migrationBatches],
    ['migration_issues', migrationIssues],
    ['fee_plans', feePlans],
    ['player_fee_assignments', feeAssignments],
    ['identity_invites', identityInvites]
  ]
  const files = []
  for (const [collection, rows, importMode] of collections) {
    files.push(await writeJsonLines(collection, rows, importMode))
  }

  const manifest = {
    generatedAt: importedAt,
    source: path.relative(process.cwd(), sourceFile),
    teamId,
    teamName,
    batchId: batch.batchId,
    files,
    checks: {
      formalPlayers: batch.players.filter((player) => player.memberType === 'formal').length,
      trialPlayers: batch.players.filter((player) => player.memberType === 'trial').length,
      guestPlayers: batch.players.filter((player) => player.memberType === 'guest').length,
      matches: matches.length,
      pendingMatches: pendingMatchIds.size,
      appearances: appearances.length,
      goals: batch.totals.goals,
      assists: batch.totals.assists,
      unresolvedFeeAssignments
    }
  }
  await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(outputDir, 'deployment-secrets.local.json'), `${JSON.stringify({
    teamInviteCode,
    bootstrapOwner: {
      player: captain.displayName,
      playerId: captainPlayerId,
      code: bootstrapCode,
      expiresAt: bootstrapExpiresAt
    }
  }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ outputDir, ...manifest.checks }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
