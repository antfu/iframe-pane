# iframe-pane

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

Pane for manage and persistent iframes.

A vanilla, headless, lightweight library to manage multiple iframes **outside of your app's render tree**, while still visually "mounting" them onto any element — without losing their state.

Extracted from the iframe management patterns of [Vite DevTools](https://github.com/vitejs/devtools), [Nuxt DevTools](https://github.com/nuxt/devtools) and [devframe](https://github.com/devframes/devframe).

## Why

Iframes lose all their state (navigation, scroll, JS, inputs) the moment they are detached or reparented in the DOM. That makes them painful in component frameworks: switching a tab, moving a panel, or re-rendering a subtree kills the embedded page.

`iframe-pane` keeps every iframe parked in a dedicated overlay container that never re-renders. Your components only render a plain placeholder element — the pane is positioned over it and follows its box. Unmounting just hides the iframe; remounting brings it back exactly where it left off.

## Features

- **Headless & vanilla** — zero dependencies, no UI, framework-agnostic; integrates in a few lines with Vue, React, Solid, or plain DOM
- **State-preserving** — iframes are never reparented; "mount" only syncs position/size onto a target element
- **Warm hiding** — hidden panes get `opacity: 0.001` + `pointer-events: none` instead of `display: none`, so the embedded page keeps rendering and is never throttled or re-laid-out
- **Auto box syncing** — a shared `ResizeObserver` on targets plus window `scroll`/`resize` listeners (rAF-batched) keep panes glued to their targets
- **Pointer-events locking** — temporarily disable pointer events on all iframes during drags or panel resizes, so iframes don't swallow your `pointermove`s
- **LRU auto-dispose** — optional cap on live panes (`maxPanes`, default unlimited); least-recently-active unmounted panes are freed automatically
- **SSR-safe** — managers can be created in module scope; the DOM is only touched on first use

## Install

```bash
pnpm add iframe-pane
```

## Usage

```ts
import { createIframePanes } from 'iframe-pane'

const panes = createIframePanes()

// get-or-create a pane (options only apply on creation)
const pane = panes.ensure('docs', {
  src: 'https://example.com/',
  attrs: { allow: 'clipboard-read; clipboard-write' },
})

// visually attach it to any element — position and size follow automatically
pane.mount(document.querySelector('#panel')!)

// switching away? just unmount — the iframe stays alive, state preserved
pane.unmount()

// ...and mount it somewhere else later, state intact
pane.mount(anotherElement)
```

### Styling

The library is headless — iframes only carry minimal built-in styles. Customize them per state, at the manager level and/or per pane (camelCase CSS properties):

```ts
const panes = createIframePanes({
  // applied to every iframe on creation
  styleDefault: { borderRadius: '8px', transition: 'opacity 150ms ease' },
  // applied when a pane is shown (over the built-in `opacity: 1; pointer-events: auto`)
  styleActive: { boxShadow: '0 2px 12px rgba(0, 0, 0, 0.2)' },
  // applied when a pane is hidden (over the built-in `opacity: 0.001; pointer-events: none`)
  styleHidden: { visibility: 'hidden' },
})

// per-pane overrides, merged over the manager's
panes.ensure('docs', {
  src: 'https://example.com/',
  style: { colorScheme: 'dark' },
})
```

Precedence: built-ins → manager options → pane options. On a state transition, style keys owned by the opposite state are reset to their `styleDefault` value (or removed), so the two states can use disjoint properties safely.

### Pointer events during drag / resize

Iframes capture pointer events, which breaks drag interactions happening above them (panel resizing, window dragging, …). Lock them while the interaction runs:

```ts
splitter.addEventListener('pointerdown', () => {
  const release = panes.lockPointerEvents()
  window.addEventListener('pointerup', release, { once: true })
})
```

Locks are counted, so overlapping interactions compose — pointer events are restored when the last lock is released.

### Listing and limiting panes

```ts
// list all managed panes
for (const pane of panes.list())
  console.log(pane.id, pane.isMounted, pane.isVisible)

// LRU-like auto-dispose: keep at most 5 live iframes.
// Least-recently-active unmounted panes are disposed first;
// mounted panes are never evicted.
const panes = createIframePanes({ maxPanes: 5 })
```

### Managing non-iframe elements

`iframe-pane` is iframe-first, but the pane machinery (box syncing, warm hiding, pointer-events locking, LRU eviction) is element-agnostic. Pass a `tagName` to manage any element the same way — for example a `<div>` for a custom-render dock that also needs to persist out of the render tree:

```ts
// create a <div> pane instead of an <iframe>
const dock = panes.ensure('custom', { tagName: 'div' })
dock.element.append(myRenderedNode) // pane.element is the managed <div>
dock.mount(document.querySelector('#stage')!)
```

Or adopt an existing element with `element` (it takes precedence over `tagName`); it's appended into the container and gets the same base styles and state:

```ts
const node = document.createElement('div')
panes.ensure('custom', { element: node })
```

`pane.element` is the canonical accessor for any pane; `pane.iframe` remains as a back-compat alias (the same element, typed as `HTMLIFrameElement`). `src` is only applied to iframe panes and is ignored otherwise.

## API

### `createIframePanes(options?)`

| Option | Default | Description |
| --- | --- | --- |
| `container` | fixed full-viewport `<div>` in `<body>` | Positioned element hosting the parked iframes |
| `maxPanes` | `Infinity` | LRU auto-dispose limit |
| `styleDefault` | — | Base inline styles applied to every iframe on creation |
| `styleActive` | `{ opacity: '1', pointerEvents: 'auto' }` | Inline styles applied when a pane is shown |
| `styleHidden` | `{ opacity: '0.001', pointerEvents: 'none' }` | Inline styles applied when a pane is hidden |
| `zIndex` | unset | `z-index` of the default container |
| `document` | `globalThis.document` | Document to operate on |
| `onPaneCreated` / `onPaneDisposed` | — | Lifecycle callbacks |

Returns an `IframePanes` manager:

- `ensure(id, options?)` — get-or-create a pane (`src`, `attrs`, `tagName`, `element`, `style`, `styleActive`, `styleHidden`, `onCreated`; creation-only)
- `get(id)` / `has(id)` / `list()`
- `lockPointerEvents()` — returns a release function
- `maxPanes` — read/write; lowering evicts immediately
- `updateAll()` — manually re-sync all mounted panes
- `dispose()` — tear everything down

### `IframePane`

- `mount(target)` — show and keep the iframe synced over the target element
- `unmount()` — detach and hide (iframe kept alive)
- `show()` / `hide()` — toggle visibility without detaching
- `update()` — manually re-sync the box
- `dispose()` — remove the element and unregister it
- `element` — the managed element (an `<iframe>` by default)
- `iframe` — back-compat alias for `element`, typed as `HTMLIFrameElement`
- `target`, `isMounted`, `isVisible`, `isDisposed`, `lastActiveAt`

## Framework integrations

The pattern is identical everywhere: render an empty placeholder element, `mount` the pane to it on mount, `unmount` on cleanup. Create the manager once, in module scope.

### Vanilla

```ts
import { createIframePanes } from 'iframe-pane'

const panes = createIframePanes()

function switchTab(id: string, src: string) {
  for (const pane of panes.list())
    pane.unmount()
  panes.ensure(id, { src }).mount(document.querySelector('#stage')!)
}
```

### Vue

```ts
// panes.ts
import { createIframePanes } from 'iframe-pane'

export const panes = createIframePanes()
```

```vue
<!-- IframePane.vue -->
<script setup lang="ts">
import { onScopeDispose, useTemplateRef, watchPostEffect } from 'vue'
import { panes } from './panes'

const props = defineProps<{ id: string, src: string }>()

const el = useTemplateRef('el')
const pane = panes.ensure(props.id, { src: props.src })

watchPostEffect(() => {
  if (el.value)
    pane.mount(el.value)
})
onScopeDispose(() => pane.unmount())
</script>

<template>
  <div ref="el" class="h-full w-full" />
</template>
```

### React

```tsx
// IframePane.tsx
import { useEffect, useRef } from 'react'
import { panes } from './panes'

export function IframePane({ id, src }: { id: string, src: string }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const pane = panes.ensure(id, { src })
    pane.mount(el.current!)
    return () => pane.unmount()
  }, [id, src])

  return <div ref={el} style={{ width: '100%', height: '100%' }} />
}
```

### Solid

```tsx
// IframePane.tsx
import { onCleanup, onMount } from 'solid-js'
import { panes } from './panes'

export function IframePane(props: { id: string, src: string }) {
  let el!: HTMLDivElement

  onMount(() => {
    const pane = panes.ensure(props.id, { src: props.src })
    pane.mount(el)
    onCleanup(() => pane.unmount())
  })

  return <div ref={el} style={{ width: '100%', height: '100%' }} />
}
```

## Notes & caveats

- The default container is `position: fixed`. If an ancestor of `<body>`-level content creates a containing block (`transform`, `filter`, `contain`, …), provide your own `container` placed appropriately instead.
- Panes follow target *boxes*, not target *lifecycles*: when the target element is removed from the DOM, call `unmount()` (the framework integrations above do this in their cleanup hooks).
- Multiple panes may be mounted to the same target — they stack in creation order.

## Playground

```bash
pnpm install
pnpm play
```

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg" alt="Sponsors"/>
  </a>
</p>

## License

[MIT](./LICENSE.md) License © [Anthony Fu](https://github.com/antfu)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/iframe-pane?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmx.dev/package/iframe-pane
[npm-downloads-src]: https://img.shields.io/npm/dm/iframe-pane?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmx.dev/package/iframe-pane
[bundle-src]: https://img.shields.io/bundlephobia/minzip/iframe-pane?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=iframe-pane
[license-src]: https://img.shields.io/github/license/antfu/iframe-pane.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/antfu/iframe-pane/blob/main/LICENSE.md
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/iframe-pane
