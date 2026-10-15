import fs from 'node:fs/promises'
import path from 'node:path'

const sourceRoot = path.resolve('cloudfunctions-src')
const outputRoot = path.resolve('cloudfunctions-dist')
const functions = ['public-query', 'membership', 'match', 'stats', 'media', 'notifications', 'notification-worker', 'team', 'fees']
const common = await fs.readFile(path.join(sourceRoot, 'common.js'), 'utf8')
await fs.mkdir(outputRoot, { recursive: true })

for (const name of functions) {
  const target = path.join(outputRoot, name)
  await fs.mkdir(target, { recursive: true })
  await fs.copyFile(path.join(sourceRoot, name, 'index.js'), path.join(target, 'index.js'))
  try {
    await fs.copyFile(path.join(sourceRoot, name, 'config.json'), path.join(target, 'config.json'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await fs.writeFile(path.join(target, 'common.js'), common, 'utf8')
  await fs.writeFile(path.join(target, 'package.json'), `${JSON.stringify({ name: `gba-${name}`, version: '1.0.0', main: 'index.js', dependencies: { 'wx-server-sdk': '3.0.1' } }, null, 2)}\n`, 'utf8')
}

console.log(`Built ${functions.length} CloudBase functions in ${outputRoot}`)
