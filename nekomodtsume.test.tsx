import { expect, mock, test } from 'claude-code/testing'

import { BOWL_MS, bowlLevel, presentCats } from './hooks/sim'

const PANE = {
  plugin: 'nekomodtsume',
  component: 'Pane',
  requestId: 'nekomodtsume',
  props: {
    title: 'Nekomodtsume',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  },
} as const

const T0 = Date.UTC(2026, 10, 22, 9, 0, 0)

test('the bowl empties over four hours', () => {
  expect(bowlLevel([], T0)).toBe(0)
  expect(bowlLevel([T0], T0)).toBe(1)
  expect(bowlLevel([T0], T0 + BOWL_MS / 2)).toBe(0.5)
  expect(bowlLevel([T0], T0 + BOWL_MS + 1)).toBe(0)
})

test('nobody comes to an empty bowl, someone comes soon after feeding, never more than three', () => {
  expect(presentCats([], T0)).toEqual([])
  expect(presentCats([T0], T0 + 3 * 60e3).length).toBeGreaterThan(0)
  for (let t = T0; t < T0 + 6 * 3600e3; t += 5 * 60e3) {
    expect(presentCats([T0, T0 + 2 * 3600e3], t).length).toBeLessThanOrEqual(3)
  }
  // Four hours after the bowl ran dry, the yard is empty again.
  expect(presentCats([T0], T0 + BOWL_MS + 2 * 3600e3)).toEqual([])
})

test('the pane draws the yard and the feed button fills the bowl', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => { stored[e.key] = e.value; return { value: undefined } })
  on('ui.blit', () => ({ value: {} }))
  on('ui.panes', () => ({ value: [{ id: 'nekomodtsume', title: 'Nekomodtsume', isShown: true, isFocused: false, isPlaced: true }] }))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const yard = await ui.find({ type: 'Raster', key: 'yard' })
  expect(yard).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'feed' })).toBeDefined()

  await ui.press({ key: 'feed' })
  expect(stored.fills).toEqual([T0])

  await clock.advance(3000) // a few frames go by without trouble
  await ui.unmount()
})

test('other surfaces get a short note instead of a broken drawing', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on, {})
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/терминале/)
  await ui.unmount()
})
