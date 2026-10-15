const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const out = path.join(root, 'tmp', 'pdfs', 'screens')
const base = 'http://127.0.0.1:4173/#'
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

fs.mkdirSync(out, { recursive: true })

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
    // Force a fresh document before changing the hash route. This prevents a
    // lazy-loaded page from the previous route being captured one step late.
    await page.goto('about:blank')
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
    await page.locator('#app').waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForTimeout(900)
  }

  const shot = async (name, fullPage = true) => {
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage })
  }

  // Establish an approved administrator session through the real UI.
  await open('/pages/account/index')
  const adminButton = page.getByText('管理员', { exact: true }).last()
  await adminButton.click()
  await page.waitForTimeout(250)
  await shot('01-team-home')

  await open('/pages/matches/index')
  await shot('02-match-center')
  await page.getByText('历史比赛', { exact: true }).click()
  await page.waitForTimeout(250)
  await shot('03-match-history')

  await open('/pages/matches/detail?id=m-next')
  await shot('04-match-detail')
  await open('/pages/matches/signup?id=m-next')
  await shot('05-match-signup')

  await open('/pages/notices/index')
  await shot('06-notices')
  await page.getByText('发布通知', { exact: true }).click()
  await page.waitForTimeout(250)
  await shot('07-notice-publish')

  await open('/pages/players/index')
  await shot('08-players')
  await open('/pages/players/profile?id=p-li-xiang')
  await shot('09-player-profile')
  await open('/pages/leaderboard/index')
  await shot('10-leaderboard')

  await open('/pages/yearbook/index')
  await shot('11-yearbook')
  await open('/pages/yearbook/detail?id=y-m-history-1')
  await shot('12-yearbook-detail')

  await open('/pages/admin/index')
  await shot('13-admin-center')
  await open('/pages/matches/edit')
  await shot('14-match-edit')
  await open('/pages/matches/post-match?id=m-history-14')
  await shot('15-post-match')

  // Permission and membership application state.
  await open('/pages/account/index')
  await page.getByText('访客', { exact: true }).last().click()
  await page.waitForTimeout(250)
  await shot('16-join-review')

  await browser.close()
  console.log(`Captured ${fs.readdirSync(out).filter((name) => name.endsWith('.png')).length} screens in ${out}`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
