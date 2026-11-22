import { app, shell } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

// ---------- data folder (default ~/Desktop/justatxt, user-selectable) ----------

let customDir: string | null = null
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

export function dataDir(): string {
  return customDir ?? path.join(app.getPath('desktop'), 'justatxt')
}

export async function loadSettings(): Promise<void> {
  try {
    const s = JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
    if (typeof s.dataDir === 'string' && s.dataDir) customDir = s.dataDir
  } catch {}
}

/** The folder the user picked becomes the parent of "justatxt" (unless it already is a "justatxt" folder). */
export function dataDirFor(chosen: string): string {
  return path.basename(chosen) === 'justatxt' ? chosen : path.join(chosen, 'justatxt')
}

export async function setDataDir(dir: string): Promise<void> {
  customDir = dir
  await fs.writeFile(settingsFile(), JSON.stringify({ dataDir: dir }))
  await ensureDir()
}

/** Move a file into `destDir`, never overwriting; works across volumes. Returns the new path. */
export async function moveFile(src: string, destDir: string): Promise<string> {
  const base = path.basename(src).replace(/\.txt$/i, '')
  let dest = path.join(destDir, `${base}.txt`)
  for (let i = 2; await fs.stat(dest).then(() => true, () => false); i++) dest = path.join(destDir, `${base}-${i}.txt`)
  try {
    await fs.rename(src, dest)
  } catch (e: any) {
    if (e.code !== 'EXDEV') throw e
    await fs.copyFile(src, dest)
    await fs.unlink(src)
  }
  return dest
}

export async function ensureDir(): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true })
}

export function displayName(p: string): string {
  return path.basename(p).replace(/\.txt$/i, '')
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

/** Creates an empty file named after the current date/time, never overwriting. */
export async function createFile(): Promise<string> {
  await ensureDir()
  const base = stamp()
  for (let i = 1; ; i++) {
    const p = path.join(dataDir(), `${i === 1 ? base : `${base}-${i}`}.txt`)
    try {
      await fs.writeFile(p, '', { flag: 'wx' })
      return p
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e
    }
  }
}

export async function readFile(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch (e: any) {
    if (e.code === 'ENOENT') return ''
    throw e
  }
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(p: string, content: string): Promise<void> {
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.tmp`)
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, p)
}

export interface FileEntry {
  path: string
  name: string
  mtime: number
}

export async function listFiles(): Promise<FileEntry[]> {
  await ensureDir()
  const names = await fs.readdir(dataDir())
  const entries = await Promise.all(
    names
      .filter((n) => !n.startsWith('.') && n.toLowerCase().endsWith('.txt'))
      .map(async (n) => {
        const p = path.join(dataDir(), n)
        const st = await fs.stat(p).catch(() => null)
        return st ? { path: p, name: displayName(p), mtime: st.mtimeMs } : null
      })
  )
  return entries.filter((e): e is FileEntry => !!e).sort((a, b) => b.mtime - a.mtime)
}

export function sanitizeName(name: string): string {
  return name
    .replace(/\.txt$/i, '')
    .replace(/[/:\\\u0000-\u001f]/g, '-')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120)
}

export async function renameFile(oldPath: string, newName: string): Promise<string> {
  const clean = sanitizeName(newName)
  if (!clean) throw new Error('Invalid name')
  const next = path.join(path.dirname(oldPath), `${clean}.txt`)
  if (next === oldPath) return oldPath
  // Case-only renames on case-insensitive volumes are fine; anything else must not clobber.
  const exists = await fs.stat(next).then(() => true, () => false)
  if (exists && next.toLowerCase() !== oldPath.toLowerCase()) throw new Error('A file with this name already exists')
  await fs.rename(oldPath, next)
  return next
}

export async function trashFile(p: string): Promise<void> {
  await shell.trashItem(p).catch(() => fs.unlink(p).catch(() => {}))
}

export async function deleteFile(p: string): Promise<void> {
  await fs.unlink(p).catch(() => {})
}
