// Who is in the yard (a pure function of time and feedings) and what each cat does.
import type { Coat, Pose } from './art'
import { BOWL_X, H, W, spriteHeight, spriteWidth } from './yard'
import type { Drawable } from './yard'

export const CATS: readonly Coat[] = ['calico', 'ginger', 'gray', 'black', 'white']
export const BOWL_MS = 4 * 3600e3
const SLOT = 10 * 60e3
const MIN_VISIT = 20 * 60e3
const MAX_VISIT = 60 * 60e3
const ARRIVE_CHANCE = 0.12
const MAX_IN_YARD = 3

// ---------- deterministic noise ----------
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(c + 0x27d4eb2f, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// ---------- the bowl ----------
export function bowlLevel(fills: readonly number[], t: number): number {
  let last = -Infinity
  for (const f of fills) if (f <= t && f > last) last = f
  return last === -Infinity ? 0 : Math.max(0, 1 - (t - last) / BOWL_MS)
}

// ---------- presence ----------
type Visit = { cat: number; start: number; end: number }

export function presentCats(fills: readonly number[], t: number): number[] {
  const visits: Visit[] = []
  const first = Math.floor((t - MAX_VISIT) / SLOT), last = Math.floor(t / SLOT)
  for (let slot = first; slot <= last; slot++) {
    for (let cat = 0; cat < CATS.length; cat++) {
      if (hash(cat, slot, 1) >= ARRIVE_CHANCE) continue
      const start = slot * SLOT + hash(cat, slot, 2) * SLOT
      if (bowlLevel(fills, start) <= 0) continue
      const end = start + MIN_VISIT + hash(cat, slot, 3) * (MAX_VISIT - MIN_VISIT)
      if (start <= t && t < end) visits.push({ cat, start, end })
    }
  }
  // Someone always comes soon after a feeding.
  for (const f of fills) {
    const s = Math.floor(f / 1000)
    const start = f + 30e3 + hash(s, 0, 5) * 90e3
    const end = start + 25 * 60e3 + hash(s, 0, 6) * 20 * 60e3
    if (start <= t && t < end) visits.push({ cat: Math.floor(hash(s, 0, 4) * CATS.length), start, end })
  }
  visits.sort((a, b) => a.start - b.start)
  const seen: number[] = []
  for (const v of visits) if (!seen.includes(v.cat) && seen.length < MAX_IN_YARD) seen.push(v.cat)
  return seen
}

// ---------- behaviour: a small state machine per cat, advanced while drawn ----------
type Act = 'walk' | 'sit' | 'sleep' | 'eat' | 'play' | 'leave'
type Then = 'sit' | 'sleep' | 'eat' | 'play' | 'gone'

export type Cat = {
  cat: number
  x: number
  bottom: number
  face: 1 | -1
  act: Act
  until: number
  tx: number
  ty: number
  then: Then
  partner?: number
  ateAt: number
}

const MIN_BOTTOM = 31, MAX_BOTTOM = H - 1
const SPEED = 5 / 1000 // pixels per ms
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!
// Behind the bowl, so the bowl is drawn over the lowered head.
const EAT_SPOT = { x: BOWL_X + 3, bottom: H - 6 }
const someoneEats = (yard: readonly Cat[], me?: Cat) =>
  yard.some(o => o !== me && (o.act === 'eat' || (o.act === 'walk' && o.then === 'eat')))

/** A spot away from the bowl and from the other cats (the best of a few tries). */
function freeSpot(yard: readonly Cat[], me?: Cat): { x: number; bottom: number } {
  let best = { x: 0, bottom: 0 }, bestGap = -1
  for (let i = 0; i < 8; i++) {
    const s = { x: rnd(14, W - 21), bottom: rnd(MIN_BOTTOM, MAX_BOTTOM) }
    let gap = Infinity
    for (const o of yard) {
      if (o === me) continue
      const ox = o.act === 'walk' ? o.tx : o.x, oy = o.act === 'walk' ? o.ty : o.bottom
      gap = Math.min(gap, Math.abs(ox - s.x) + 2 * Math.abs(oy - s.bottom))
    }
    if (gap > bestGap) { best = s; bestGap = gap }
  }
  return best
}

const crowded = (c: Cat, yard: readonly Cat[]) =>
  yard.some(o => o !== c && o.act !== 'walk' && Math.abs(o.x - c.x) < 16 && Math.abs(o.bottom - c.bottom) < 6)

function walkTo(c: Cat, x: number, bottom: number, then: Then) {
  c.act = 'walk'; c.tx = x; c.ty = bottom; c.then = then
  c.face = x >= c.x ? 1 : -1
}

export function spawn(cat: number, now: number, fromEdge: boolean, level: number, yard: readonly Cat[]): Cat {
  const canEat = level > 0 && !someoneEats(yard)
  const spot = freeSpot(yard)
  const c: Cat = { cat, x: spot.x, bottom: spot.bottom, face: 1, act: 'sit', until: now + rnd(5e3, 20e3), tx: 0, ty: 0, then: 'sit', ateAt: 0 }
  if (fromEdge) {
    const left = Math.random() < 0.5
    c.x = left ? -spriteWidth('walkA') : W
    walkTo(c, spot.x, spot.bottom, 'sit')
    if (canEat && Math.random() < 0.6) walkTo(c, EAT_SPOT.x, EAT_SPOT.bottom, 'eat')
  } else {
    c.act = pick(canEat ? ['sit', 'sleep', 'eat'] as const : ['sit', 'sleep'] as const)
    if (c.act === 'eat') { c.x = EAT_SPOT.x; c.bottom = EAT_SPOT.bottom; c.face = -1; c.ateAt = now }
    c.face = c.act === 'eat' ? -1 : pick([1, -1] as const)
    c.until = now + rnd(8e3, 40e3)
  }
  return c
}

export function leave(c: Cat) {
  if (c.act === 'leave' || (c.act === 'walk' && c.then === 'gone')) return
  const toLeft = c.x + 10 < W / 2
  walkTo(c, toLeft ? -spriteWidth('walkA') - 2 : W + 2, c.bottom, 'gone')
}

function settle(c: Cat, now: number, yard: Cat[]) {
  switch (c.then) {
    case 'eat': c.act = 'eat'; c.face = -1; c.ateAt = now; c.until = now + rnd(8e3, 16e3); break
    case 'sleep': c.act = 'sleep'; c.until = now + rnd(40e3, 120e3); break
    case 'play': {
      const p = yard.find(o => o.cat === c.partner)
      if (p && (p.act === 'sit' || p.act === 'play')) {
        const until = now + rnd(6e3, 10e3)
        c.act = 'play'; c.until = until
        p.act = 'play'; p.until = until; p.partner = c.cat
        c.face = p.x > c.x ? 1 : -1; p.face = c.x > p.x ? 1 : -1
      } else if (p && p.act === 'sleep') {
        c.act = 'sleep'; c.until = now + rnd(40e3, 120e3) // nap next to a sleeping friend
      } else {
        c.act = 'sit'; c.until = now + rnd(6e3, 20e3)
      }
      break
    }
    default: c.act = 'sit'; c.until = now + rnd(8e3, 30e3)
  }
}

function choose(c: Cat, now: number, level: number, yard: Cat[]) {
  const options: Array<[number, () => void]> = []
  if (level > 0 && now - c.ateAt > 90e3 && !someoneEats(yard, c)) options.push([3, () => walkTo(c, EAT_SPOT.x, EAT_SPOT.bottom, 'eat')])
  const away = (then: Then) => { const s = freeSpot(yard, c); walkTo(c, s.x, s.bottom, then) }
  options.push([3, () => {
    if (crowded(c, yard)) return away('sit')
    c.act = 'sit'; c.until = now + rnd(8e3, 30e3); if (Math.random() < 0.3) c.face = c.face === 1 ? -1 : 1
  }])
  options.push([2, () => {
    if (crowded(c, yard)) return away('sleep')
    c.act = 'sleep'; c.until = now + rnd(40e3, 120e3)
  }])
  options.push([3, () => away(Math.random() < 0.3 ? 'sleep' : 'sit')])
  const friend = yard.find(o => o !== c && (o.act === 'sit' || o.act === 'sleep'))
  if (friend) {
    options.push([2, () => {
      const side = friend.x > W / 2 ? -1 : 1
      c.partner = friend.cat
      walkTo(c, friend.x + side * (spriteWidth('sit') + 1), friend.bottom, 'play')
    }])
  }
  let total = 0
  for (const [w] of options) total += w
  let r = Math.random() * total
  for (const [w, act] of options) { if ((r -= w) <= 0) { act(); return } }
  options[0]?.[1]()
}

/** Advances every cat by `dt` ms; returns the cats still in the yard. */
export function step(yard: Cat[], now: number, dt: number, level: number): Cat[] {
  for (const c of yard) {
    if (c.act === 'walk') {
      const dx = c.tx - c.x, dy = c.ty - c.bottom, dist = Math.hypot(dx, dy)
      const move = SPEED * dt
      if (dist <= move) {
        c.x = c.tx; c.bottom = c.ty
        if (c.then === 'gone') c.act = 'leave'
        else settle(c, now, yard)
      } else {
        c.x += (dx / dist) * move; c.bottom += (dy / dist) * move
      }
    } else if (c.act !== 'leave' && now >= c.until) {
      if (c.act === 'eat') {
        const s = freeSpot(yard, c) // done eating: wander off and make room
        walkTo(c, s.x, s.bottom, 'sit')
      } else choose(c, now, level, yard)
    }
  }
  return yard.filter(c => c.act !== 'leave')
}

// ---------- drawing the cats ----------
const NATIVE_FACE: Record<Pose, 1 | -1> = { walkA: 1, walkB: 1, eat: 1, sleep: -1, sit: -1 }

export function drawables(yard: readonly Cat[], now: number, level: number, frame: number): Drawable[] {
  const out: Array<Drawable & { depth: number }> = [{ kind: 'bowl', level, depth: H - 5 }]
  for (const c of yard) {
    const coat = CATS[c.cat] ?? 'white'
    let pose: Pose = 'sit', bottom = c.bottom
    if (c.act === 'walk') pose = frame % 2 ? 'walkB' : 'walkA'
    else if (c.act === 'sleep') pose = 'sleep'
    else if (c.act === 'eat') pose = 'eat'
    else if (c.act === 'play') bottom -= (frame + c.cat) % 2 ? 2 : 0
    const blink = pose === 'sit' && (now + c.cat * 1777) % 4200 < 300
    out.push({ kind: 'cat', pose, coat, flip: c.face !== NATIVE_FACE[pose], blink, x: c.x, bottom, depth: c.bottom })
    if (pose === 'sleep') {
      const phase = ((now + c.cat * 900) % 3000) / 3000
      const headX = c.face === -1 ? c.x + 2 : c.x + spriteWidth('sleep') - 5
      out.push({ kind: 'z', x: headX + phase * 3, y: c.bottom - spriteHeight('sleep') - 3 - phase * 4, depth: c.bottom + 0.5 })
    }
  }
  return out.sort((a, b) => a.depth - b.depth)
}
