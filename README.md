# Just a txt

Editor minimale per macOS che vive nella menu bar. Ogni finestra è un file `.txt` nella cartella `justatxt` (di default sulla Scrivania, modificabile dalla menu bar), scritto in Markdown standard:

```
# Gruppo
- [ ] da fare
- [x] fatto
- [ ] leggere [articolo](https://example.com)
- [ ] item su più righe
  seconda riga (⇧ Invio)
```

## Comandi

```bash
npm install
npm run dev      # app in sviluppo (il renderer si apre anche su http://localhost:5173 con dati finti)
npm test         # test della logica (parsing, spostamenti)
npm run dist     # crea dist/Just-a-txt-mac.dmg (universale) senza firma
npm run release  # firma, notarizza e carica una release bozza su GitHub
```

## Scorciatoie e interazioni

| | |
|---|---|
| `#` a inizio riga | nuovo gruppo (lo spazio dopo `#` si aggiunge da solo) |
| `[] ` a inizio riga | nuovo item |
| Invio su un item o un titolo | nuovo item (su item vuoto: riga vuota); altrove va a capo normalmente |
| ⇧ Invio | a capo dentro lo stesso item (riga indentata di 2 spazi) |
| `# ` su un item vuoto | lo trasforma in gruppo |
| Backspace a inizio item | toglie la checkbox |
| ⌘↵ | spunta l'item (o trasforma la riga in item) |
| ⌘↑ / ⌘↓ (o ⌥↑ / ⌥↓) | sposta item; sul titolo sposta l'intero gruppo |
| Maniglia a sinistra (hover) | drag & drop di item e gruppi |
| Seleziona parola + ⌘V di un URL | diventa link; ⌘-clic per aprirlo |
| ⌘N | nuovo file (`YYYY-MM-DD_HHmm.txt`) |
| Clic sul titolo | rinomina il file |
| Icona ☑ in alto a destra | mostra/nasconde i completati |

Chiudere una finestra salva; un file vuoto alla chiusura viene eliminato. L'elenco dei file, "Folder → Change folder…" (sceglie dove creare la cartella `justatxt`, con l'opzione di spostarci i file esistenti) e "Open at login" sono nell'icona della menu bar.

## Struttura

- `src/main` — processo Electron: file su disco, finestre (con una finestra pre-caricata per l'apertura istantanea), tray, watcher delle modifiche esterne.
- `src/preload` — bridge IPC.
- `src/renderer/src/editor` — CodeMirror 6: `model.ts` (logica pura, testata), `decorations.ts` (resa), `commands.ts` (tastiera, incolla), `dragdrop.ts`.

## Rilasciare una nuova versione

1. Aumenta `version` in `package.json` (es. `0.2.0`).
2. `npm run release` — firma con il certificato Developer ID, notarizza (profilo `justatxtnotarytool` di `notarytool`) e carica DMG, zip e `latest-mac.yml` in una **release bozza** su GitHub.
3. Su GitHub controlla la bozza e pubblicala.

Le app installate controllano gli aggiornamenti all'avvio e ogni 6 ore, li scaricano in background e li installano alla chiusura (o subito da "Restart to update" nel menu). Il sito scarica sempre `releases/latest/download/Just-a-txt-mac.dmg`.
