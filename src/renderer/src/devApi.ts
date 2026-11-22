import type { Api, Cmd } from '../../preload'

/** In-browser stand-in for the Electron bridge, so the editor can be previewed with `npm run dev` in a browser. */
const SAMPLE = `# Lavoro
- [ ] preparare la demo
- [x] rispondere a Marco
- [ ] leggere [articolo](https://example.com)

# Casa
- [ ] comprare il latte
- [ ] chiamare l'idraulico
`

export function devApi(): Api {
  let handler: ((c: Cmd) => unknown) | null = null
  const w = window as any
  w.__saved = ''
  w.__cmd = (type: Cmd['type'], payload: unknown) => handler?.({ rid: 0, type, payload })
  return {
    ready: () => setTimeout(() => handler?.({ rid: 0, type: 'load', payload: { name: '2026-11-22_2300', content: SAMPLE } })),
    onCmd: (fn) => {
      handler = fn as any
    },
    save: async (c) => {
      w.__saved = c
    },
    rename: async (name) => ({ name }),
    newFile: () => console.log('[dev] new file'),
    closeWindow: () => {},
    openLink: (url) => console.log('[dev] open', url),
    titleMenu: () => console.log('[dev] title menu')
  }
}
