# Web Runtime Modes

LunaNahida supports three environments. Backend availability and native dialog support are detected separately at startup through `/api/capabilities` and Wails' injected environment. Merely having a `_wails` JavaScript object does not identify a desktop host.

| Feature | Wails desktop | Browser with Go API | Standalone Web |
| --- | --- | --- | --- |
| Native file selection and drops | Existing path-based import behavior | Browser files play temporarily | Browser files play temporarily |
| Playback, seeking, volume, queue ordering | Available | Available | Available |
| EQ, custom effects, spectrum | Available | Available | Available |
| Library, likes, playlists, tags, history | Stored by Go | Stored by Go for backend songs | Disabled |
| File/folder native dialogs | Available when advertised | Disabled | Disabled |
| Watched paths, scanning | Available | Backend-accessible paths | Disabled |
| Format restoration, organizer | Available | Backend-accessible paths | Disabled |
| Network songs/sources, caches | Available | Available | Disabled |
| Online artwork/lyrics/catalog | Available | Available | Disabled |
| Save lyrics beside audio | For path-based songs | For backend path-based songs | Disabled |
| Edit browser file metadata | Not applicable | Current session only | Current session only |
| Backup import/export | Native export or download | Browser upload/download | Disabled |
| Appearance and audio settings | Stored by Go | Stored by Go | Current session only |
| Work timer | Stored by Go | Stored by Go | Current session only |
| Noise and sleep timer | Available | Available | Available when browser audio support allows |

## Browser Files

- Selection and dropping use `File` objects and object URLs. File contents are never uploaded to Go, and no local absolute path is invented.
- These songs stay in the playback queue, even when the backend's import preference is `library` or `watch`. They cannot be liked, tagged, added to playlists, saved as a playlist, or recorded in backend playback history.
- Names initially come from filenames. Title, artist and album edits affect the session only. Header inspection reads at most 256 KiB per file to identify supported sample rates; browser files never use `/api/media/audio/{id}` for this inspection.
- Removing songs, replacing the queue, clearing it or closing the player releases their object URLs after the audio element releases the loaded source. Repeated live imports reuse a file entry by name, size, modification time and MIME type.
- A batch accepts up to 1,000 files. Empty files, encrypted formats and non-audio files are rejected. Normal audio decoding still depends on the browser; a decoding failure marks that session song unplayable.
- Directory drops are not traversed. Select individual audio files instead. Browser `File` objects are never interpreted as paths for the organizer or converter.
- Refreshing the page clears session songs and the standalone timer. Standalone appearance/audio preferences are not stored as a second persistent configuration. Existing local-storage spectrum note preferences remain independent.

## Startup and Connection Failures

On a static host, a missing API or an HTML SPA fallback selects standalone Web mode with an empty queue. No background library, settings, enrichment, cache or timer API requests are made in that mode.

Wails startup failures and errors from an identified backend show a retry screen. A connected session does not silently change to standalone mode when Go stops responding. Existing music and settings remain in memory; backend requests report failures. Refresh or restart the page after restoring the backend connection. A page that initially selected standalone mode also needs a refresh to detect a newly started backend.

The initial discovery is bounded to five seconds. Native dialogs are enabled only in a desktop host that advertises the corresponding capability. Browser path fields refer to files accessible to the Go process, which may differ from the browser's computer.

## Run and Deploy

```text
corepack pnpm dev          # Browser + local Go API
corepack pnpm dev:web      # Standalone frontend, no API proxy
corepack pnpm build:web    # Static assets in dist
corepack pnpm preview      # Static preview on 127.0.0.1:8082
```

The desktop build continues to embed the same frontend and serve Go through the Wails asset handler. `build:web` does not add a backend server.

Serve `dist` over HTTP(S). Configure the static host to fall back to `index.html` for application routes such as `/settings`; preserve missing-asset and API responses appropriately. Opening `index.html` directly through `file://` is not supported. HTTPS or localhost is required for browser AudioWorklet support. Unsupported noise playback is disabled in the toolbox.

## Verification

```text
corepack pnpm test:frontend
go test ./backend
corepack pnpm exec playwright install chromium
corepack pnpm test:web
```

`test:web` builds the Web frontend, serves it on an ephemeral localhost port, and checks real audio playback/analysis, temporary file selection/drop/cleanup, metadata editing, settings, timer completion, noise, refresh behavior, and absence of unwanted API writes. Backend and desktop transports are simulated; this does not replace a native Wails GUI test. It also verifies explicit startup failure handling and a 390px mobile render. Screenshots are written under `.output/web-compatibility`.

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge instead of downloaded Chromium. Frontend tests require a Node version supporting `--experimental-transform-types` (Node 22.15 or newer).
