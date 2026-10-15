const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tmp', 'fee-preview')
const base = 'http://127.0.0.1:4173/#'

fs.mkdirSync(output, { recursive: true })

const run = async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  })
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    locale: 'zh-CN'
  })
  const page = await context.newPage()
  const open = async (route) => {
    await page.goto('about:blank')
    await page.goto(`${base}${route}`, { waitUntil: 'networkidle' })
    await page.locator('#app').waitFor({ state: 'visible' })
    await page.waitForTimeout(700)
  }

  await open('/pages/account/index')
  await page.getByText('管理员', { exact: true }).last().click()
  await page.waitForTimeout(300)

  await open('/pages/fees/index')
  await page.screenshot({ path: path.join(output, 'fee-management.png'), fullPage: true })
  await page.getByText('调整', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(output, 'fee-adjustment.png'), fullPage: true })

  await open('/pages/players/profile?id=p-huang')
  await page.screenshot({ path: path.join(output, 'player-fee-profile.png'), fullPage: true })

  await browser.close()
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
