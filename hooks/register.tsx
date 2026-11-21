// Котодвор: a quiet cat yard in a side pane. Feed the bowl; cats come and go on their own.
import type { EngineInterface, Register, Timer } from 'claude-code'

import { BOWL_MS, bowlLevel, drawables, leave, presentCats, spawn, step } from './sim'
import type { Cat } from './sim'
import { ROWS, W, cells, compose } from './yard'

type Dollar = EngineInterface

const PANE = 'kotodvor'
const TITLE = 'Котодвор'
const FRAME_MS = 333 // ~3 fps
const IDLE_POLL_MS = 5000 // while the pane is open but hidden
const PRESENCE_MS = 60e3

// Module memory: rebuilt from $.store and the clock after a reload, nothing here must persist.
let fills: number[] = []
let loaded = false
let yard: Cat[] = []
let lastPresenceAt = 0
let lastTickAt = 0
let frameNo = 0
let loop: Timer | undefined
let loopMs = 0
let busy = false
let denies = 0
let lastPanesCheck = 0

async function load($: Dollar) {
  if (loaded) return
  const stored = await $.store.get('fills')
  fills = Array.isArray(stored) ? stored.filter((n): n is number => typeof n === 'number') : []
  loaded = true
}

function refreshPresence(now: number, fromEdge: boolean) {
  const level = bowlLevel(fills, now)
  const want = presentCats(fills, now)
  for (const c of yard) if (!want.includes(c.cat)) leave(c)
  for (const cat of want) if (!yard.some(c => c.cat === cat)) yard.push(spawn(cat, now, fromEdge, level, yard))
  lastPresenceAt = now
}

/** After a long gap the yard is laid out afresh, as it stands now. */
function catchUp(now: number) {
  if (lastTickAt && now - lastTickAt <= PRESENCE_MS) return
  yard = []
  refreshPresence(now, false)
  lastTickAt = now
}

function frame(now: number): string {
  return cells(compose(drawables(yard, now, bowlLevel(fills, now), frameNo)))
}

function run($: Dollar, ms: number) {
  if (loop && loopMs === ms) return
  loop?.cancel()
  loopMs = ms
  loop = $.clock.every(ms, () => { void tick($) })
}

function stop() {
  loop?.cancel()
  loop = undefined
  loopMs = 0
}

async function tick($: Dollar) {
  if (busy) return
  busy = true
  try {
    const now = await $.clock.now()
    if (now - lastPanesCheck > 3000 || loopMs === IDLE_POLL_MS) {
      lastPanesCheck = now
      const pane = (await $.ui.panes()).find(p => p.id === PANE)
      if (!pane) return stop()
      if (!pane.isShown || !pane.isPlaced) return run($, IDLE_POLL_MS)
      if (loopMs !== FRAME_MS) run($, FRAME_MS)
    }
    catchUp(now)
    if (now - lastPresenceAt >= PRESENCE_MS) refreshPresence(now, true)
    yard = step(yard, now, Math.min(now - lastTickAt, 1000), bowlLevel(fills, now))
    lastTickAt = now
    frameNo++
    const shown = await $.ui.blit({ requestId: PANE, key: 'yard', cells: frame(now) })
    // A fresh pane may not be mounted for the first frames; give it a couple of seconds.
    denies = shown.deny ? denies + 1 : 0
    if (denies > 6) run($, IDLE_POLL_MS)
  } finally {
    busy = false
  }
}

async function feed($: Dollar) {
  const now = await $.clock.now()
  fills = [...fills.filter(f => now - f < BOWL_MS * 6), now].slice(-20)
  await $.store.set('fills', fills)
  refreshPresence(now, true)
}

const open = ($: Dollar) => $.ui.open({ id: PANE, title: TITLE, columns: W, rows: ROWS + 2 })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'kotodvor', description: 'Открыть котодвор: двор с котами в боковой панели' })
    await load($)
    void open($)
    return next(e)
  })

  on('command.run', { command: 'kotodvor' }, async $ => {
    await load($)
    await open($)
    return { text: 'Котодвор открыт.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) stop()
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Котодвор пока рисуется только в терминале.</Text>
    }
    const { Box, Button, Raster } = $.ui.resolve(e)
    await load($)
    const now = await $.clock.now()
    catchUp(now)
    run($, FRAME_MS)
    return (
      <Box flexDirection="column">
        <Raster key="yard" columns={W} rows={ROWS} cells={frame(now)} />
        <Box>
          <Button key="feed" label="Насыпать корм" onPress={() => feed($)} />
        </Box>
      </Box>
    )
  })
}
