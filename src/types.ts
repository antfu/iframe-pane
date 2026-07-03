export interface IframePanesOptions {
  /**
   * The document to create elements in.
   *
   * Resolved lazily so a manager can safely be created in module scope
   * during SSR — the DOM is only touched on first `ensure()`.
   *
   * @default globalThis.document
   */
  document?: Document
  /**
   * Element hosting the managed iframes, keeping them out of your app's
   * render tree. Must be a positioned element (if `position` computes to
   * `static`, it is set to `relative`).
   *
   * @default a lazily created `position: fixed; inset: 0; pointer-events: none` `<div>` appended to `<body>`
   */
  container?: HTMLElement
  /**
   * LRU-like auto-dispose limit — the maximum number of live panes kept
   * around. When exceeded, the least-recently-active **unmounted** panes are
   * disposed automatically. Mounted panes are never evicted, so the actual
   * count can temporarily exceed the limit.
   *
   * @default Infinity (unlimited)
   */
  maxPanes?: number
  /**
   * Opacity applied to hidden panes.
   *
   * A near-zero value (instead of `display: none` or `visibility: hidden`)
   * keeps the iframe rendered and "warm", avoiding browser throttling and
   * in-page layout resets while it is invisible.
   *
   * @default 0.001
   */
  hiddenOpacity?: number | string
  /**
   * `z-index` for the default container. Ignored when a custom `container`
   * is provided.
   *
   * @default undefined (not set)
   */
  zIndex?: number | string
  /**
   * Called after a pane is created.
   */
  onPaneCreated?: (pane: IframePane) => void
  /**
   * Called after a pane is disposed (manually or by LRU eviction).
   */
  onPaneDisposed?: (pane: IframePane) => void
}

export interface IframePaneOptions {
  /**
   * Initial `src` of the iframe. Only assigned on creation — re-`ensure()`ing
   * an existing pane never navigates it, so its state is preserved.
   */
  src?: string
  /**
   * Extra attributes to set on the iframe element,
   * e.g. `allow`, `sandbox`, `title`.
   */
  attrs?: Record<string, string>
  /**
   * Extra inline styles to apply on the iframe element.
   */
  style?: Record<string, string>
  /**
   * Called right after the iframe element is created,
   * before it is appended to the container.
   */
  onCreated?: (iframe: HTMLIFrameElement) => void
}

export interface IframePane {
  /**
   * Unique id of the pane within its manager.
   */
  readonly id: string
  /**
   * The managed iframe element.
   */
  readonly iframe: HTMLIFrameElement
  /**
   * The element the pane is currently mounted to, if any.
   */
  readonly target: Element | null
  /**
   * Whether the pane is currently mounted to a target element.
   */
  readonly isMounted: boolean
  /**
   * Whether the pane is currently shown.
   */
  readonly isVisible: boolean
  /**
   * Whether the pane has been disposed.
   */
  readonly isDisposed: boolean
  /**
   * Monotonic counter of the last activity (ensure/mount/show),
   * used for LRU eviction. Higher is more recent.
   */
  readonly lastActiveAt: number
  /**
   * Visually attach the pane to a target element: the iframe is shown and
   * kept in sync with the target's box (position and size), without ever
   * reparenting the iframe — so its state is preserved.
   *
   * Size changes of the target are tracked with a `ResizeObserver`;
   * window `scroll` and `resize` are also observed.
   */
  mount: (target: Element) => void
  /**
   * Detach from the current target (if any) and hide the pane.
   * The iframe element is kept alive, state preserved.
   */
  unmount: () => void
  /**
   * Show the pane (opacity restored, pointer events enabled unless the
   * manager holds a pointer-events lock) and re-sync its box.
   */
  show: () => void
  /**
   * Hide the pane by setting `opacity` to a near-zero value and
   * `pointer-events: none` — the iframe stays rendered and keeps its state.
   */
  hide: () => void
  /**
   * Manually re-sync the pane's box with its target.
   * Usually not needed — resize and scroll are tracked automatically.
   */
  update: () => void
  /**
   * Dispose the pane: unmount it, remove the iframe from the DOM, and
   * unregister it from the manager. Idempotent.
   */
  dispose: () => void
}

export interface IframePanes {
  /**
   * List all managed panes.
   */
  list: () => IframePane[]
  /**
   * Get a pane by id.
   */
  get: (id: string) => IframePane | undefined
  /**
   * Whether a pane with the given id exists.
   */
  has: (id: string) => boolean
  /**
   * Get the pane with the given id, creating it if missing.
   * Options only apply on creation.
   */
  ensure: (id: string, options?: IframePaneOptions) => IframePane
  /**
   * LRU-like auto-dispose limit, see {@link IframePanesOptions.maxPanes}.
   * Lowering it evicts immediately.
   */
  maxPanes: number
  /**
   * Whether at least one pointer-events lock is currently held.
   */
  readonly isPointerLocked: boolean
  /**
   * Temporarily set `pointer-events: none` on every managed iframe — call
   * this when a drag or panel-resize interaction starts so iframes don't
   * swallow pointer events. Returns a release function; locks are counted,
   * so overlapping interactions compose. Releasing twice is a no-op.
   */
  lockPointerEvents: () => () => void
  /**
   * Re-sync every mounted pane with its target.
   * Usually not needed — resize and scroll are tracked automatically.
   */
  updateAll: () => void
  /**
   * The element currently hosting the managed iframes,
   * or `undefined` if the default container has not been created yet.
   */
  readonly container: HTMLElement | undefined
  /**
   * Whether the manager has been disposed.
   */
  readonly isDisposed: boolean
  /**
   * Dispose all panes, disconnect all observers and listeners, and remove
   * the default container. Idempotent.
   */
  dispose: () => void
}
