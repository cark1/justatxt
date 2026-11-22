import { EditorView } from '@codemirror/view'
import { applyLines } from './commands'
import { setDragStart } from './decorations'
import { classify, groupIndexOf, moveGroupTo, owners, relocateRange, snapItemDrop, splitSections, unitRange } from './model'

/**
 * Drag by the handle that appears on hover. Items can be dropped anywhere (also into
 * another group); groups snap between groups and carry all their lines with them.
 */
interface Target {
  apply: () => void
  y: number
}

function lineTop(view: EditorView, index: number): number {
  const doc = view.state.doc
  if (index >= doc.lines) {
    const last = view.lineBlockAt(doc.length)
    return view.documentTop + last.bottom
  }
  return view.documentTop + view.lineBlockAt(doc.line(index + 1).from).top
}

function lineBottom(view: EditorView, index: number): number {
  return view.documentTop + view.lineBlockAt(view.state.doc.line(index + 1).from).bottom
}

function hoveredLine(view: EditorView, clientY: number): { index: number; upper: boolean } {
  const rect = view.contentDOM.getBoundingClientRect()
  const y = Math.max(rect.top + 1, Math.min(clientY, rect.bottom - 1))
  const pos = view.posAtCoords({ x: rect.left + 30, y }, false)
  const block = view.lineBlockAt(pos)
  const mid = view.documentTop + (block.top + block.bottom) / 2
  return { index: view.state.doc.lineAt(block.from).number - 1, upper: clientY < mid }
}

function itemTarget(view: EditorView, from: number, clientY: number): Target | null {
  const lines = view.state.doc.toJSON()
  const own = owners(lines)
  const [s, e] = unitRange(lines, from, own)
  const { index, upper } = hoveredLine(view, clientY)
  // drop between whole items, never between an item and its continuation lines
  const [hs, he] = unitRange(lines, index, own)
  let to = upper ? hs : he + 1
  to = snapItemDrop(lines, to)
  if (to >= s && to <= e + 1) return null
  return {
    y: lineTop(view, to),
    apply: () => {
      const r = relocateRange(lines, s, e, to)
      if (r) applyLines(view, { lines: r.lines, index: r.index + (e - s) }, 'end', 'move.drop')
    }
  }
}

function groupTarget(view: EditorView, header: number, clientY: number): Target | null {
  const lines = view.state.doc.toJSON()
  const src = groupIndexOf(lines, header)
  const count = splitSections(lines).groups.length
  const { index } = hoveredLine(view, clientY)
  const g = groupIndexOf(lines, index)
  let to: number
  if (g < 0) to = 0
  else {
    // header line of group g and its last line
    const headers: number[] = []
    lines.forEach((l, i) => classify(l).kind === 'group' && headers.push(i))
    const start = headers[g]
    let end = (headers[g + 1] ?? lines.length) - 1
    while (end > start && lines[end].trim() === '') end--
    const mid = (lineTop(view, start) + lineBottom(view, end)) / 2
    to = clientY < mid ? g : g + 1
  }
  if (to === src || to === src + 1) return null
  const headers: number[] = []
  lines.forEach((l, i) => classify(l).kind === 'group' && headers.push(i))
  const y = to < count ? lineTop(view, headers[to]) : lineTop(view, lines.length)
  return {
    y,
    apply: () => {
      const r = moveGroupTo(lines, src, to)
      if (r) applyLines(view, r, 'end', 'move.drop')
    }
  }
}

function startDrag(view: EditorView, pos: number, e: MouseEvent): void {
  const line = view.state.doc.lineAt(pos)
  const from = line.number - 1
  const isGroup = classify(line.text).kind === 'group'
  const startY = e.clientY
  let dragging = false
  let target: Target | null = null

  const indicator = document.createElement('div')
  indicator.className = 'drop-indicator'
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.textContent = classify(line.text).kind === 'group' ? line.text.replace(/^#+\s*/, '') : line.text.slice(classify(line.text).prefixLen)

  const onMove = (ev: MouseEvent) => {
    if (!dragging) {
      if (Math.abs(ev.clientY - startY) < 4) return
      dragging = true
      document.body.classList.add('is-dragging')
      document.body.append(indicator, ghost)
    }
    const scroller = view.scrollDOM.getBoundingClientRect()
    if (ev.clientY < scroller.top + 30) view.scrollDOM.scrollTop -= 12
    else if (ev.clientY > scroller.bottom - 30) view.scrollDOM.scrollTop += 12

    target = isGroup ? groupTarget(view, from, ev.clientY) : itemTarget(view, from, ev.clientY)
    const content = view.contentDOM.getBoundingClientRect()
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY - 10}px)`
    if (target) {
      indicator.style.display = 'block'
      indicator.style.top = `${target.y - 1}px`
      indicator.style.left = `${content.left + 8}px`
      indicator.style.width = `${content.width - 16}px`
    } else {
      indicator.style.display = 'none'
    }
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.classList.remove('is-dragging')
    indicator.remove()
    ghost.remove()
    if (dragging && target) target.apply()
    view.focus()
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

export function installDragDrop(): void {
  setDragStart(startDrag)
}
