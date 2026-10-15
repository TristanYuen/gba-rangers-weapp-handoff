import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve('dist-h5')
const port = Number(process.env.PORT || 4173)
const host = '127.0.0.1'
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', `http://${host}`).pathname)
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const requested = path.resolve(root, relative)
    const safeFile = requested.startsWith(`${root}${path.sep}`) || requested === path.join(root, 'index.html')
      ? requested
      : path.join(root, 'index.html')
    let file = safeFile
    try { await fs.access(file) } catch { file = path.join(root, 'index.html') }
    const body = await fs.readFile(file)
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
    response.end(body)
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : '预览服务启动失败')
  }
})

server.listen(port, host, () => {
  console.log(`GBA RANGERS 手机预览：http://${host}:${port}`)
})
