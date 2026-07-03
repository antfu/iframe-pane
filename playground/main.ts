import { createIframePanes } from '../src'

const panes = createIframePanes({
  zIndex: 10,
  styleDefault: {
    borderRadius: '8px',
    transition: 'opacity 150ms ease',
  },
  onPaneCreated: pane => log(`created: ${pane.id}`),
  onPaneDisposed: pane => log(`disposed: ${pane.id}`),
})

// Expose for quick console poking
Object.assign(window, { panes })

const stage = document.querySelector<HTMLDivElement>('#stage')!
const statusEl = document.querySelector<HTMLPreElement>('#status')!
const tabButtons = document.querySelector<HTMLSpanElement>('#tab-buttons')!
const sidebar = document.querySelector<HTMLDivElement>('#sidebar')!
const splitter = document.querySelector<HTMLDivElement>('#splitter')!

const tabs = ['a', 'b', 'c'] as const
let active: string | null = null
const logs: string[] = []

function log(message: string): void {
  logs.unshift(message)
  logs.length = Math.min(logs.length, 8)
  renderStatus()
}

function renderStatus(): void {
  const lines = panes.list().map(pane =>
    `${pane.id}  mounted:${pane.isMounted}  visible:${pane.isVisible}  lru:${pane.lastActiveAt}`)
  statusEl.textContent = [
    `maxPanes: ${panes.maxPanes}`,
    `pointerLocked: ${panes.isPointerLocked}`,
    '',
    ...lines,
    '',
    ...logs,
  ].join('\n')
}

function activate(id: string): void {
  active = id
  for (const other of panes.list()) {
    if (other.id !== id)
      other.unmount()
  }
  if (id === 'div') {
    // A non-iframe pane: managed the same way, but the pane element is a
    // <div> we render into ourselves (e.g. a "custom-render" dock).
    panes.ensure(id, {
      tagName: 'div',
      style: { background: '#144d34', color: '#dfe', padding: '16px', overflow: 'auto' },
      onCreated: (el) => {
        el.innerHTML = '<h2>Custom &lt;div&gt; pane</h2><p>This pane is a plain <code>&lt;div&gt;</code>, not an iframe — managed by the same manager. Switch tabs and back: it persists.</p><button id="div-count">clicks: 0</button>'
        let clicks = 0
        el.querySelector('#div-count')!.addEventListener('click', (event) => {
          (event.currentTarget as HTMLButtonElement).textContent = `clicks: ${++clicks}`
        })
      },
    }).mount(stage)
  }
  else {
    panes.ensure(id, { src: `./pages/${id}.html`, attrs: { title: `Pane ${id}` } })
      .mount(stage)
  }
  for (const button of tabButtons.querySelectorAll('button'))
    button.classList.toggle('active', button.dataset.tab === active)
  renderStatus()
}

for (const id of [...tabs, 'div']) {
  const button = document.createElement('button')
  button.textContent = id === 'div' ? 'Div pane' : `Tab ${id.toUpperCase()}`
  button.dataset.tab = id
  button.addEventListener('click', () => activate(id))
  tabButtons.appendChild(button)
}

document.querySelector('#btn-unmount')!.addEventListener('click', () => {
  if (active)
    panes.get(active)?.unmount()
  renderStatus()
})

document.querySelector('#btn-hide')!.addEventListener('click', () => {
  const pane = active ? panes.get(active) : undefined
  if (!pane)
    return
  if (pane.isVisible)
    pane.hide()
  else
    pane.show()
  renderStatus()
})

document.querySelector('#btn-dispose')!.addEventListener('click', () => {
  if (active)
    panes.get(active)?.dispose()
  renderStatus()
})

document.querySelector('#btn-lru')!.addEventListener('click', () => {
  panes.maxPanes = panes.maxPanes === 2 ? Number.POSITIVE_INFINITY : 2
  renderStatus()
})

// Splitter drag: lock pointer events on all panes so the iframe
// doesn't swallow pointermove while resizing.
splitter.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  const release = panes.lockPointerEvents()
  splitter.classList.add('dragging')
  renderStatus()

  const onMove = (move: PointerEvent): void => {
    sidebar.style.width = `${move.clientX}px`
  }
  const onUp = (): void => {
    release()
    splitter.classList.remove('dragging')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    renderStatus()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
})

renderStatus()
