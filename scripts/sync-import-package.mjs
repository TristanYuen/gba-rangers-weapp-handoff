import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const mode = process.argv[2]
if (!['--frontend', '--cloud', '--all'].includes(mode)) {
  throw new Error('用法：node scripts/sync-import-package.mjs --frontend | --cloud | --all')
}
const targets = mode === '--all' ? ['frontend', 'cloud'] : [mode.slice(2)]
for (const target of targets) {
  const source = path.join(root, target === 'frontend' ? 'dist' : 'cloudfunctions-dist')
  const destination = path.join(root, '微信开发者工具导入包', target === 'frontend' ? 'miniprogram' : 'cloudfunctions')
  await fs.access(source)
  await fs.rm(destination, { recursive: true, force: true })
  await fs.cp(source, destination, { recursive: true })
  console.log(`已同步${target}：${destination}`)
}
