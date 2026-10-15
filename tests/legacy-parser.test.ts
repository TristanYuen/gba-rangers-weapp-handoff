import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeLegacyName, parseLegacyWorkbook, parseMatchHeader } from '../scripts/lib/legacyParser'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const makeWorkbook = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gba-legacy-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'legacy.xlsx')
  const headers = ['姓名', '统计', '（明细）', '1.3 VS天海', '1.25 GBA年会活动']
  const attendance = [headers, ['正式球员', null, null, 1, 2], ['（试训）欧阳', null, null, null, 1]]
  const goals = [headers, ['正式球员', null, null, 2, 2]]
  const assists = [headers, ['正式球员', null, null, 1, 3]]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(attendance), '出勤')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(goals), '进球')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(assists), '助攻')
  XLSX.writeFile(workbook, file)
  return file
}

describe('历史 Excel 解析', () => {
  it('解析试训和客串前缀', () => {
    expect(normalizeLegacyName('（试训）欧阳')).toEqual({ displayName: '欧阳', memberType: 'trial' })
    expect(normalizeLegacyName('（客串）夏梓恒')).toEqual({ displayName: '夏梓恒', memberType: 'guest' })
  })

  it('解析比赛和球队活动列名', () => {
    expect(parseMatchHeader('1.3 VS天海')).toMatchObject({ matchDate: '2026-01-03', opponent: '天海', eventType: 'versus' })
    expect(parseMatchHeader('1.25 GBA年会活动')).toMatchObject({ matchDate: '2026-01-25', eventType: 'event', title: 'GBA年会活动' })
  })

  it('按三表姓名并集导入，并保留助攻异常', () => {
    const batch = parseLegacyWorkbook(makeWorkbook(), '2026-07-23T00:00:00.000Z')
    expect(batch.totals).toEqual({ players: 2, matches: 2, appearances: 3, goals: 4, assists: 4 })
    expect(batch.playerMatchStats).toHaveLength(3)
    expect(batch.issues.some((issue) => issue.code === 'MISSING_STATS_ROW')).toBe(true)
    expect(batch.issues.some((issue) => issue.code === 'ASSISTS_EXCEED_GOALS')).toBe(true)
    expect(batch.matches[1]?.migrationIssue).toBe('pending')
  })
})
