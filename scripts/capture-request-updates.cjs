const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp', 'request-updates-preview')
const base = 'http://127.0.0.1:4173/#'

fs.mkdirSync(output, { recursive: true })

const run = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, locale: 'zh-CN' })
  const page = await context.newPage()
  const open = async (route) => {
    await page.goto('about:blank')
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
    await page.locator('#app').waitFor({ state: 'visible' })
    await page.waitForTimeout(650)
  }

  await open('/pages/account/index')
  await page.getByText('管理员', { exact: true }).last().click()

  await open('/pages/matches/signup?id=m-next')
  await page.screenshot({ path: path.join(output, 'signup-note.png'), fullPage: true })
  await page.locator('taro-button-core.signup-option').filter({ hasText: '缺席' }).click()
  await page.locator('input.weui-input').fill('临时有事，取消本场报名')
  await page.getByText('确认报名', { exact: true }).click()
  await page.waitForTimeout(350)

  await open('/pages/notices/index')
  await page.screenshot({ path: path.join(output, 'manager-signup-notice.png'), fullPage: true })

  await open('/pages/yearbook/detail?id=y-m-history-1')
  await page.screenshot({ path: path.join(output, 'yearbook-album.png'), fullPage: true })

  await browser.close()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
