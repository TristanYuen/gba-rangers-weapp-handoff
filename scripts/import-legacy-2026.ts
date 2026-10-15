import fs from 'node:fs/promises'
import path from 'node:path'
import { parseLegacyWorkbook, type LegacyBatch } from './lib/legacyParser'

type Mode = 'dry-run' | 'commit' | 'rollback'

interface LocalMigrationStore {
  batches: Record<string, LegacyBatch>
}

const args = process.argv.slice(2)
const mode: Mode = args.includes('--commit') ? 'commit' : args.includes('--rollback') ? 'rollback' : 'dry-run'
const rollbackIndex = args.indexOf('--rollback')
const rollbackBatchId = rollbackIndex >= 0 ? args[rollbackIndex + 1] : undefined
const outputFlag = args.indexOf('--output-dir')
const valueIndexes = new Set([rollbackIndex + 1, outputFlag + 1].filter((index) => index > 0))
const sourceFile = args.find((arg, index) => !arg.startsWith('--') && !valueIndexes.has(index))
const outputDir = path.resolve(outputFlag >= 0 && args[outputFlag + 1] ? args[outputFlag + 1]! : 'artifacts/migration')
const storeDir = path.resolve('artifacts/migration-store')
const storeFile = path.join(storeDir, 'state.json')

const readStore = async (): Promise<LocalMigrationStore> => {
  try { return JSON.parse(await fs.readFile(storeFile, 'utf8')) as LocalMigrationStore }
  catch { return { batches: {} } }
}

const writeStore = async (store: LocalMigrationStore) => {
  await fs.mkdir(storeDir, { recursive: true })
  await fs.writeFile(storeFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

const markdownReport = (batch: LegacyBatch) => [
  `# 2026 历史数据迁移预检查`,
  '',
  `- 批次：${batch.batchId}`,
  `- 文件哈希：${batch.fileHash}`,
  `- 球员：${batch.totals.players}`,
  `- 赛事：${batch.totals.matches}`,
  `- 出场人次：${batch.totals.appearances}`,
  `- 进球：${batch.totals.goals}`,
  `- 助攻：${batch.totals.assists}`,
  `- 待核对：${batch.issues.filter((issue) => issue.severity === 'pending').length}`,
  '',
  '## 赛事核对',
  '',
  '| 赛事 | 出场 | 进球 | 助攻 | 状态 |',
  '| --- | ---: | ---: | ---: | --- |',
  ...batch.matches.map((match) => `| ${match.sourceHeader} | ${match.apps} | ${match.goals} | ${match.assists} | ${match.migrationIssue ? '待核对' : '可导入'} |`),
  '',
  '## 异常与提示',
  '',
  ...batch.issues.map((issue) => `- [${issue.severity}] ${issue.message}`)
].join('\n')

const main = async () => {
  if (mode === 'rollback') {
    if (!rollbackBatchId) throw new Error('请在 --rollback 后提供 batchId')
    const store = await readStore()
    if (!store.batches[rollbackBatchId]) throw new Error(`找不到迁移批次：${rollbackBatchId}`)
    delete store.batches[rollbackBatchId]
    await writeStore(store)
    console.log(JSON.stringify({ mode, batchId: rollbackBatchId, status: 'rolled_back' }, null, 2))
    return
  }
  if (!sourceFile) throw new Error('请提供 Excel 路径，例如：pnpm migrate:legacy -- --dry-run "2026大湾区流浪者数据.xlsx"')
  const batch = parseLegacyWorkbook(path.resolve(sourceFile))
  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, `${batch.batchId}.json`), `${JSON.stringify(batch, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(outputDir, `${batch.batchId}.md`), `${markdownReport(batch)}\n`, 'utf8')
  if (mode === 'commit') {
    const store = await readStore()
    const existing = Object.values(store.batches).find((item) => item.fileHash === batch.fileHash)
    if (existing) {
      console.log(JSON.stringify({ mode, batchId: existing.batchId, status: 'already_committed', totals: existing.totals }, null, 2))
      return
    }
    store.batches[batch.batchId] = batch
    await writeStore(store)
  }
  console.log(JSON.stringify({ mode, batchId: batch.batchId, status: mode === 'commit' ? 'committed_local' : 'report_ready', totals: batch.totals, pendingIssues: batch.issues.filter((issue) => issue.severity === 'pending').length }, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
