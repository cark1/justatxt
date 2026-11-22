import { describe, expect, it } from 'vitest'
import { classify, doneCounts, findLinks, isUrl, moveGroup, moveItem, owners, snapItemDrop, toggleTask } from './model'

const doc = (s: string) => s.split('\n')
const text = (ls: string[]) => ls.join('\n')

describe('classify', () => {
  it('recognises groups, tasks, text', () => {
    expect(classify('# Lavoro').kind).toBe('group')
    expect(classify('#Titolo')).toMatchObject({ kind: 'group', prefixLen: 1 })
    expect(classify('#')).toMatchObject({ kind: 'group', prefixLen: 1 })
    expect(classify('####### troppi').kind).toBe('text')
    expect(classify('- [ ] a')).toMatchObject({ kind: 'task', done: false, prefixLen: 6 })
    expect(classify('- [x] a')).toMatchObject({ kind: 'task', done: true })
    expect(classify('[] a')).toMatchObject({ kind: 'task', prefixLen: 3 })
    expect(classify('[ ] a').kind).toBe('task')
    expect(classify('- [ ]').kind).toBe('task')
    expect(classify('[link](http://x.y) dopo').kind).toBe('text')
    expect(classify('[x](http://x.y)').kind).toBe('text')
    expect(classify('   ').kind).toBe('blank')
  })
})

describe('toggleTask', () => {
  it('toggles only the mark', () => {
    expect(toggleTask('- [ ] a [b](c)')).toBe('- [x] a [b](c)')
    expect(toggleTask('- [X] a')).toBe('- [ ] a')
    expect(toggleTask('[] a')).toBe('[x] a')
    expect(toggleTask('  - [ ] a')).toBe('  - [x] a')
  })
})

describe('links', () => {
  it('finds markdown and bare links', () => {
    const l = findLinks('leggi [articolo](https://a.com/x) e https://b.com.')
    expect(l.map((x) => x.url)).toEqual(['https://a.com/x', 'https://b.com'])
    expect(l[0]).toMatchObject({ from: 6, labelFrom: 7, labelTo: 15, markdown: true })
  })
  it('isUrl', () => {
    expect(isUrl('https://x.com/a?b=1')).toBe(true)
    expect(isUrl('www.x.com')).toBe(true)
    expect(isUrl('hello world')).toBe(false)
  })
})

const D = `# A
- [ ] a1
- [ ] a2

# B
- [ ] b1
`

describe('moveItem', () => {
  it('swaps within a group', () => {
    const r = moveItem(doc(D), 2, -1)!
    expect(text(r.lines)).toBe(`# A\n- [ ] a2\n- [ ] a1\n\n# B\n- [ ] b1\n`)
    expect(r.index).toBe(1)
  })
  it('moves up across a header to end of previous group', () => {
    const r = moveItem(doc(D), 5, -1)!
    expect(text(r.lines)).toBe(`# A\n- [ ] a1\n- [ ] a2\n- [ ] b1\n\n# B\n`)
    expect(r.index).toBe(3)
  })
  it('moves down across blank+header to top of next group', () => {
    const r = moveItem(doc(D), 2, 1)!
    expect(text(r.lines)).toBe(`# A\n- [ ] a1\n\n# B\n- [ ] a2\n- [ ] b1\n`)
    expect(r.index).toBe(4)
  })
  it('stops at the top', () => {
    expect(moveItem(doc(D), 1, -1)).toBeNull()
  })
  it('skips hidden lines', () => {
    const ls = doc(`# A\n- [ ] a\n- [x] done\n- [ ] b`)
    const r = moveItem(ls, 3, -1, (i) => i === 2)!
    expect(text(r.lines)).toBe(`# A\n- [ ] b\n- [ ] a\n- [x] done`)
  })
})

describe('groups', () => {
  it('moves a group up and normalises separators', () => {
    const r = moveGroup(doc(D), 4, -1)!
    expect(text(r.lines)).toBe(`# B\n- [ ] b1\n\n# A\n- [ ] a1\n- [ ] a2\n`)
    expect(r.index).toBe(0)
  })
  it('moves a group down', () => {
    const r = moveGroup(doc(D), 0, 1)!
    expect(text(r.lines)).toBe(`# B\n- [ ] b1\n\n# A\n- [ ] a1\n- [ ] a2\n`)
    expect(r.index).toBe(3)
  })
  it('no-op at edges', () => {
    expect(moveGroup(doc(D), 0, -1)).toBeNull()
    expect(moveGroup(doc(D), 4, 1)).toBeNull()
  })
  it('snaps item drops above separators', () => {
    expect(snapItemDrop(doc(D), 4)).toBe(3)
  })
  it('counts done tasks per group', () => {
    expect([...doneCounts(doc(`# A\n- [x] a\n- [x] b\n# B\n- [ ] c`))]).toEqual([
      [0, 2],
      [3, 0]
    ])
  })
})

describe('continuation lines', () => {
  const C = `# A
- [ ] uno
  seconda riga
  terza riga
- [ ] due
  testo libero indentato? no: continua due

nota`
  it('detects owners', () => {
    expect(owners(doc(C))).toEqual([-1, -1, 1, 1, -1, 4, -1, -1])
    expect(owners(doc('- [ ] a\nnon indentata'))).toEqual([-1, -1])
  })
  it('moves a multi-line item as a block', () => {
    const r = moveItem(doc(C), 4, -1)!
    expect(text(r.lines).split('\n').slice(0, 6)).toEqual([
      '# A',
      '- [ ] due',
      '  testo libero indentato? no: continua due',
      '- [ ] uno',
      '  seconda riga',
      '  terza riga'
    ])
    expect(r.index).toBe(1)
  })
  it('moving from a continuation line moves the whole item and keeps the cursor line', () => {
    const r = moveItem(doc(C), 3, 1)!
    expect(text(r.lines).split('\n').slice(1, 6)).toEqual([
      '- [ ] due',
      '  testo libero indentato? no: continua due',
      '- [ ] uno',
      '  seconda riga',
      '  terza riga'
    ])
    expect(r.index).toBe(5)
  })
})

describe('fresh continuation line', () => {
  it('a whitespace-only line right after shift+enter belongs to the item', () => {
    expect(owners(['- [ ] a', '  '])).toEqual([-1, 0])
    expect(owners(['- [ ] a', ''])).toEqual([-1, -1])
  })
})
