/**
 * Pure, editor-agnostic logic: how a line is classified and how lines/groups move.
 * Everything works on plain strings so the file on disk is always the source of truth.
 */

export type LineKind = 'group' | 'task' | 'text' | 'blank'

export interface LineInfo {
  kind: LineKind
  /** Length of the syntax prefix ("# ", "- [ ] ") that the editor renders as UI. */
  prefixLen: number
  indent: string
  done: boolean
  /** Offset of "[" inside the line, for tasks. */
  box: number
}

// "# Titolo", but also "#Titolo" or a lone "#" at line start (the space is added while typing)
const GROUP_RE = /^#{1,6}(?:[ \t]+|$|(?=[^#\s]))/
// "- [ ] ", "* [x] ", "[ ] ", "[] ", with optional indentation. Must be followed by space or EOL
// so that "[link](url)" is never mistaken for a task.
const TASK_RE = /^([ \t]*)((?:[-*+][ \t]+)?)\[([ xX]?)\](?:[ \t]+|$)/

export function classify(text: string): LineInfo {
  const g = GROUP_RE.exec(text)
  if (g) return { kind: 'group', prefixLen: g[0].length, indent: '', done: false, box: -1 }
  const t = TASK_RE.exec(text)
  if (t) {
    return {
      kind: 'task',
      prefixLen: t[0].length,
      indent: t[1],
      done: t[3] === 'x' || t[3] === 'X',
      box: t[1].length + t[2].length
    }
  }
  if (text.trim() === '') return { kind: 'blank', prefixLen: 0, indent: text, done: false, box: -1 }
  return { kind: 'text', prefixLen: 0, indent: /^[ \t]*/.exec(text)![0], done: false, box: -1 }
}

/** Returns the line with its checkbox toggled, keeping everything else intact. */
export function toggleTask(text: string): string {
  const info = classify(text)
  if (info.kind !== 'task') return text
  const close = text.indexOf(']', info.box)
  const mark = info.done ? ' ' : 'x'
  return text.slice(0, info.box + 1) + mark + text.slice(close)
}

/** "[] " / "[ ] " / "- [] " typed at line start: the canonical form we write. */
export const TASK_TRIGGER_RE = /^([ \t]*)(?:[-*+][ \t]*)?\[ ?\]$/
export const taskPrefix = (indent = '') => `${indent}- [ ] `

// ---------- links ----------

export interface LinkSpan {
  from: number
  to: number
  /** Visible label range (markdown links only). */
  labelFrom: number
  labelTo: number
  url: string
  markdown: boolean
}

const MD_LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)/g
const BARE_URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/g

export function findLinks(text: string): LinkSpan[] {
  const out: LinkSpan[] = []
  for (const m of text.matchAll(MD_LINK_RE)) {
    const from = m.index!
    out.push({
      from,
      to: from + m[0].length,
      labelFrom: from + 1,
      labelTo: from + 1 + m[1].length,
      url: normalizeUrl(m[2]),
      markdown: true
    })
  }
  for (const m of text.matchAll(BARE_URL_RE)) {
    const from = m.index!
    const to = from + m[0].length
    if (out.some((l) => from < l.to && to > l.from)) continue
    out.push({ from, to, labelFrom: from, labelTo: to, url: normalizeUrl(m[0]), markdown: false })
  }
  return out.sort((a, b) => a.from - b.from)
}

export function normalizeUrl(s: string): string {
  return /^www\./i.test(s) ? `https://${s}` : s
}

export function isUrl(s: string): boolean {
  return /^(https?:\/\/|mailto:)[^\s]+$/i.test(s) || /^www\.[^\s]+\.[^\s]+$/i.test(s)
}

// ---------- moving ----------

export interface MoveResult {
  lines: string[]
  /** New index of the line that carried the cursor. */
  index: number
}

const kindAt = (lines: string[], i: number) => classify(lines[i]).kind

/** Move line `from` so it ends up before original index `to` (0..length). */
export function relocate(lines: string[], from: number, to: number): MoveResult | null {
  if (to === from || to === from + 1) return null
  const out = lines.slice()
  const [line] = out.splice(from, 1)
  const at = to > from ? to - 1 : to
  out.splice(at, 0, line)
  return { lines: out, index: at }
}

type Hidden = (i: number) => boolean

function prevVisible(lines: string[], i: number, hidden: Hidden, skipBlank = false): number {
  for (let j = i - 1; j >= 0; j--) {
    if (hidden(j)) continue
    if (skipBlank && kindAt(lines, j) === 'blank') continue
    return j
  }
  return -1
}

function nextVisible(lines: string[], i: number, hidden: Hidden, skipBlank = false): number {
  for (let j = i + 1; j < lines.length; j++) {
    if (hidden(j)) continue
    if (skipBlank && kindAt(lines, j) === 'blank') continue
    return j
  }
  return -1
}

// ---------- continuation lines (shift+enter inside an item) ----------

/**
 * A task can span several lines: following lines indented at least 2 spaces more than the
 * task are its continuation (standard Markdown list-item continuation). Returns, for each
 * line, the index of the task it continues, or -1.
 */
export function owners(lines: string[]): number[] {
  const out = new Array<number>(lines.length).fill(-1)
  let owner = -1
  let need = 0
  lines.forEach((l, i) => {
    const info = classify(l)
    if (info.kind === 'task') {
      owner = i
      need = info.indent.length + 2
    } else if (owner >= 0 && info.kind !== 'group' && info.indent.length >= need) {
      // also a whitespace-only line: the fresh line right after ⇧↵, before anything is typed
      out[i] = owner
    } else {
      owner = -1
    }
  })
  return out
}

export const continuationIndent = (taskIndent: string) => taskIndent + '  '

/** First and last line of the unit (task + continuation lines) containing line `i`. */
export function unitRange(lines: string[], i: number, own = owners(lines)): [number, number] {
  const s = own[i] >= 0 ? own[i] : i
  let e = s
  while (e + 1 < lines.length && own[e + 1] === s) e++
  return [s, e]
}

/** Move lines s..e so they end up before original index `to`. */
export function relocateRange(lines: string[], s: number, e: number, to: number, cursor = s): MoveResult | null {
  if (to >= s && to <= e + 1) return null
  const out = lines.slice()
  const block = out.splice(s, e - s + 1)
  const at = to > e ? to - block.length : to
  out.splice(at, 0, ...block)
  return { lines: out, index: at + (cursor - s) }
}

/**
 * Where the item containing line `i` goes when nudged up/down. Crossing a group header moves
 * it to the end of the previous group / top of the next one, skipping blank separators.
 */
export function itemTarget(lines: string[], i: number, dir: -1 | 1, hidden: Hidden = () => false): number | null {
  const own = owners(lines)
  const [s, e] = unitRange(lines, i, own)
  const start = (j: number) => unitRange(lines, j, own)[0]
  const after = (j: number) => (kindAt(lines, j) === 'group' ? j + 1 : unitRange(lines, j, own)[1] + 1)
  if (dir < 0) {
    const p = prevVisible(lines, s, hidden)
    if (p < 0) return null
    const pk = kindAt(lines, p)
    if (pk === 'group' || pk === 'blank') {
      const q = prevVisible(lines, p, hidden, true)
      if (q < 0) return pk === 'blank' ? p : null
      if (pk === 'blank' && kindAt(lines, q) !== 'group') return start(q)
      return after(q)
    }
    return start(p)
  }
  const n = nextVisible(lines, e, hidden)
  if (n < 0) return null
  const nk = kindAt(lines, n)
  if (nk === 'group') return n + 1
  if (nk === 'blank') {
    const k = nextVisible(lines, n, hidden, true)
    if (k < 0) return null
    return after(k)
  }
  return after(n)
}

export function moveItem(lines: string[], i: number, dir: -1 | 1, hidden: Hidden = () => false): MoveResult | null {
  const to = itemTarget(lines, i, dir, hidden)
  if (to === null) return null
  const [s, e] = unitRange(lines, i)
  return relocateRange(lines, s, e, to, i)
}

/** Drop target for an item when dropped before index `to`: snap above blank separators of a header. */
export function snapItemDrop(lines: string[], to: number): number {
  if (to < lines.length && kindAt(lines, to) === 'group') {
    while (to > 0 && kindAt(lines, to - 1) === 'blank') to--
  }
  return to
}

// ---------- groups ----------

export interface Sections {
  pre: string[]
  groups: string[][]
  trailingNewline: boolean
}

export function splitSections(lines: string[]): Sections {
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === ''
  const body = trailingNewline ? lines.slice(0, -1) : lines
  const pre: string[] = []
  const groups: string[][] = []
  for (const l of body) {
    if (kindAt([l], 0) === 'group') groups.push([l])
    else if (groups.length) groups[groups.length - 1].push(l)
    else pre.push(l)
  }
  return { pre, groups, trailingNewline }
}

const trimEnd = (ls: string[]) => {
  let n = ls.length
  while (n > 0 && ls[n - 1].trim() === '') n--
  return ls.slice(0, n)
}

/** Rebuild the document, normalising separators between groups to a single blank line. */
export function joinSections(s: Sections): string[] {
  const out: string[] = []
  const pre = trimEnd(s.pre)
  if (pre.length) out.push(...pre)
  for (const g of s.groups) {
    if (out.length) out.push('')
    out.push(...trimEnd(g))
  }
  if (s.trailingNewline) out.push('')
  return out
}

/** Index of the group a line belongs to (-1 = before the first group). */
export function groupIndexOf(lines: string[], i: number): number {
  let g = -1
  for (let j = 0; j <= i && j < lines.length; j++) if (kindAt(lines, j) === 'group') g++
  return g
}

/** Move group number `g` so it lands before group `to` (0..groups.length). */
export function moveGroupTo(lines: string[], g: number, to: number): MoveResult | null {
  const s = splitSections(lines)
  if (g < 0 || g >= s.groups.length || to < 0 || to > s.groups.length || to === g || to === g + 1) return null
  const groups = s.groups.slice()
  const [moved] = groups.splice(g, 1)
  const at = to > g ? to - 1 : to
  groups.splice(at, 0, moved)
  const out = joinSections({ ...s, groups })
  let index = 0
  let seen = -1
  for (let j = 0; j < out.length; j++) {
    if (kindAt(out, j) === 'group' && ++seen === at) {
      index = j
      break
    }
  }
  return { lines: out, index }
}

export function moveGroup(lines: string[], headerLine: number, dir: -1 | 1): MoveResult | null {
  const g = groupIndexOf(lines, headerLine)
  return moveGroupTo(lines, g, dir < 0 ? g - 1 : g + 2)
}

/** Count of completed tasks per group header line index. */
export function doneCounts(lines: string[]): Map<number, number> {
  const out = new Map<number, number>()
  let header = -1
  lines.forEach((l, i) => {
    const info = classify(l)
    if (info.kind === 'group') {
      header = i
      out.set(i, 0)
    } else if (info.kind === 'task' && info.done && header >= 0) {
      out.set(header, out.get(header)! + 1)
    }
  })
  return out
}
