// @vitest-environment happy-dom
import type { IframePane } from '../src'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIframePanes } from '../src'

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = []
  observed: Element[] = []
  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }

  observe(target: Element): void {
    this.observed.push(target)
  }

  unobserve(target: Element): void {
    this.observed = this.observed.filter(el => el !== target)
  }

  disconnect(): void {
    this.observed = []
  }

  trigger(targets: Element[]): void {
    this.callback(
      targets.map(target => ({ target } as ResizeObserverEntry)),
      this as unknown as ResizeObserver,
    )
  }
}

function mockRect(el: Element, rect: Partial<DOMRect>): void {
  el.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect)
}

function createTarget(rect: Partial<DOMRect> = { left: 10, top: 20, width: 300, height: 200 }): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  mockRect(el, rect)
  return el
}

beforeAll(() => {
  // happy-dom reports the (intentionally) disabled iframe page loading as a
  // console error on the original stderr, bypassing vitest's console
  // interception — swallow just that noise
  const originalWrite = process.stderr.write.bind(process.stderr)
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk, ...args) => {
    if (String(chunk).includes('Iframe page loading is disabled'))
      return true
    return originalWrite(chunk, ...args as [])
  })
})

beforeEach(() => {
  document.body.innerHTML = ''
  ResizeObserverStub.instances = []
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

describe('createIframePanes', () => {
  it('creates panes lazily in a default container', () => {
    const panes = createIframePanes()
    expect(panes.container).toBeUndefined()

    const pane = panes.ensure('a', { src: 'https://example.com/' })
    const container = panes.container!
    expect(container).toBeTruthy()
    expect(container.parentElement).toBe(document.body)
    expect(container.style.position).toBe('fixed')
    expect(container.style.pointerEvents).toBe('none')

    expect(pane.iframe.parentElement).toBe(container)
    expect(pane.iframe.getAttribute('data-iframe-pane')).toBe('a')
    expect(pane.iframe.src).toBe('https://example.com/')
    // hidden by default
    expect(pane.isVisible).toBe(false)
    expect(pane.iframe.style.opacity).toBe('0.001')
    expect(pane.iframe.style.pointerEvents).toBe('none')
  })

  it('returns the same pane for the same id, preserving src', () => {
    const panes = createIframePanes()
    const a1 = panes.ensure('a', { src: 'https://example.com/one' })
    const a2 = panes.ensure('a', { src: 'https://example.com/two' })
    expect(a2).toBe(a1)
    expect(a1.iframe.src).toBe('https://example.com/one')
    expect(panes.list()).toEqual([a1])
  })

  it('applies attrs, styleDefault, and onCreated', () => {
    const panes = createIframePanes()
    const onCreated = vi.fn()
    const pane = panes.ensure('a', {
      attrs: { allow: 'clipboard-read; clipboard-write', title: 'Test' },
      styleDefault: { colorScheme: 'dark' },
      onCreated,
    })
    expect(pane.iframe.getAttribute('allow')).toBe('clipboard-read; clipboard-write')
    expect(pane.iframe.getAttribute('title')).toBe('Test')
    expect(pane.iframe.style.colorScheme).toBe('dark')
    expect(onCreated).toHaveBeenCalledWith(pane.iframe)
  })

  it('lists, gets, and has panes', () => {
    const panes = createIframePanes()
    const a = panes.ensure('a')
    const b = panes.ensure('b')
    expect(panes.list()).toEqual([a, b])
    expect(panes.get('a')).toBe(a)
    expect(panes.get('missing')).toBeUndefined()
    expect(panes.has('b')).toBe(true)
    expect(panes.has('missing')).toBe(false)
  })
})

describe('mount / unmount', () => {
  it('mounts onto a target, syncing the box', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const target = createTarget({ left: 10, top: 20, width: 300, height: 200 })

    pane.mount(target)
    expect(pane.isMounted).toBe(true)
    expect(pane.isVisible).toBe(true)
    expect(pane.target).toBe(target)
    expect(pane.iframe.style.opacity).toBe('1')
    expect(pane.iframe.style.pointerEvents).toBe('auto')
    expect(pane.iframe.style.left).toBe('10px')
    expect(pane.iframe.style.top).toBe('20px')
    expect(pane.iframe.style.width).toBe('300px')
    expect(pane.iframe.style.height).toBe('200px')
  })

  it('offsets the box relative to a custom container', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    mockRect(container, { left: 5, top: 15 })

    const panes = createIframePanes({ container })
    const pane = panes.ensure('a')
    // static custom containers are made positioned
    expect(container.style.position).toBe('relative')
    expect(pane.iframe.parentElement).toBe(container)

    pane.mount(createTarget({ left: 10, top: 20, width: 300, height: 200 }))
    expect(pane.iframe.style.left).toBe('5px')
    expect(pane.iframe.style.top).toBe('5px')
  })

  it('unmounts: hides but keeps the iframe alive', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const target = createTarget()

    pane.mount(target)
    pane.unmount()
    expect(pane.isMounted).toBe(false)
    expect(pane.isVisible).toBe(false)
    expect(pane.target).toBeNull()
    expect(pane.iframe.style.opacity).toBe('0.001')
    expect(pane.iframe.style.pointerEvents).toBe('none')
    expect(pane.iframe.parentElement).toBe(panes.container)
    expect(pane.isDisposed).toBe(false)
  })

  it('remounts to a different target', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const t1 = createTarget({ left: 0, top: 0, width: 100, height: 100 })
    const t2 = createTarget({ left: 50, top: 60, width: 400, height: 300 })

    pane.mount(t1)
    pane.mount(t2)
    expect(pane.target).toBe(t2)
    expect(pane.iframe.style.left).toBe('50px')
    expect(pane.iframe.style.width).toBe('400px')

    const ro = ResizeObserverStub.instances[0]
    expect(ro.observed).toEqual([t2])
  })

  it('observes targets with a shared ResizeObserver and updates on resize', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const target = createTarget({ left: 0, top: 0, width: 100, height: 100 })

    pane.mount(target)
    expect(ResizeObserverStub.instances).toHaveLength(1)
    const ro = ResizeObserverStub.instances[0]
    expect(ro.observed).toEqual([target])

    mockRect(target, { left: 0, top: 0, width: 640, height: 480 })
    ro.trigger([target])
    expect(pane.iframe.style.width).toBe('640px')
    expect(pane.iframe.style.height).toBe('480px')

    pane.unmount()
    expect(ro.observed).toEqual([])
  })

  it('skips box syncing while hidden, re-syncs on show', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const target = createTarget({ left: 0, top: 0, width: 100, height: 100 })

    pane.mount(target)
    pane.hide()
    mockRect(target, { left: 0, top: 0, width: 999, height: 999 })
    ResizeObserverStub.instances[0].trigger([target])
    expect(pane.iframe.style.width).toBe('100px')

    pane.show()
    expect(pane.iframe.style.width).toBe('999px')
  })

  it('supports multiple panes stacked on the same target', () => {
    const panes = createIframePanes()
    const a = panes.ensure('a')
    const b = panes.ensure('b')
    const target = createTarget()

    a.mount(target)
    b.mount(target)
    const ro = ResizeObserverStub.instances[0]
    expect(ro.observed).toEqual([target])

    a.unmount()
    expect(ro.observed).toEqual([target])
    b.unmount()
    expect(ro.observed).toEqual([])
  })
})

describe('style customization', () => {
  it('merges manager and pane styleDefault', () => {
    const panes = createIframePanes({
      styleDefault: { borderRadius: '8px', colorScheme: 'light' },
    })
    const pane = panes.ensure('a', {
      styleDefault: { colorScheme: 'dark' },
    })
    expect(pane.iframe.style.borderRadius).toBe('8px')
    expect(pane.iframe.style.colorScheme).toBe('dark')
  })

  it('applies styleHidden and styleActive on state transitions', () => {
    const panes = createIframePanes({
      styleHidden: { visibility: 'hidden' },
      styleActive: { boxShadow: '0 0 8px black' },
    })
    const pane = panes.ensure('a')
    // hidden initially
    expect(pane.iframe.style.opacity).toBe('0.001')
    expect(pane.iframe.style.visibility).toBe('hidden')
    expect(pane.iframe.style.boxShadow).toBe('')

    pane.mount(createTarget())
    expect(pane.iframe.style.opacity).toBe('1')
    expect(pane.iframe.style.visibility).toBe('')
    expect(pane.iframe.style.boxShadow).toBe('0 0 8px black')

    pane.hide()
    expect(pane.iframe.style.visibility).toBe('hidden')
    expect(pane.iframe.style.boxShadow).toBe('')
  })

  it('resets state keys back to styleDefault values', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a', {
      styleDefault: { transform: 'scale(1)' },
      styleHidden: { transform: 'scale(0.98)' },
    })
    expect(pane.iframe.style.transform).toBe('scale(0.98)')

    pane.mount(createTarget())
    expect(pane.iframe.style.transform).toBe('scale(1)')

    pane.hide()
    expect(pane.iframe.style.transform).toBe('scale(0.98)')
  })

  it('overrides built-in hidden styles via styleHidden', () => {
    const panes = createIframePanes({
      styleHidden: { opacity: '0.5' },
    })
    const pane = panes.ensure('a', {
      styleHidden: { opacity: '0.25' },
    })
    expect(pane.iframe.style.opacity).toBe('0.25')
  })

  it('respects a custom styleActive pointerEvents, except while locked', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a', {
      styleActive: { pointerEvents: 'painted' },
    })
    pane.mount(createTarget())
    expect(pane.iframe.style.pointerEvents).toBe('painted')

    const release = panes.lockPointerEvents()
    expect(pane.iframe.style.pointerEvents).toBe('none')
    release()
    expect(pane.iframe.style.pointerEvents).toBe('painted')
  })
})

describe('pointer events lock', () => {
  it('locks and releases pointer events on all panes', () => {
    const panes = createIframePanes()
    const shown = panes.ensure('shown')
    const hidden = panes.ensure('hidden')
    shown.mount(createTarget())

    expect(panes.isPointerLocked).toBe(false)
    const release = panes.lockPointerEvents()
    expect(panes.isPointerLocked).toBe(true)
    expect(shown.iframe.style.pointerEvents).toBe('none')
    expect(hidden.iframe.style.pointerEvents).toBe('none')

    release()
    expect(panes.isPointerLocked).toBe(false)
    expect(shown.iframe.style.pointerEvents).toBe('auto')
    expect(hidden.iframe.style.pointerEvents).toBe('none')
  })

  it('counts overlapping locks and ignores double release', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    pane.mount(createTarget())

    const release1 = panes.lockPointerEvents()
    const release2 = panes.lockPointerEvents()
    release1()
    release1() // double release is a no-op
    expect(panes.isPointerLocked).toBe(true)
    expect(pane.iframe.style.pointerEvents).toBe('none')

    release2()
    expect(panes.isPointerLocked).toBe(false)
    expect(pane.iframe.style.pointerEvents).toBe('auto')
  })

  it('applies the lock to panes shown while locked', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const release = panes.lockPointerEvents()

    pane.mount(createTarget())
    expect(pane.iframe.style.pointerEvents).toBe('none')

    release()
    expect(pane.iframe.style.pointerEvents).toBe('auto')
  })
})

describe('lru auto-dispose', () => {
  it('is unlimited by default', () => {
    const panes = createIframePanes()
    for (let i = 0; i < 50; i++)
      panes.ensure(`pane-${i}`)
    expect(panes.list()).toHaveLength(50)
  })

  it('evicts the least-recently-active unmounted pane', () => {
    const disposedIds: string[] = []
    const panes = createIframePanes({
      maxPanes: 2,
      onPaneDisposed: pane => disposedIds.push(pane.id),
    })
    const a = panes.ensure('a')
    const b = panes.ensure('b')
    panes.ensure('a') // touch a — b becomes LRU

    const c = panes.ensure('c')
    expect(disposedIds).toEqual(['b'])
    expect(b.isDisposed).toBe(true)
    expect(b.iframe.parentElement).toBeNull()
    expect(panes.list()).toEqual([a, c])
  })

  it('never evicts mounted panes, even over the limit', () => {
    const panes = createIframePanes({ maxPanes: 1 })
    const a = panes.ensure('a')
    a.mount(createTarget())

    const b = panes.ensure('b')
    expect(a.isDisposed).toBe(false)
    expect(b.isDisposed).toBe(false)
    expect(panes.list()).toHaveLength(2)

    // next creation evicts the unmounted b, not the mounted a
    panes.ensure('c')
    expect(b.isDisposed).toBe(true)
    expect(a.isDisposed).toBe(false)
    expect(panes.list()).toHaveLength(2)
  })

  it('lowering maxPanes evicts immediately', () => {
    const panes = createIframePanes()
    panes.ensure('a')
    panes.ensure('b')
    const c = panes.ensure('c')

    panes.maxPanes = 1
    expect(panes.list()).toEqual([c])
  })

  it('recreates a pane after eviction', () => {
    const panes = createIframePanes({ maxPanes: 1 })
    const a1 = panes.ensure('a')
    panes.ensure('b')
    expect(a1.isDisposed).toBe(true)

    const a2 = panes.ensure('a')
    expect(a2).not.toBe(a1)
    expect(a2.isDisposed).toBe(false)
  })
})

describe('dispose', () => {
  it('disposes a pane: removes iframe and unregisters', () => {
    const created: IframePane[] = []
    const disposed: IframePane[] = []
    const panes = createIframePanes({
      onPaneCreated: pane => created.push(pane),
      onPaneDisposed: pane => disposed.push(pane),
    })
    const pane = panes.ensure('a')
    expect(created).toEqual([pane])

    pane.mount(createTarget())
    pane.dispose()
    pane.dispose() // idempotent
    expect(disposed).toEqual([pane])
    expect(pane.isDisposed).toBe(true)
    expect(pane.iframe.parentElement).toBeNull()
    expect(panes.has('a')).toBe(false)
    expect(ResizeObserverStub.instances[0].observed).toEqual([])
  })

  it('throws when mounting or showing a disposed pane', () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    pane.dispose()
    expect(() => pane.mount(createTarget())).toThrow('disposed')
    expect(() => pane.show()).toThrow('disposed')
    // these are no-ops instead
    expect(() => {
      pane.hide()
      pane.unmount()
      pane.update()
    }).not.toThrow()
  })

  it('disposes the manager: all panes, observers, and own container', () => {
    const panes = createIframePanes()
    const a = panes.ensure('a')
    a.mount(createTarget())
    const container = panes.container!

    panes.dispose()
    panes.dispose() // idempotent
    expect(panes.isDisposed).toBe(true)
    expect(a.isDisposed).toBe(true)
    expect(panes.list()).toEqual([])
    expect(container.parentElement).toBeNull()
    expect(panes.container).toBeUndefined()
    expect(() => panes.ensure('b')).toThrow('disposed')
  })

  it('keeps a custom container on manager dispose', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const panes = createIframePanes({ container })
    panes.ensure('a')

    panes.dispose()
    expect(container.parentElement).toBe(document.body)
    expect(container.children).toHaveLength(0)
  })
})

describe('viewport listeners', () => {
  it('updates mounted panes on window resize', async () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const target = createTarget({ left: 0, top: 0, width: 100, height: 100 })
    pane.mount(target)

    mockRect(target, { left: 30, top: 40, width: 100, height: 100 })
    window.dispatchEvent(new Event('resize'))
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    expect(pane.iframe.style.left).toBe('30px')
    expect(pane.iframe.style.top).toBe('40px')
  })

  it('updates mounted panes on scroll', async () => {
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    const target = createTarget({ left: 0, top: 0, width: 100, height: 100 })
    pane.mount(target)

    mockRect(target, { left: 0, top: -25, width: 100, height: 100 })
    window.dispatchEvent(new Event('scroll'))
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    expect(pane.iframe.style.top).toBe('-25px')
  })

  it('stops listening once nothing is mounted', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const panes = createIframePanes()
    const pane = panes.ensure('a')
    pane.mount(createTarget())
    pane.unmount()
    const removed = removeSpy.mock.calls.map(call => call[0])
    expect(removed).toContain('scroll')
    expect(removed).toContain('resize')
    removeSpy.mockRestore()
  })

  it('updateAll re-syncs every mounted pane', () => {
    const panes = createIframePanes()
    const a = panes.ensure('a')
    const b = panes.ensure('b')
    const ta = createTarget({ left: 0, top: 0, width: 100, height: 100 })
    const tb = createTarget({ left: 0, top: 0, width: 100, height: 100 })
    a.mount(ta)
    b.mount(tb)

    mockRect(ta, { left: 1, top: 2, width: 3, height: 4 })
    mockRect(tb, { left: 5, top: 6, width: 7, height: 8 })
    panes.updateAll()
    expect(a.iframe.style.left).toBe('1px')
    expect(a.iframe.style.height).toBe('4px')
    expect(b.iframe.style.left).toBe('5px')
    expect(b.iframe.style.height).toBe('8px')
  })
})
