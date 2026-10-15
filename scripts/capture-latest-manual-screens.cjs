const fs = require('fs')
const path = require('path')
const { chromium } = require('../tmp/manual-tools/node_modules/playwright-core')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp', 'product-manual-2026-07', 'screens')
const base = 'http://127.0.0.1:4173/#'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

fs.mkdirSync(output, { recursive: true })

const run = async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome })
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    colorScheme: 'light'
  })
  const page = await context.newPage()

  const open = async (route) => {
    await page.goto('about:blank')
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
    await page.locator('#app').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(650)
    await page.evaluate(() => window.scrollTo(0, 0))
  }

  const shot = async (name) => {
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false })
  }

  const focus = async (text, name, exact = true) => {
    const locator = page.getByText(text, { exact }).first()
    await locator.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -110))
    await shot(name)
  }

  const setRole = async (role) => {
    await open('/pages/account/index')
    await page.getByText(role, { exact: true }).last().click()
    await page.waitForTimeout(300)
  }

  await setRole('管理员')
  await shot('01-account-admin')

  await open('/pages/home/index')
  await shot('02-team-home')

  await open('/pages/matches/index')
  await shot('03-match-center')
  await page.getByText('历史比赛', { exact: true }).click()
  await shot('04-match-history')

  await open('/pages/matches/detail?id=m-next')
  await shot('05-match-detail')
  await focus('赛事信息', '06-match-location')

  await open('/pages/matches/signup?id=m-next')
  await shot('07-signup-options')
  await focus('人员状态总览', '08-signup-manager')

  await open('/pages/notices/index')
  await shot('09-notices')
  await page.getByText('发布通知', { exact: true }).click()
  await shot('10-notice-publish')

  await open('/pages/players/index')
  await shot('11-player-roster')
  await page.getByText('历史成员', { exact: true }).click()
  await shot('12-alumni-roster')

  await open('/pages/players/profile?id=p-li-xiang')
  await shot('13-player-profile')
  await focus('会费信息', '14-player-fee-profile')

  await open('/pages/players/profile?id=p-alumni-lu-huajie')
  await shot('15-chairman-honor')

  await open('/pages/players/edit?id=p-li-xiang')
  await shot('16-player-edit')

  await open('/pages/leaderboard/index')
  await shot('17-leaderboard')

  await open('/pages/yearbook/index')
  await shot('18-yearbook')
  await open('/pages/yearbook/detail?id=y-m-history-1')
  await shot('19-yearbook-detail')
  await focus('比赛相册', '20-yearbook-album')

  await open('/pages/fees/index')
  await shot('21-fee-dashboard')
  await focus('球员缴费台账', '22-fee-ledger')
  const adjust = page.getByText('调整档次', { exact: true }).first()
  await adjust.click()
  await page.waitForTimeout(250)
  await shot('23-fee-adjustment')
  await page.locator('input[placeholder="例如：重大伤病、异地工作或队委会确认"]').fill('长期异地工作，申请调整会费档次')
  await page.getByText('确认调整', { exact: true }).click()
  await page.waitForTimeout(300)

  await open('/pages/admin/index')
  await shot('24-admin-dashboard')
  await focus('管理员操作记录', '25-admin-logs')
  await focus('成员审核与档案绑定', '26-member-review')
  await focus('照片审核', '27-photo-review')

  await setRole('队长')
  await open('/pages/fees/index')
  await shot('23b-fee-owner-review')
  await open('/pages/admin/index')
  await focus('管理员任命', '28-admin-appointment')
  await page.getByText('成员名单', { exact: true }).click()
  await page.waitForTimeout(250)
  await shot('29-admin-appointment-list')

  await open('/pages/matches/edit')
  await shot('30-match-create')
  await open('/pages/matches/post-match?id=m-history-14')
  await shot('31-post-match')

  await setRole('访客')
  await shot('32-visitor-join')

  await setRole('球员')
  await shot('33-account-player')

  await browser.close()
  const count = fs.readdirSync(output).filter((name) => name.endsWith('.png')).length
  console.log(`Captured ${count} manual screens in ${output}`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
