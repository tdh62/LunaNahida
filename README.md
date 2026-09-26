# Luma Tune

Windows desktop music player built with React, Go, SQLite, and Wails v3 beta.26.

## Requirements

- Go 1.26.8 (or Go 1.23+ with toolchain auto-download)
- Node.js and pnpm 10.14.0 via Corepack
- WebView2 on Windows

## Development

`corepack pnpm install --frozen-lockfile` installs the frontend dependencies.
`corepack pnpm dev` starts the local Go API on `127.0.0.1:8787` and Vite on `127.0.0.1:8080`.
The browser preview uses the same Go API as the desktop app. Native dialogs and true file paths require Wails; in the browser preview, enter an absolute folder path in Settings.

## Desktop build

`corepack pnpm build:desktop` writes `bin/LumaTune.exe`. The executable embeds `dist` and serves the Go API inside the Wails asset handler. It does not open a network API port.

By default, data is stored in the local user cache directory under `LumaTune/data/library.db` and `LumaTune/cache/covers`. `LUMA_TUNE_DATA_DIR` overrides the root for development. SQLite contains library metadata, playlists, favorites, playback history, queue, settings, watched folders, and music information cache.

On first launch the library is empty. Add files through the desktop dialog or drop them into the window. The default action asks whether to play only this time, add to the library, or watch the containing folder. Settings include startup scans, manual scans, and optional scheduled scans. Missing files remain in the library and can be rediscovered when they return.
