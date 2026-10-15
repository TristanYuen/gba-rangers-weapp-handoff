import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fixtureFeeAssignments, fixtureFeePayments, fixtureMatchStats, fixtureMatches, fixturePlayers } from '../src/data/fixtures'

type JsonRecord = Record<string, unknown>

const args = new Set(process.argv.slice(2))
const commit = args.has('--commit')
const envId = 'cloud1-d4g1nl8yx26d1f3f2'
const teamId = '698a4c596a69ed84010a7c2e27709c78'
const cli = process.env.GBA_CLOUDBASE_CLI || 'D:/cbcli/node_modules/@cloudbase/cli/bin/cloudbase'
const backupDir = path.resolve('.codex_tmp/backups')
const planPath = path.resolve('.codex_tmp/roster-sync-plan.json')
const now = new Date().toISOString()
const writeBatchSize = 10
const historicalFixtureMatches = fixtureMatches.filter((match) => match.id !== 'm-next' && match.status.startsWith('completed'))

const hash = (value: string, length = 32) => crypto.createHash('sha256').update(value).digest('hex').slice(0, length)
const cloudDate = (value: string) => ({ $date: { $numberLong: String(Date.parse(value)) } })
const numericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const raw = record.$numberInt ?? record.$numberLong ?? record.$numberDouble
    if (raw !== undefined && Number.isFinite(Number(raw))) return Number(raw)
  }
  return undefined
}
const parseCliJson = (value: string): JsonRecord => {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`CloudBase CLI 未返回 JSON：${value.slice(0, 300)}`)
  return JSON.parse(value.slice(start, end + 1)) as JsonRecord
}
const execute = (commands: JsonRecord[]): JsonRecord => {
  const result = spawnSync(process.execPath, [
    cli,
    'db',
    'nosql',
    'execute',
    '-e',
    envId,
    '--command',
    JSON.stringify(commands),
    '--json'
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(JSON.stringify({
      status: result.status,
      signal: result.signal,
      spawnError: result.error?.message,
      stdout: result.stdout,
      stderr: result.stderr
    }, null, 2))
  }
  return parseCliJson(result.stdout)
}
const query = (collection: string, filter: JsonRecord = {}, limit = 1000): JsonRecord[] => {
  const response = execute([{
    TableName: collection,
    CommandType: 'QUERY',
    Command: JSON.stringify({ find: collection, filter, limit })
  }])
  const results = (response.data as { results?: JsonRecord[][] } | undefined)?.results
  return results?.[0] ?? []
}
const updateCommand = (collection: string, updates: JsonRecord[]) => ({
  TableName: collection,
  CommandType: 'UPDATE',
  Command: JSON.stringify({ update: collection, updates })
})
const insertCommand = (collection: string, documents: JsonRecord[]) => ({
  TableName: collection,
  CommandType: 'INSERT',
  Command: JSON.stringify({ insert: collection, documents })
})
const chunks = <T>(values: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}
const withoutUndefined = <T extends Record<string, unknown>>(value: T): T => Object.fromEntries(
  Object.entries(value).filter(([, item]) => item !== undefined)
) as T

const main = async () => {
  const [cloudPlayers, cloudFees, cloudPayments, cloudMatches, cloudStats] = [
    query('players'),
    query('player_fee_assignments'),
    query('fee_payments'),
    query('matches'),
    query('player_match_stats')
  ]
  await fs.mkdir(backupDir, { recursive: true })
  const backupStamp = now.replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `roster-before-${backupStamp}.json`)
  await fs.writeFile(backupPath, `${JSON.stringify({ envId, teamId, capturedAt: now, players: cloudPlayers, feeAssignments: cloudFees, feePayments: cloudPayments, matches: cloudMatches, matchStats: cloudStats }, null, 2)}\n`, 'utf8')

  const aliases = new Map<string, string>([['杨承炫', '杨承铉']])
  const formalCloudPlayers = cloudPlayers.filter((record) => record.teamId === teamId && record.memberType === 'formal')
  const findCloudPlayer = (displayName: string) => formalCloudPlayers.find((record) =>
    record.displayName === displayName || record.sourceName === displayName || record.displayName === aliases.get(displayName) || record.sourceName === aliases.get(displayName)
  )
  const playerUpdates: JsonRecord[] = []
  const playerInserts: JsonRecord[] = []
  const playerIdByFixtureId = new Map<string, string>()
  const playerDiffs: JsonRecord[] = []

  for (const player of fixturePlayers) {
    const historicalChairman = player.id === 'p-alumni-lu-huajie'
    const existing = historicalChairman
      ? cloudPlayers.find((record) => record._id === player.id || record.displayName === player.displayName)
      : findCloudPlayer(player.displayName)
    const id = String(existing?._id || (historicalChairman ? player.id : `player_${hash(`${teamId}:${player.displayName}`)}`))
    playerIdByFixtureId.set(player.id, id)
    const desired = {
      displayName: player.displayName,
      sourceName: player.displayName,
      memberType: 'formal',
      status: player.status,
      position: player.position || '未分类',
      joinYear: player.joinYear,
      publicAuthorized: true,
      showAvatar: true,
      showPhotos: true,
      stats: player.stats,
      seasonStats: player.seasonStats,
      ...(player.shirtNumber !== undefined ? { shirtNumber: player.shirtNumber } : {}),
      ...(player.leaveYear !== undefined ? { leaveYear: player.leaveYear } : {}),
      ...(player.legacySpecialAmount !== undefined ? { legacySpecialAmount: player.legacySpecialAmount } : {}),
      ...(player.legacyAmount !== undefined ? { legacyAmount: player.legacyAmount } : {})
    }
    if (existing) {
      const unset: JsonRecord = {}
      if (player.shirtNumber === undefined && existing.shirtNumber !== undefined) unset.shirtNumber = ''
      const set = { ...desired, updatedAt: cloudDate(now), rosterSource: '2026-09-19-excel' }
      playerUpdates.push({ q: { _id: id }, u: { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }, multi: false, upsert: false })
      playerDiffs.push({ id, displayName: player.displayName, mode: 'update', before: { shirtNumber: numericValue(existing.shirtNumber), position: existing.position, joinYear: numericValue(existing.joinYear) }, after: desired })
    } else {
      const record = {
        _id: id,
        teamId,
        sourceKey: historicalChairman ? 'honorary:lu-huajie' : `roster:${player.displayName}`,
        ...desired,
        stats: player.stats,
        seasonStats: player.seasonStats,
        version: 1,
        rosterSource: '2026-09-19-excel',
        createdAt: cloudDate(now),
        updatedAt: cloudDate(now)
      }
      playerInserts.push(record)
      playerDiffs.push({ id, displayName: player.displayName, mode: 'insert', after: desired })
    }
  }

  const teamCloudMatches = cloudMatches.filter((record) => record.teamId === teamId && !record.deletedAt)
  const matchIdByFixtureId = new Map<string, string>()
  const matchUpdates: JsonRecord[] = []
  const matchInserts: JsonRecord[] = []
  for (const fixtureMatch of historicalFixtureMatches) {
    const existing = teamCloudMatches.find((record) =>
      record.matchDate === fixtureMatch.matchDate &&
      (fixtureMatch.eventType === 'event' ? record.eventType === 'event' : record.opponent === fixtureMatch.opponent)
    )
    const id = String(existing?._id || `match_${hash(`${teamId}:${fixtureMatch.matchDate}:${fixtureMatch.title}`)}`)
    matchIdByFixtureId.set(fixtureMatch.id, id)
    const desired = withoutUndefined({
      teamId,
      title: fixtureMatch.title,
      opponent: fixtureMatch.opponent || null,
      eventType: fixtureMatch.eventType,
      matchDate: fixtureMatch.matchDate,
      kickoffTime: fixtureMatch.kickoffTime,
      publicArea: fixtureMatch.publicArea,
      exactLocation: fixtureMatch.exactLocation,
      gatheringTime: fixtureMatch.gatheringTime,
      capacityEnabled: fixtureMatch.capacityEnabled,
      capacity: fixtureMatch.capacity,
      format: fixtureMatch.format,
      jerseyRequirement: fixtureMatch.jerseyRequirement,
      jerseyCustomNote: fixtureMatch.jerseyCustomNote,
      registrationDeadline: fixtureMatch.registrationDeadline,
      status: fixtureMatch.status,
      countInStats: fixtureMatch.countInStats,
      homeScore: fixtureMatch.homeScore,
      awayScore: fixtureMatch.awayScore,
      apps: fixtureMatch.apps,
      goals: fixtureMatch.goals,
      assists: fixtureMatch.assists,
      internalNote: fixtureMatch.internalNote || null,
      registrationCount: existing?.registrationCount || 0,
      dataSource: '2026-09-08-excel',
      updatedAt: cloudDate(now)
    })
    if (existing) {
      matchUpdates.push({ q: { _id: id }, u: { $set: desired }, multi: false, upsert: false })
    } else {
      matchInserts.push({ _id: id, ...desired, version: 1, createdAt: cloudDate(now) })
    }
  }

  const cloudStatsByKey = new Map(
    cloudStats
      .filter((record) => record.teamId === teamId && !record.deletedAt)
      .map((record) => [`${record.matchId}:${record.playerId}`, record])
  )
  const statUpdates: JsonRecord[] = []
  const statInserts: JsonRecord[] = []
  const fixtureMatchById = new Map(historicalFixtureMatches.map((match) => [match.id, match]))
  const desiredStatKeys = new Set<string>()
  for (const stat of fixtureMatchStats) {
    const fixtureMatch = fixtureMatchById.get(stat.matchId)
    const remoteMatchId = matchIdByFixtureId.get(stat.matchId)
    const remotePlayerId = playerIdByFixtureId.get(stat.playerId) ?? stat.playerId
    if (!fixtureMatch || !remoteMatchId || !remotePlayerId) continue
    const uniqueKey = `${remoteMatchId}:${remotePlayerId}`
    desiredStatKeys.add(uniqueKey)
    const matchOnly = stat.displayName !== undefined || ['trial', 'guest'].includes(stat.memberType || '')
    const desired = {
      uniqueKey,
      teamId,
      matchId: remoteMatchId,
      matchDate: fixtureMatch.matchDate,
      playerId: remotePlayerId,
      ...(stat.displayName ? { displayName: stat.displayName, memberType: stat.memberType || 'trial' } : {}),
      goals: stat.goals,
      assists: stat.assists,
      countInStats: fixtureMatch.countInStats !== false && !matchOnly,
      updatedAt: cloudDate(now)
    }
    const existing = cloudStatsByKey.get(uniqueKey)
    if (existing) {
      statUpdates.push({ q: { _id: existing._id }, u: { $set: desired }, multi: false, upsert: false })
    } else {
      statInserts.push({ _id: uniqueKey, ...desired })
    }
  }
  const targetMatchIds = new Set(matchIdByFixtureId.values())
  const staleStatUpdates = cloudStats
    .filter((record) => record.teamId === teamId && !record.deletedAt && targetMatchIds.has(String(record.matchId)))
    .filter((record) => !desiredStatKeys.has(`${record.matchId}:${record.playerId}`))
    .map((record) => ({
      q: { _id: record._id },
      u: { $set: { deletedAt: cloudDate(now), updatedAt: cloudDate(now) } },
      multi: false,
      upsert: false
    }))

  const fixtureNameById = new Map(fixturePlayers.map((player) => [player.id, player.displayName]))
  const feeUpdates: JsonRecord[] = []
  const feeInserts: JsonRecord[] = []
  for (const assignment of fixtureFeeAssignments) {
    const playerId = playerIdByFixtureId.get(assignment.playerId)
    if (!playerId) throw new Error(`找不到会费记录对应球员：${fixtureNameById.get(assignment.playerId) || assignment.playerId}`)
    const existing = cloudFees.find((record) => record.playerId === playerId && record.effectiveFrom === assignment.effectiveFrom)
    const desired = {
      teamId,
      playerId,
      feePlanId: assignment.feePlanId,
      effectiveFrom: assignment.effectiveFrom,
      effectiveTo: assignment.effectiveTo || null,
      paymentMethod: assignment.paymentMethod || null,
      reason: assignment.reason,
      adjustedBy: '2026-09-19成员信息同步',
      updatedAt: cloudDate(now)
    }
    if (existing) {
      feeUpdates.push({ q: { _id: existing._id }, u: { $set: desired }, multi: false, upsert: false })
    } else {
      feeInserts.push({
        _id: `fee_assignment_${hash(`${playerId}:${assignment.effectiveFrom}:${assignment.feePlanId}`)}`,
        ...desired,
        createdAt: cloudDate(assignment.createdAt)
      })
    }
  }

  const paymentUpdates: JsonRecord[] = []
  const paymentInserts: JsonRecord[] = []
  for (const payment of fixtureFeePayments) {
    const playerId = playerIdByFixtureId.get(payment.playerId)
    if (!playerId) throw new Error(`找不到缴费记录对应球员：${fixtureNameById.get(payment.playerId) || payment.playerId}`)
    const existing = cloudPayments.find((record) => record.playerId === playerId && record.period === payment.period)
    const paymentKey = `${teamId}:${playerId}:${payment.period}`
    const desired = {
      teamId,
      playerId,
      period: payment.period,
      amount: payment.amount,
      status: payment.status,
      paymentKey,
      updatedAt: cloudDate(now),
      updatedBy: '2026-09-19待缴名单同步'
    }
    if (existing) {
      const unset = payment.status === 'unpaid' && existing.paidAt ? { paidAt: '' } : undefined
      paymentUpdates.push({
        q: { _id: existing._id },
        u: { $set: desired, ...(unset ? { $unset: unset } : {}) },
        multi: false,
        upsert: false
      })
    } else {
      paymentInserts.push({
        _id: `fee_payment_${hash(paymentKey, 40)}`,
        ...desired,
        createdAt: cloudDate(payment.updatedAt)
      })
    }
  }

  const activeNumbers = fixturePlayers.filter((player) => player.status === 'active' && player.shirtNumber !== undefined).map((player) => player.shirtNumber)
  const duplicates = activeNumbers.filter((number, index) => activeNumbers.indexOf(number) !== index)
  if (duplicates.length) throw new Error(`现役号码重复：${[...new Set(duplicates)].join('、')}`)
  if (fixturePlayers.filter((player) => player.status === 'active').length !== 52) throw new Error('权威现役名单数量应为 52 人')

  const plan = {
    envId,
    teamId,
    generatedAt: now,
    source: ['大湾区流浪者成员信息.xlsx', '-8月待缴会费 .xlsx', '2026大湾区流浪者数据.xlsx'],
    backupPath,
    summary: {
      activeRoster: fixturePlayers.filter((player) => player.status === 'active').length,
      historicalPlayers: fixturePlayers.filter((player) => player.status === 'alumni').length,
      playerUpdates: playerUpdates.length,
      playerInserts: playerInserts.length,
      matchUpdates: matchUpdates.length,
      matchInserts: matchInserts.length,
      statUpdates: statUpdates.length,
      statInserts: statInserts.length,
      staleStatUpdates: staleStatUpdates.length,
      feeUpdates: feeUpdates.length,
      feeInserts: feeInserts.length,
      paymentUpdates: paymentUpdates.length,
      paymentInserts: paymentInserts.length
    },
    playerDiffs
  }
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')

  if (commit) {
    for (const batch of chunks(playerUpdates, writeBatchSize)) execute([updateCommand('players', batch)])
    for (const batch of chunks(playerInserts, writeBatchSize)) execute([insertCommand('players', batch)])
    for (const batch of chunks(matchUpdates, writeBatchSize)) execute([updateCommand('matches', batch)])
    for (const batch of chunks(matchInserts, writeBatchSize)) execute([insertCommand('matches', batch)])
    for (const batch of chunks(statUpdates, writeBatchSize)) execute([updateCommand('player_match_stats', batch)])
    for (const batch of chunks(statInserts, writeBatchSize)) execute([insertCommand('player_match_stats', batch)])
    for (const batch of chunks(staleStatUpdates, writeBatchSize)) execute([updateCommand('player_match_stats', batch)])
    for (const batch of chunks(feeUpdates, writeBatchSize)) execute([updateCommand('player_fee_assignments', batch)])
    for (const batch of chunks(feeInserts, writeBatchSize)) execute([insertCommand('player_fee_assignments', batch)])
    for (const batch of chunks(paymentUpdates, writeBatchSize)) execute([updateCommand('fee_payments', batch)])
    for (const batch of chunks(paymentInserts, writeBatchSize)) execute([insertCommand('fee_payments', batch)])
  }
  console.log(JSON.stringify({ mode: commit ? 'commit' : 'dry-run', ...plan.summary, backupPath, planPath }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
