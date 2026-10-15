import crypto from 'node:crypto'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

export type LegacyMemberType = 'formal' | 'trial' | 'guest'

export interface LegacyIssue {
  code: 'ASSISTS_EXCEED_GOALS' | 'MISSING_STATS_ROW' | 'STAT_WITHOUT_APPEARANCE' | 'INVALID_CELL'
  severity: 'warning' | 'pending'
  message: string
  matchSource?: string
  playerSource?: string
  sourceCell?: string
}

export interface LegacyPlayer {
  sourceKey: string
  sourceName: string
  displayName: string
  memberType: LegacyMemberType
}

export interface LegacyMatch {
  sourceKey: string
  sourceHeader: string
  matchDate: string
  title: string
  opponent?: string
  eventType: 'versus' | 'event'
  status: 'completed_pending_score'
  homeScore: null
  awayScore: null
  countInStats: true
  apps: number
  goals: number
  assists: number
  migrationIssue: 'pending' | null
}

export interface LegacyAppearance {
  sourceKey: string
  playerSourceKey: string
  matchSourceKey: string
}

export interface LegacyPlayerMatchStat {
  sourceKey: string
  playerSourceKey: string
  matchSourceKey: string
  goals: number
  assists: number
}

export interface LegacyBatch {
  batchId: string
  fileHash: string
  sourceFile: string
  importedAt: string
  players: LegacyPlayer[]
  matches: LegacyMatch[]
  appearances: LegacyAppearance[]
  playerMatchStats: LegacyPlayerMatchStat[]
  issues: LegacyIssue[]
  totals: { players: number; matches: number; appearances: number; goals: number; assists: number }
}

type CellValue = string | number | boolean | null | undefined
type Matrix = CellValue[][]

const hash = (value: string) => crypto.createHash('sha1').update(value).digest('hex').slice(0, 16)

export const normalizeLegacyName = (sourceName: string): Pick<LegacyPlayer, 'displayName' | 'memberType'> => {
  const trimmed = sourceName.trim()
  const match = trimmed.match(/^[（(](试训|客串)[）)]\s*(.+)$/)
  if (!match) return { displayName: trimmed, memberType: 'formal' }
  return { displayName: match[2]!.trim(), memberType: match[1] === '试训' ? 'trial' : 'guest' }
}

export const parseMatchHeader = (header: string) => {
  const match = header.trim().match(/^(\d{1,2})\.(\d{1,2})\s+(.+)$/)
  if (!match) throw new Error(`无法解析赛事列标题：${header}`)
  const month = match[1]!.padStart(2, '0')
  const day = match[2]!.padStart(2, '0')
  const subject = match[3]!.trim()
  const versus = subject.match(/^VS\s*(.+)$/i)
  const eventType = versus ? 'versus' as const : 'event' as const
  const opponent = versus?.[1]?.trim()
  const title = eventType === 'versus' ? `GBA RANGERS VS ${opponent}` : subject
  return { matchDate: `2026-${month}-${day}`, title, opponent, eventType }
}

const readMatrix = (workbook: XLSX.WorkBook, name: string): Matrix => {
  const sheet = workbook.Sheets[name]
  if (!sheet) throw new Error(`缺少工作表：${name}`)
  return XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, raw: true, defval: null })
}

const rowMap = (matrix: Matrix): Map<string, CellValue[]> => new Map(
  matrix.slice(1)
    .filter((row) => typeof row[0] === 'string' && row[0].trim())
    .map((row) => [String(row[0]).trim(), row])
)

const numeric = (value: CellValue, cell: string, issues: LegacyIssue[]): number => {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    issues.push({ code: 'INVALID_CELL', severity: 'warning', message: `单元格 ${cell} 不是非负整数`, sourceCell: cell })
    return 0
  }
  return parsed
}

const sourceCell = (sheetName: string, matrix: Matrix, playerName: string, columnIndex: number): string => {
  const rowIndex = matrix.findIndex((row) => row[0] === playerName)
  return rowIndex >= 0
    ? `${sheetName}!${XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })}`
    : `${sheetName}!(missing row)`
}

export const parseLegacyWorkbook = (sourceFile: string, importedAt = new Date().toISOString()): LegacyBatch => {
  const fileBuffer = fs.readFileSync(sourceFile)
  const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: false })
  const attendanceMatrix = readMatrix(workbook, '出勤')
  const goalsMatrix = readMatrix(workbook, '进球')
  const assistsMatrix = readMatrix(workbook, '助攻')
  const headers = attendanceMatrix[0]?.slice(3).map(String) ?? []
  const otherHeaders = [goalsMatrix, assistsMatrix].map((matrix) => matrix[0]?.slice(3).map(String) ?? [])
  if (otherHeaders.some((values) => JSON.stringify(values) !== JSON.stringify(headers))) throw new Error('三张工作表的赛事列不一致')

  const attendance = rowMap(attendanceMatrix)
  const goals = rowMap(goalsMatrix)
  const assists = rowMap(assistsMatrix)
  const sourceNames = [...new Set([...attendance.keys(), ...goals.keys(), ...assists.keys()])]
  const players = sourceNames.map((sourceName): LegacyPlayer => ({
    sourceKey: `legacy-2026:player:${hash(sourceName)}`,
    sourceName,
    ...normalizeLegacyName(sourceName)
  }))
  const issues: LegacyIssue[] = []
  for (const sourceName of sourceNames) {
    if (!goals.has(sourceName) || !assists.has(sourceName)) {
      issues.push({ code: 'MISSING_STATS_ROW', severity: 'warning', message: `${sourceName} 在进球或助攻表中缺少行，按 0 处理`, playerSource: sourceName })
    }
  }

  const appearances: LegacyAppearance[] = []
  const playerMatchStats: LegacyPlayerMatchStat[] = []
  const matches: LegacyMatch[] = []

  headers.forEach((sourceHeader, headerIndex) => {
    const columnIndex = headerIndex + 3
    const parsedHeader = parseMatchHeader(sourceHeader)
    const matchSourceKey = `legacy-2026:match:${parsedHeader.matchDate}:${hash(sourceHeader)}`
    let matchGoals = 0
    let matchAssists = 0
    let matchApps = 0
    for (const player of players) {
      const attendanceValue = attendance.get(player.sourceName)?.[columnIndex]
      const played = attendanceValue !== null && attendanceValue !== undefined && attendanceValue !== ''
      const goalValue = numeric(
        goals.get(player.sourceName)?.[columnIndex],
        sourceCell('进球', goalsMatrix, player.sourceName, columnIndex),
        issues
      )
      const assistValue = numeric(
        assists.get(player.sourceName)?.[columnIndex],
        sourceCell('助攻', assistsMatrix, player.sourceName, columnIndex),
        issues
      )
      if (!played && (goalValue > 0 || assistValue > 0)) {
        issues.push({ code: 'STAT_WITHOUT_APPEARANCE', severity: 'pending', message: `${player.sourceName} 在 ${sourceHeader} 有 G／A 但没有出场`, matchSource: sourceHeader, playerSource: player.sourceName })
      }
      if (played) {
        matchApps += 1
        const relationKey = `${matchSourceKey}:${player.sourceKey}`
        appearances.push({ sourceKey: `appearance:${relationKey}`, playerSourceKey: player.sourceKey, matchSourceKey })
        playerMatchStats.push({ sourceKey: `player-match-stat:${relationKey}`, playerSourceKey: player.sourceKey, matchSourceKey, goals: goalValue, assists: assistValue })
      }
      matchGoals += goalValue
      matchAssists += assistValue
    }
    const hasIssue = matchAssists > matchGoals
    if (hasIssue) issues.push({ code: 'ASSISTS_EXCEED_GOALS', severity: 'pending', message: `${sourceHeader}：${matchGoals} 球、${matchAssists} 助攻`, matchSource: sourceHeader })
    matches.push({
      sourceKey: matchSourceKey,
      sourceHeader,
      ...parsedHeader,
      status: 'completed_pending_score',
      homeScore: null,
      awayScore: null,
      countInStats: true,
      apps: matchApps,
      goals: matchGoals,
      assists: matchAssists,
      migrationIssue: hasIssue ? 'pending' : null
    })
  })

  const totals = {
    players: players.length,
    matches: matches.length,
    appearances: appearances.length,
    goals: playerMatchStats.reduce((sum, row) => sum + row.goals, 0),
    assists: playerMatchStats.reduce((sum, row) => sum + row.assists, 0)
  }
  return {
    batchId: `legacy-2026-${fileHash.slice(0, 12)}`,
    fileHash,
    sourceFile: sourceFile.split(/[\\/]/).pop() || 'legacy.xlsx',
    importedAt,
    players,
    matches,
    appearances,
    playerMatchStats,
    issues,
    totals
  }
}
