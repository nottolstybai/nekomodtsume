// The yard as pixels: background, bowl, sprites, and packing into Raster cells.
import { COATS, SPRITES } from './art'
import type { Coat, Pose } from './art'

export const W = 56
export const H = 44
export const ROWS = H / 2
export const BOWL_X = 2
export const BOWL_Y = H - 10 // top row of the bowl
const NONE = -1

const rgb = (hex: string): number => parseInt(hex.slice(1), 16)

// ---------- background (built once) ----------
let background: Int32Array | undefined

function buildBackground(): Int32Array {
  const g = new Int32Array(W * H)
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && x < W && y >= 0 && y < H) g[y * W + x] = rgb(c)
  }
  for (let y = 0; y < 17; y++) for (let x = 0; x < W; x++) put(x, y, y < 6 ? '#a9dcf2' : '#bfe6f5')
  const cloud: Array<[number, number, number]> = [[29, 3, 3], [28, 4, 6], [27, 5, 8], [8, 2, 2], [7, 3, 4]]
  for (const [x0, y, n] of cloud) for (let x = x0; x < x0 + n; x++) put(x, y, '#ffffff')
  for (let px = 0; px < W; px += 5) {
    for (let y = 8; y < 18; y++) for (let x = px; x < px + 4; x++) {
      put(x, y, x === px || x === px + 3 ? '#b98a52' : '#ddb47c')
    }
    put(px, 8, '#bfe6f5'); put(px + 3, 8, '#bfe6f5'); put(px + 1, 7, '#ddb47c'); put(px + 2, 7, '#ddb47c')
  }
  for (const ry of [10, 15]) for (let x = 0; x < W; x++) put(x, ry, '#a67845')
  for (let y = 17; y < H; y++) for (let x = 0; x < W; x++) put(x, y, '#9fd27c')
  for (let x = 0; x < W; x++) put(x, 17, '#86c063')
  const tufts: Array<[number, number]> = [[3, 21], [11, 19], [19, 23], [27, 20], [35, 22], [44, 19], [51, 24], [7, 27], [31, 28], [47, 30], [15, 33], [37, 35], [53, 38], [2, 42], [23, 41], [41, 42]]
  for (const [x, y] of tufts) { put(x, y, '#82bd60'); put(x + 1, y - 1, '#82bd60'); put(x + 2, y, '#82bd60') }
  const dots: Array<[number, number]> = [[9, 24], [33, 25], [21, 30], [5, 34], [49, 27], [29, 39]]
  for (const [x, y] of dots) put(x, y, '#c4ea9e')
  return g
}

// ---------- sprites, converted per coat and facing (cached) ----------
type Bitmap = { w: number; h: number; px: Int32Array }
const cache = new Map<string, Bitmap>()

export function bitmap(pose: Pose, coat: Coat, flip: boolean, blink = false): Bitmap {
  const id = `${pose}/${coat}/${flip ? 1 : 0}/${blink ? 1 : 0}`
  let b = cache.get(id)
  if (b) return b
  const rows = SPRITES[pose], pal = COATS[coat]
  const w = (rows[0] ?? '').length, h = rows.length, px = new Int32Array(w * h).fill(NONE)
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      let ch = row[x]
      if (ch === undefined || ch === '.') continue
      if (blink && ch === 'E') ch = 'C'
      px[y * w + (flip ? w - 1 - x : x)] = rgb(pal[ch] ?? '#ff00ff')
    }
  })
  b = { w, h, px }
  cache.set(id, b)
  return b
}

export const spriteWidth = (pose: Pose) => (SPRITES[pose][0] ?? '').length
export const spriteHeight = (pose: Pose) => SPRITES[pose].length

// ---------- the frame ----------
export type Drawable =
  | { kind: 'cat'; pose: Pose; coat: Coat; flip: boolean; blink: boolean; x: number; bottom: number }
  | { kind: 'bowl'; level: number }
  | { kind: 'z'; x: number; y: number }

const BOWL_ROWS = {
  full: ['..kkkkk..', '.kKkkKkk.', 'ORRRRRRRO', 'OBBBBBBBO', '.OBBBBBO.', '..OOOOO..'],
  half: ['.........', '..kKkkk..', 'ORRRRRRRO', 'OBBBBBBBO', '.OBBBBBO.', '..OOOOO..'],
  empty: ['.........', '.........', 'ORRRRRRRO', 'OBBBBBBBO', '.OBBBBBO.', '..OOOOO..'],
}
const BOWL_PAL: Record<string, string> = { O: '#2f4f7a', B: '#5b8fd1', R: '#9cc2ee', k: '#b06a33', K: '#7f4a20' }
const Z = ['OOO', '.O.', 'OOO']

export function compose(items: Drawable[]): Int32Array {
  background ??= buildBackground()
  const buf = background.slice()
  const put = (x: number, y: number, c: number) => {
    if (c !== NONE && x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = c
  }
  for (const it of items) {
    if (it.kind === 'cat') {
      const b = bitmap(it.pose, it.coat, it.flip, it.blink)
      const x0 = Math.round(it.x), y0 = Math.round(it.bottom) - b.h + 1
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) put(x0 + x, y0 + y, b.px[y * b.w + x] ?? NONE)
    } else if (it.kind === 'bowl') {
      const rows = it.level > 0.5 ? BOWL_ROWS.full : it.level > 0 ? BOWL_ROWS.half : BOWL_ROWS.empty
      rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') put(BOWL_X + x, BOWL_Y + y, rgb(BOWL_PAL[ch] ?? '#ff00ff')) }))
    } else {
      Z.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') put(Math.round(it.x) + x, Math.round(it.y) + y, rgb('#7d8fb0')) }))
    }
  }
  return buf
}

// ---------- packing: two pixels per cell with the upper half block ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4))
    out += i + 1 < bytes.length ? B64.charAt(((b & 15) << 2) | (c >> 6)) : '='
    out += i + 2 < bytes.length ? B64.charAt(c & 63) : '='
  }
  return out
}

export function cells(buf: Int32Array): string {
  const words = new Uint32Array(W * ROWS * 3)
  let i = 0
  for (let r = 0; r < ROWS; r++) for (let x = 0; x < W; x++) {
    words[i++] = 0x2580 // ▀
    words[i++] = (buf[(2 * r) * W + x] ?? 0) >>> 0
    words[i++] = (buf[(2 * r + 1) * W + x] ?? 0) >>> 0
  }
  return base64(new Uint8Array(words.buffer))
}
