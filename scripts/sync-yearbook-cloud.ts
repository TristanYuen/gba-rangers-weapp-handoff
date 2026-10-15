import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fixtureMatches } from '../src/data/fixtures'

type JsonRecord = Record<string, unknown>

const args = new Set(process.argv.slice(2))
const commit = args.has('--commit')
const envId = 'cloud1-d4g1nl8yx26d1f3f2'
const teamId = '698a4c596a69ed84010a7c2e27709c78'
const cli = process.env.GBA_CLOUDBASE_CLI || '/opt/homebrew/bin/cloudbase'
const outputDir = path.resolve('.codex_tmp/yearbook-sync')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupPath = path.join(outputDir, `yearbook-before-${stamp}.json`)
const planPath = path.join(outputDir, `yearbook-plan-${stamp}.json`)
const now = new Date().toISOString()

const hash = (value: string, length = 32) => crypto.createHash('sha256').update(value).digest('hex').slice(0, length)
const cloudDate = (value: string) => ({ $date: { $numberLong: String(Date.parse(value)) } })

const execute = (commands: JsonRecord[]): JsonRecord => {
  const result = spawnSync(cli, [
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
    throw new Error(JSON.stringify({ status: result.status, signal: result.signal, spawnError: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2))
  }
  const start = result.stdout.indexOf('{')
  const end = result.stdout.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`CloudBase CLI未返回JSON：${result.stdout.slice(0, 300)}`)
  return JSON.parse(result.stdout.slice(start, end + 1)) as JsonRecord
}

const query = (collection: string, filter: JsonRecord, limit = 1000): JsonRecord[] => {
  const response = execute([{
    TableName: collection,
    CommandType: 'QUERY',
    Command: JSON.stringify({ find: collection, filter, limit })
  }])
  const results = (response.data as { results?: JsonRecord[][] } | undefined)?.results
  return results?.[0] ?? []
}

const updateCommand = (updates: JsonRecord[]) => ({
  TableName: 'yearbook_entries',
  CommandType: 'UPDATE',
  Command: JSON.stringify({ update: 'yearbook_entries', updates })
})

const insertCommand = (documents: JsonRecord[]) => ({
  TableName: 'yearbook_entries',
  CommandType: 'INSERT',
  Command: JSON.stringify({ insert: 'yearbook_entries', documents })
})

const main = async () => {
  const cloudMatches = query('matches', { teamId }, 500)
    .filter((record) => record.teamId === teamId && !record.deletedAt)
  const yearbookBackup = query('yearbook_entries', { teamId }, 1000)
    .filter((record) => record.teamId === teamId)
  const cloudYearbook = yearbookBackup.filter((record) => !record.deletedAt)
  const historical = fixtureMatches.filter((match) => match.id !== 'm-next' && ['completed', 'completed_pending_score'].includes(match.status))
  const updates: JsonRecord[] = []
  const inserts: JsonRecord[] = []
  const conflicts: JsonRecord[] = []
  const reconciled: JsonRecord[] = []

  for (const fixture of historical) {
    const candidates = cloudMatches.filter((record) =>
      record.matchDate === fixture.matchDate &&
      record.eventType === fixture.eventType &&
      (fixture.eventType === 'event' || record.opponent === fixture.opponent)
    )
    if (candidates.length !== 1) {
      conflicts.push({ fixtureMatchId: fixture.id, matchDate: fixture.matchDate, opponent: fixture.opponent, cloudMatchesFound: candidates.length })
      continue
    }
    const cloudMatch = candidates[0] as JsonRecord
    const matchId = String(cloudMatch._id)
    const existing = cloudYearbook.filter((entry) => entry.matchId === matchId)
    if (existing.length > 1) {
      conflicts.push({ fixtureMatchId: fixture.id, matchId, duplicateYearbookEntries: existing.map((entry) => entry._id) })
      continue
    }

    const current = existing[0]
    const summary = `${fixture.apps} 人出场 · ${fixture.goals} 球 · ${fixture.assists} 助攻`
    const year = Number(fixture.matchDate.slice(0, 4))
    const type = fixture.eventType === 'event' ? 'team_activity' : 'match'
    const desired = {
      teamId,
      year,
      type,
      matchId,
      title: fixture.title,
      date: fixture.matchDate,
      summary,
      public: current?.public ?? true,
      featured: current?.featured ?? false,
      updatedAt: cloudDate(now)
    }

    if (current) {
      updates.push({ q: { _id: current._id }, u: { $set: desired }, multi: false, upsert: false })
      reconciled.push({ matchId, year, type, entryId: current._id, date: fixture.matchDate, title: fixture.title, opponent: fixture.opponent, mode: 'update', summary, public: desired.public, featured: desired.featured })
    } else {
      const id = `yearbook_${hash(`${teamId}:${matchId}`)}`
      inserts.push({ _id: id, ...desired, createdAt: cloudDate(now) })
      reconciled.push({ matchId, year, type, entryId: id, date: fixture.matchDate, title: fixture.title, opponent: fixture.opponent, mode: 'insert', summary, public: desired.public, featured: desired.featured })
    }
  }

  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(backupPath, `${JSON.stringify({ envId, teamId, capturedAt: now, yearbook: yearbookBackup }, null, 2)}\n`, 'utf8')
  const plan = { envId, teamId, generatedAt: now, source: '2026大湾区流浪者数据.xlsx / fixtureMatches', backupPath, summary: { historicalMatches: historical.length, existingYearbookEntries: cloudYearbook.length, updates: updates.length, inserts: inserts.length, conflicts: conflicts.length }, conflicts, reconciled }
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')

  if (commit && conflicts.length) throw new Error(`发现${conflicts.length}项比赛或年鉴关联冲突，已停止写入。预演文件：${planPath}`)
  if (commit) {
    for (let index = 0; index < updates.length; index += 10) execute([updateCommand(updates.slice(index, index + 10))])
    for (let index = 0; index < inserts.length; index += 10) execute([insertCommand(inserts.slice(index, index + 10))])
    const verifiedEntries = query('yearbook_entries', { teamId }, 1000)
      .filter((record) => record.teamId === teamId && !record.deletedAt)
    const mismatches = reconciled.filter((expected) => {
      const actual = verifiedEntries.filter((entry) => entry.matchId === expected.matchId)
      if (actual.length !== 1) return true
      const record = actual[0]
      if (!record) return true
      const fields = ['year', 'type', 'title', 'date', 'summary', 'public', 'featured'] as const
      return fields.some((field) => {
        const value = record[field]
        const normalized = value && typeof value === 'object'
          ? Number((value as JsonRecord).$numberInt ?? (value as JsonRecord).$numberLong ?? value)
          : value
        return normalized !== expected[field]
      })
    })
    if (mismatches.length) throw new Error(`年鉴写入后的回读核验发现${mismatches.length}项差异：${JSON.stringify(mismatches)}`)
  }
  console.log(JSON.stringify({ mode: commit ? 'commit' : 'dry-run', ...plan.summary, backupPath, planPath, conflicts }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
