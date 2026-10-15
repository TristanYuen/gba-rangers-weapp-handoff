import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const root = process.cwd()
const manifest = JSON.parse(await fs.readFile(path.join(root, 'HANDOFF-MANIFEST.json'), 'utf8'))
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const mismatches = []
for (const [relative, expected] of Object.entries(manifest.files)) {
  try {
    if (sha(await fs.readFile(path.join(root, relative))) !== expected) mismatches.push(relative)
  } catch {
    mismatches.push(relative)
  }
}
const functions = ['public-query', 'membership', 'match', 'stats', 'media', 'notifications', 'notification-worker', 'team', 'fees']
for (const name of functions) {
  for (const file of ['index.js', 'common.js']) {
    const source = path.join(root, 'cloudfunctions-src', ...(file === 'index.js' ? [name, file] : [file]))
    const bundled = path.join(root, '微信开发者工具导入包', 'cloudfunctions', name, file)
    if (!(await fs.readFile(source)).equals(await fs.readFile(bundled))) mismatches.push(`云函数不一致：${name}/${file}`)
  }
}
if (mismatches.length) {
  console.error('与交付基线不一致；开发后源码变动也会产生此结果：\n' + mismatches.join('\n'))
  process.exitCode = 1
} else {
  console.log(`${Object.keys(manifest.files).length}个交付文件校验通过，9个云函数源码与导入包一致。`)
}
