import type { IframePane, IframePaneOptions, IframePanes, IframePanesOptions, IframePaneStyle } from './types'

/**
 * Whether an element is an iframe, checked against its own document's view so
 * it works across realms (and under happy-dom in tests). Falls back to a
 * duck-typed `'src' in el` when no view/constructor is available.
 */
function isIframe(el: HTMLElement): el is HTMLIFrameElement {
  const view = el.ownerDocument?.defaultView
  if (view?.HTMLIFrameElement)
    return el instanceof view.HTMLIFrameElement
  if (typeof HTMLIFrameElement !== 'undefined')
    return el instanceof HTMLIFrameElement
  return 'src' in el
}

/**
 * Create a manager for a set of persistent, headless iframes.
 *
 * Iframes are parked in a dedicated container outside of your app's render
 * tree, and are visually "mounted" onto target elements by syncing their
 * boxes — never reparented, so their state (navigation, JS, scroll) survives
 * unmounts, tab switches, and re-renders.
 *
 * Safe to call in module scope during SSR: the DOM is only touched once a
 * pane is created.
 *
 * Panes are iframe-first, but the machinery is element-agnostic: pass a
 * custom `tagName` (e.g. `'div'`) or an existing `element` to manage any
 * out-of-tree element the same way.
 */
export function createIframePanes(options: IframePanesOptions = {}): IframePanes {
  const panes = new Map<string, Pane>()
  /** Panes grouped by the target element they are mounted to */
  const targetPanes = new Map<Element, Set<Pane>>()

  let maxPanes = options.maxPanes ?? Number.POSITIVE_INFINITY
  let ownContainer: HTMLElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let pointerLocks = 0
  let rafId: number | undefined
  let isDisposed = false
  /** Monotonic clock for LRU recency */
  let clock = 0

  function getDocument(): Document {
    const doc = options.document ?? globalThis.document
    if (!doc)
      throw new Error('[iframe-pane] No document available. Provide `options.document` or run in a DOM environment.')
    return doc
  }

  function getWindow(): (Window & typeof globalThis) | null {
    return getDocument().defaultView
  }

  function getContainer(): HTMLElement {
    if (options.container) {
      const el = options.container
      const position = el.ownerDocument.defaultView?.getComputedStyle(el).position
      if (!position || position === 'static')
        el.style.position = 'relative'
      return el
    }
    if (!ownContainer) {
      const doc = getDocument()
      ownContainer = doc.createElement('div')
      ownContainer.setAttribute('data-iframe-panes', '')
      Object.assign(ownContainer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
      } satisfies Partial<CSSStyleDeclaration>)
      if (options.zIndex != null)
        ownContainer.style.zIndex = String(options.zIndex)
      doc.body.appendChild(ownContainer)
    }
    return ownContainer
  }

  function getResizeObserver(): ResizeObserver | undefined {
    if (!resizeObserver && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          targetPanes.get(entry.target)?.forEach(pane => pane.update())
        }
      })
    }
    return resizeObserver
  }

  function scheduleUpdateAll(): void {
    if (rafId != null)
      return
    const view = getWindow()
    if (!view) {
      updateAll()
      return
    }
    rafId = view.requestAnimationFrame(() => {
      rafId = undefined
      updateAll()
    })
  }

  function updateAll(): void {
    for (const set of targetPanes.values()) {
      for (const pane of set)
        pane.update()
    }
  }

  const onViewportChange = (): void => scheduleUpdateAll()

  function updateWindowListeners(): void {
    const view = getWindow()
    if (!view)
      return
    if (targetPanes.size > 0) {
      // Idempotent: re-adding the same listener reference is a no-op
      view.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
      view.addEventListener('resize', onViewportChange, { passive: true })
    }
    else {
      view.removeEventListener('scroll', onViewportChange, { capture: true })
      view.removeEventListener('resize', onViewportChange)
      if (rafId != null) {
        view.cancelAnimationFrame(rafId)
        rafId = undefined
      }
    }
  }

  function track(pane: Pane, target: Element): void {
    let set = targetPanes.get(target)
    if (!set) {
      set = new Set()
      targetPanes.set(target, set)
      getResizeObserver()?.observe(target)
    }
    set.add(pane)
    updateWindowListeners()
  }

  function untrack(pane: Pane, target: Element): void {
    const set = targetPanes.get(target)
    if (!set)
      return
    set.delete(pane)
    if (set.size === 0) {
      targetPanes.delete(target)
      resizeObserver?.unobserve(target)
    }
    updateWindowListeners()
  }

  function applyPointerEvents(pane: Pane): void {
    pane.element.style.pointerEvents = pointerLocks > 0
      ? 'none'
      : pane.stateStyle.pointerEvents
  }

  /**
   * Dispose least-recently-active unmounted panes until under the limit.
   * Mounted panes and the (just created) protected pane are never evicted.
   */
  function evict(protect?: Pane): void {
    if (panes.size <= maxPanes)
      return
    const candidates = [...panes.values()]
      .filter(pane => !pane.isMounted && pane !== protect)
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    for (const pane of candidates) {
      if (panes.size <= maxPanes)
        break
      pane.dispose()
    }
  }

  class Pane implements IframePane<HTMLElement> {
    readonly id: string
    readonly element: HTMLElement
    readonly styleDefault: IframePaneStyle
    readonly styleActive: IframePaneStyle & { pointerEvents: string }
    readonly styleHidden: IframePaneStyle & { pointerEvents: string }
    /** Union of style keys managed by the two states */
    readonly stateKeys: string[]
    target: Element | null = null
    isVisible = false
    isDisposed = false
    lastActiveAt = 0

    constructor(id: string, paneOptions: IframePaneOptions<HTMLElement>) {
      this.id = id
      this.styleDefault = {
        ...options.styleDefault,
        ...paneOptions.style,
      }
      this.styleActive = {
        opacity: '1',
        pointerEvents: 'auto',
        ...options.styleActive,
        ...paneOptions.styleActive,
      }
      this.styleHidden = {
        opacity: '0.001',
        pointerEvents: 'none',
        ...options.styleHidden,
        ...paneOptions.styleHidden,
      }
      this.stateKeys = [...new Set([
        ...Object.keys(this.styleActive),
        ...Object.keys(this.styleHidden),
      ])]

      const doc = getDocument()
      const el = this.element = paneOptions.element ?? doc.createElement(paneOptions.tagName ?? 'iframe')
      el.setAttribute('data-iframe-pane', id)
      Object.assign(el.style, {
        display: 'block',
        position: 'absolute',
        left: '0px',
        top: '0px',
        border: '0',
      } satisfies Partial<CSSStyleDeclaration>, this.styleDefault)
      if (paneOptions.attrs) {
        for (const [key, value] of Object.entries(paneOptions.attrs))
          el.setAttribute(key, value)
      }
      this.applyState()
      paneOptions.onCreated?.(el)
      // `src` is iframe-specific — only assign it when the element actually
      // supports it (robust under the pane's document, incl. happy-dom).
      if (paneOptions.src != null && isIframe(el))
        el.src = paneOptions.src
      getContainer().appendChild(el)
    }

    /**
     * Back-compat alias for {@link Pane.element} when it is an iframe;
     * `undefined` for non-iframe panes.
     */
    get iframe(): HTMLIFrameElement | undefined {
      return isIframe(this.element) ? this.element : undefined
    }

    get isMounted(): boolean {
      return this.target != null
    }

    /** Merged styles of the current visibility state */
    get stateStyle(): IframePaneStyle & { pointerEvents: string } {
      return this.isVisible ? this.styleActive : this.styleHidden
    }

    /**
     * Apply the styles of the current state; keys owned by the opposite
     * state fall back to `styleDefault` (or are removed). A pointer-events
     * lock always wins.
     */
    applyState(): void {
      const state = this.stateStyle
      const styles: IframePaneStyle = {}
      for (const key of this.stateKeys) {
        if (!(key in state))
          styles[key] = this.styleDefault[key] ?? ''
      }
      Object.assign(this.element.style, styles, state)
      if (pointerLocks > 0)
        this.element.style.pointerEvents = 'none'
    }

    touch(): void {
      this.lastActiveAt = ++clock
    }

    mount(target: Element): void {
      this.assertNotDisposed()
      if (this.target !== target) {
        if (this.target)
          untrack(this, this.target)
        this.target = target
        track(this, target)
      }
      this.show()
    }

    unmount(): void {
      if (this.target) {
        untrack(this, this.target)
        this.target = null
      }
      this.hide()
    }

    show(): void {
      this.assertNotDisposed()
      this.touch()
      this.isVisible = true
      this.applyState()
      this.update()
    }

    hide(): void {
      if (this.isDisposed)
        return
      this.isVisible = false
      this.applyState()
    }

    update(): void {
      if (this.isDisposed || !this.target || !this.isVisible)
        return
      const targetRect = this.target.getBoundingClientRect()
      const containerRect = getContainer().getBoundingClientRect()
      Object.assign(this.element.style, {
        left: `${targetRect.left - containerRect.left}px`,
        top: `${targetRect.top - containerRect.top}px`,
        width: `${targetRect.width}px`,
        height: `${targetRect.height}px`,
      } satisfies Partial<CSSStyleDeclaration>)
    }

    dispose(): void {
      if (this.isDisposed)
        return
      this.unmount()
      this.isDisposed = true
      this.element.remove()
      panes.delete(this.id)
      options.onPaneDisposed?.(this)
    }

    private assertNotDisposed(): void {
      if (this.isDisposed)
        throw new Error(`[iframe-pane] Pane "${this.id}" has been disposed`)
    }
  }

  return {
    list() {
      return [...panes.values()]
    },
    get(id) {
      return panes.get(id)
    },
    has(id) {
      return panes.has(id)
    },
    // Overloaded in the `IframePanes` type to infer the element type from
    // `tagName`/`element`; the runtime is element-agnostic, so cast the impl.
    ensure: ((id: string, paneOptions: IframePaneOptions<HTMLElement> = {}) => {
      if (isDisposed)
        throw new Error('[iframe-pane] Manager has been disposed')
      let pane = panes.get(id)
      if (!pane) {
        pane = new Pane(id, paneOptions)
        pane.touch()
        panes.set(id, pane)
        options.onPaneCreated?.(pane)
        evict(pane)
      }
      else {
        pane.touch()
      }
      return pane
    }) as unknown as IframePanes['ensure'],
    get maxPanes() {
      return maxPanes
    },
    set maxPanes(value) {
      maxPanes = value
      evict()
    },
    get isPointerLocked() {
      return pointerLocks > 0
    },
    lockPointerEvents() {
      pointerLocks++
      panes.forEach(applyPointerEvents)
      let released = false
      return () => {
        if (released)
          return
        released = true
        pointerLocks--
        panes.forEach(applyPointerEvents)
      }
    },
    updateAll,
    get container() {
      return options.container ?? ownContainer
    },
    get isDisposed() {
      return isDisposed
    },
    dispose() {
      if (isDisposed)
        return
      isDisposed = true
      for (const pane of [...panes.values()])
        pane.dispose()
      resizeObserver?.disconnect()
      resizeObserver = undefined
      updateWindowListeners()
      ownContainer?.remove()
      ownContainer = undefined
    },
  }
}
