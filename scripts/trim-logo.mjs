import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const p = await b.newPage()
const data = fs.readFileSync('public/iupc-logo.png').toString('base64')
const out = await p.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  let minX = c.width, minY = c.height, maxX = 0, maxY = 0
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4
    if (data[i + 3] > 10 && (data[i] < 245 || data[i+1] < 245 || data[i+2] < 245)) {
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  const cut = (sx, sy, sw, sh) => {
    const t = document.createElement('canvas')
    t.width = sw; t.height = sh
    t.getContext('2d').drawImage(c, sx, sy, sw, sh, 0, 0, sw, sh)
    return t.toDataURL('image/png')
  }
  const wordmarkW = maxX - minX + 1, wordmarkH = maxY - minY + 1
  // The emblem is the right-hand block of the lockup: the figure + red dome.
  const crestX = maxX - Math.round(wordmarkH * 0.98)
  return {
    size: [c.width, c.height],
    bbox: [minX, minY, maxX, maxY],
    wordmark: cut(minX, minY, wordmarkW, wordmarkH),
    crest: cut(crestX, minY, maxX - crestX + 1, wordmarkH),
  }
}, data)
console.log(JSON.stringify({ size: out.size, bbox: out.bbox }))
fs.writeFileSync('public/iupc-wordmark.png', Buffer.from(out.wordmark.split(',')[1], 'base64'))
fs.writeFileSync('public/iupc-crest.png', Buffer.from(out.crest.split(',')[1], 'base64'))
await b.close()
