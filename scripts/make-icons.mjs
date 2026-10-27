import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

/**
 * The app's imagery, cut from the supplied IUPC artwork.
 *
 *   npm run icons
 *
 * Nothing here is drawn from type or guessed from a crop fraction: the source
 * `public/iupc-logo.png` is split into its connected ink shapes and each part is
 * placed by its own measured bounds.
 *
 * The artwork is the lockup "IUPC ACADEMY" over the emblem (a figure rising out
 * of a crimson dome), with the tagline *YOUR PATHWAY TO TOP UNIVERSITIES
 * GLOBALLY* beneath it. Read off the source:
 *
 *   the letters     18–38 px tall, and the red P and C are part of them
 *   the emblem      61 px tall — the tallest single shape, so it is separable
 *   the tagline      6 px tall — a run of small shapes along the bottom
 *
 * So the emblem is the tallest shape and the lockup is every shape taller than
 * the tagline. That is the whole trick, and it needs no magic numbers.
 *
 * The launcher icons carry the emblem on the school's paper rather than on the
 * brand crimson: the dome is crimson and the figure black, so a crimson ground
 * would swallow the dome it is built around. The splash screen has room for the
 * full lockup and uses it.
 */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SRC = 'public/iupc-logo.png'
const OUT = 'public'
const ANDROID_RES = 'android/app/src/main/res'

const PAPER = '#ffffff'

/** Legacy launcher icons, by density. Android 8+ uses the adaptive icon. */
const LAUNCHER = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]

/** Adaptive-icon foregrounds: a 108 dp canvas per density, 66 dp safe circle. */
const FOREGROUND = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432],
]

/** Splash screens, at the sizes the Capacitor template ships. */
const SPLASH = [
  ['drawable', 480, 320],
  ['drawable-land-mdpi', 480, 320],
  ['drawable-land-hdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
  ['drawable-land-xxhdpi', 1600, 960],
  ['drawable-land-xxxhdpi', 1920, 1280],
  ['drawable-port-mdpi', 320, 480],
  ['drawable-port-hdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxhdpi', 960, 1600],
  ['drawable-port-xxxhdpi', 1280, 1920],
]

/**
 * `fill` is the share of the icon the part is allowed to occupy, and `native`
 * keeps a part at the artwork's own resolution — which is what the app's crest
 * and wordmark want, since the interface draws them at their true size.
 */
const specs = [
  { file: `${OUT}/iupc-crest.png`, part: 'emblem', native: true },
  { file: `${OUT}/iupc-wordmark.png`, part: 'full', native: true },
  { file: `${OUT}/favicon.png`, w: 64, part: 'emblem', ground: PAPER, fill: 0.92, tighten: true },
  { file: `${OUT}/apple-touch-icon.png`, w: 180, part: 'emblem', ground: PAPER, fill: 0.8, tighten: true },
  { file: `${OUT}/pwa-192x192.png`, w: 192, part: 'emblem', ground: PAPER, fill: 0.78, tighten: true },
  { file: `${OUT}/pwa-512x512.png`, w: 512, part: 'emblem', ground: PAPER, fill: 0.78, tighten: true },
  // A maskable icon may be cropped to a circle, so the mark stays well inside.
  { file: `${OUT}/pwa-maskable-512x512.png`, w: 512, part: 'emblem', ground: PAPER, fill: 0.56, tighten: true },
]

const hasAndroid = fs.existsSync(ANDROID_RES)
if (hasAndroid) {
  for (const [density, size] of LAUNCHER) {
    const dir = `${ANDROID_RES}/mipmap-${density}`
    // The legacy icons are shaped by us: on Android 6 and 7 nothing masks them.
    specs.push(
      { file: `${dir}/ic_launcher.png`, w: size, part: 'emblem', ground: PAPER, shape: 'rounded', fill: 0.72, tighten: true },
      { file: `${dir}/ic_launcher_round.png`, w: size, part: 'emblem', ground: PAPER, shape: 'circle', fill: 0.62, tighten: true },
    )
  }
  for (const [density, size] of FOREGROUND) {
    specs.push({
      file: `${ANDROID_RES}/mipmap-${density}/ic_launcher_foreground.png`,
      w: size,
      part: 'emblem',
      fill: 0.56,
      tighten: true,
    })
  }
  for (const [dir, w, h] of SPLASH) {
    // Tightening is on here too: a tablet splash stretches the lockup to 6×,
    // which is soft to look at and, being all gradient, needlessly heavy to
    // store. The strength scales with the enlargement, so the small splashes
    // that draw the lockup near its true size are left exactly as authored.
    specs.push({ file: `${ANDROID_RES}/${dir}/splash.png`, w, h, part: 'lockup', ground: PAPER, fill: 0.55, tighten: true })
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.setDefaultTimeout(60000)

const srcB64 = fs.readFileSync(SRC).toString('base64')

const result = await page.evaluate(async (data64, jobs) => {
  /* ── the artwork, as pixels ────────────────────────────────────────────── */
  const img = new Image()
  img.src = 'data:image/png;base64,' + data64
  await img.decode()
  const SW = img.width
  const SH = img.height
  const sheet = document.createElement('canvas')
  sheet.width = SW
  sheet.height = SH
  const sctx = sheet.getContext('2d', { willReadFrequently: true })
  sctx.drawImage(img, 0, 0)
  const px = sctx.getImageData(0, 0, SW, SH).data

  const inked = (x, y) => {
    const i = (y * SW + x) * 4
    return px[i] < 244 || px[i + 1] < 244 || px[i + 2] < 244
  }

  /* ── every connected shape, so the split is measured ───────────────────── */
  const seen = new Uint8Array(SW * SH)
  const shapes = []
  const stack = []
  for (let seed = 0; seed < SW * SH; seed++) {
    const seedX = seed % SW
    const seedY = (seed - seedX) / SW
    if (seen[seed] || !inked(seedX, seedY)) continue
    let x0 = SW
    let y0 = SH
    let x1 = -1
    let y1 = -1
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1
    while (stack.length) {
      const p = stack.pop()
      const x = p % SW
      const y = (p - x) / SW
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (x > 0 && !seen[p - 1] && inked(x - 1, y)) (seen[p - 1] = 1), stack.push(p - 1)
      if (x < SW - 1 && !seen[p + 1] && inked(x + 1, y)) (seen[p + 1] = 1), stack.push(p + 1)
      if (y > 0 && !seen[p - SW] && inked(x, y - 1)) (seen[p - SW] = 1), stack.push(p - SW)
      if (y < SH - 1 && !seen[p + SW] && inked(x, y + 1)) (seen[p + SW] = 1), stack.push(p + SW)
    }
    shapes.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 })
  }

  const union = (list) => {
    const b = {
      x0: Math.min(...list.map((s) => s.x0)),
      y0: Math.min(...list.map((s) => s.y0)),
      x1: Math.max(...list.map((s) => s.x1)),
      y1: Math.max(...list.map((s) => s.y1)),
    }
    b.w = b.x1 - b.x0 + 1
    b.h = b.y1 - b.y0 + 1
    return b
  }

  const TAGLINE = 10 // measured: the tagline's shapes are 6 px, the letters 18–38 px
  const tallest = shapes.reduce((a, b) => (b.h > a.h ? b : a))
  const boxes = {
    emblem: { x0: tallest.x0, y0: tallest.y0, x1: tallest.x1, y1: tallest.y1, w: tallest.w, h: tallest.h },
    lockup: union(shapes.filter((s) => s.h >= TAGLINE)),
    full: union(shapes),
  }

  /* ── the artwork's own palette ─────────────────────────────────────────────
     The flat colours the mark is built from, read off the source rather than
     assumed, so resampled edges can be drawn back toward them. */
  const palette = (() => {
    const counts = new Map()
    for (let i = 0; i < px.length; i += 4) {
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key]) => [(key >> 16) & 255, (key >> 8) & 255, key & 255])
  })()

  /* ── Catmull-Rom resampling ────────────────────────────────────────────────
     The emblem is only 52×61 px in the artwork and a launcher wants far more,
     so the upscale is ours to do well: Chrome's own canvas filter is bilinear,
     which would leave a logo this small visibly soft at 4× to 8×. */
  const kernel = (t) => {
    const x = Math.abs(t)
    if (x <= 1) return 1.5 * x * x * x - 2.5 * x * x + 1
    if (x < 2) return -0.5 * x * x * x + 2.5 * x * x - 4 * x + 2
    return 0
  }

  const resample = (b, tw, th, tighten) => {
    // Blowing a 52 px mark up to a launcher's 400 px stretches its edge ramp to
    // as many pixels as the factor, which is what reads as softness. Where a
    // part is being enlarged, the ramp is drawn back toward the nearest flat
    // ink — by an amount that scales with the enlargement, so an asset cut near
    // its true size keeps the artwork's own anti-aliasing untouched.
    const strength = tighten ? Math.min(0.8, Math.max(0, 1 - 1.6 / (tw / b.w))) : 0

    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(tw, th)
    const out = image.data

    // Weights along each axis, so a 4×4 tap costs two lookups rather than four.
    const axis = (target, span, from) => {
      const list = []
      for (let d = 0; d < target; d++) {
        const at = (d + 0.5) * (span / target) - 0.5
        const base = Math.floor(at)
        const w = []
        const src = []
        for (let m = 0; m < 4; m++) {
          w.push(kernel(at - (base - 1 + m)))
          src.push(from + Math.min(span - 1, Math.max(0, base - 1 + m)))
        }
        list.push({ w, src })
      }
      return list
    }
    const cols = axis(tw, b.w, b.x0)
    const rows = axis(th, b.h, b.y0)

    // Catmull-Rom overshoots a hard edge — on this artwork it lights a pale
    // fringe around the black figure where it meets the dome. So each channel
    // is held inside the range its own taps spanned: the interpolation still
    // sharpens the step, but it can no longer invent a colour that is not there.
    const clamp = (value, lo, hi) => (value < lo ? lo : value > hi ? hi : value)

    for (let dy = 0; dy < th; dy++) {
      const { w: wy, src: sy } = rows[dy]
      for (let dx = 0; dx < tw; dx++) {
        const { w: wx, src: sx } = cols[dx]
        let r = 0
        let g = 0
        let bl = 0
        let sum = 0
        let rLo = 255
        let rHi = 0
        let gLo = 255
        let gHi = 0
        let bLo = 255
        let bHi = 0
        for (let j = 0; j < 4; j++) {
          const wj = wy[j]
          if (!wj) continue
          const row = sy[j] * SW
          for (let i = 0; i < 4; i++) {
            const weight = wx[i] * wj
            if (!weight) continue
            const p = (row + sx[i]) * 4
            const cr = px[p]
            const cg = px[p + 1]
            const cb = px[p + 2]
            r += cr * weight
            g += cg * weight
            bl += cb * weight
            sum += weight
            if (cr < rLo) rLo = cr
            if (cr > rHi) rHi = cr
            if (cg < gLo) gLo = cg
            if (cg > gHi) gHi = cg
            if (cb < bLo) bLo = cb
            if (cb > bHi) bHi = cb
          }
        }
        const total = sum || 1
        let cr = clamp(r / total, rLo, rHi)
        let cg = clamp(g / total, gLo, gHi)
        let cb = clamp(bl / total, bLo, bHi)
        if (strength) {
          let best = Infinity
          let to = palette[0]
          for (const ink of palette) {
            const dr = cr - ink[0]
            const dg = cg - ink[1]
            const db = cb - ink[2]
            const d = dr * dr + dg * dg + db * db
            if (d < best) {
              best = d
              to = ink
            }
          }
          cr += strength * (to[0] - cr)
          cg += strength * (to[1] - cg)
          cb += strength * (to[2] - cb)
        }
        const o = (dy * tw + dx) * 4
        out[o] = cr
        out[o + 1] = cg
        out[o + 2] = cb
        out[o + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  /* ── each asset ─────────────────────────────────────────────────────────── */
  const assets = []
  for (const spec of jobs) {
    const b = boxes[spec.part]
    const w = spec.native ? b.w : spec.w
    const h = spec.native ? b.h : (spec.h ?? spec.w)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')

    if (spec.ground) {
      ctx.fillStyle = spec.ground
      ctx.beginPath()
      if (spec.shape === 'circle') ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2)
      else if (spec.shape === 'rounded') ctx.roundRect(0, 0, w, h, Math.round(Math.min(w, h) * 0.22))
      else ctx.rect(0, 0, w, h)
      ctx.fill()
    }

    if (!spec.native) {
      const scale = Math.min((spec.fill * w) / b.w, (spec.fill * h) / b.h)
      const tw = Math.max(1, Math.round(b.w * scale))
      const th = Math.max(1, Math.round(b.h * scale))
      const bitmap = resample(b, tw, th, spec.tighten)
      ctx.drawImage(bitmap, Math.round((w - tw) / 2), Math.round((h - th) / 2))
    } else {
      // Kept at the artwork's own size, so the interface draws true pixels.
      ctx.drawImage(resample(b, b.w, b.h, false), 0, 0)
    }

    assets.push({ file: spec.file, dataUrl: canvas.toDataURL('image/png') })
  }

  return { size: [SW, SH], shapes: shapes.length, boxes, assets }
}, srcB64, specs)

await browser.close()

for (const { file, dataUrl } of result.assets) {
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`  ${file}`)
}

if (hasAndroid) {
  fs.writeFileSync(
    `${ANDROID_RES}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PAPER.toUpperCase()}</color>\n</resources>\n`,
  )
  console.log(`  ${ANDROID_RES}/values/ic_launcher_background.xml → ${PAPER.toUpperCase()}`)
}

console.log('')
console.log(`source ${result.size[0]}×${result.size[1]} — ${result.shapes} ink shapes`)
for (const [name, b] of Object.entries(result.boxes)) {
  console.log(`  ${name.padEnd(7)} x${b.x0}–${b.x1}  y${b.y0}–${b.y1}  (${b.w}×${b.h})`)
}
console.log(`\n${result.assets.length} assets written`)
