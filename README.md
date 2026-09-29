# LunaNahida

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

`corepack pnpm build:desktop` writes `bin/LunaNahida.exe`. The executable embeds `dist` and serves the Go API inside the Wails asset handler. It does not open a network API port.

To build a portable package, first place the Microsoft WebView2 Fixed Version Runtime for Windows x64 in `resources/WebView2`. This locally supplied runtime is not tracked in Git. `corepack pnpm build:portable` writes `bin/portable/LunaNahida.exe` and copies the runtime into `bin/portable/WebView2`. Move the whole `bin/portable` folder together. Any `.cab` source archive in `resources` is not included in the package. This build requires Windows x64.

The portable build stores its SQLite database, artwork cache, and WebView profile in `bin/portable/userdata` beside the executable. Run it from a writable folder; `userdata` is created on first launch. Keep `userdata` when updating the executable and runtime. Music files remain at their original paths, so moving the package separately from the music may require adding the new folders again. The portable build ignores `LUNANAHIDA_DATA_DIR` to keep its data beside the executable.

The standard desktop build stores data in the local user cache directory under `LunaNahida/data/library.db` and `LunaNahida/cache/covers`. `LUNANAHIDA_DATA_DIR` overrides the root for development. SQLite contains library metadata, playlists, favorites, playback history, queue, settings, watched folders, and music information cache. New libraries start with the light forest theme.

On first launch the library is empty. Add files through the desktop dialog or drop them into the window. The default action asks whether to play only this time, add to the library, or watch the containing folder. Settings include startup scans, manual scans, and optional scheduled scans. Missing files remain in the library and can be rediscovered when they return.

Use **网络歌曲** in the sidebar to open a single HTTP(S) audio file URL. In **设置 → 网络音乐库**, add WebDAV, FTP, or explicit FTPS folders, or an HTTP(S) M3U/M3U8 playlist. Network folders are scanned recursively (up to 5,000 audio files); HTTP playlists support up to 1,000 HTTP(S) audio URLs and relative paths. Existing songs remain in the library when a scan cannot reach a source. FTP passwords are protected with Windows DPAPI in the local database. FTP is unencrypted; use FTPS or HTTPS WebDAV for private accounts. Network audio is played through the local API with seeking, and the latest N played songs can be cached in **设置 → 缓存空间**. Direct URL query strings are saved locally with the song, so expiring links may need to be reopened.

Settings can retain complete copies of the most recently played 0, 5, 10, 20, 30, or 50 network songs (10 by default; 512 MB maximum per song). The network audio cache can be cleared separately, and the general cache action clears it too. Cached songs remain playable when the network is unavailable. The source is checked periodically when online; a changed source invalidates its cached copy.

Embedded artwork and lyrics are read from supported audio tags during import and scanning, and take priority over online metadata. Existing library entries are checked once after this upgrade. A sidecar `.lrc` file is used when the audio file has no embedded lyrics.

Cover files use their MD5 digest as the cache key, so identical downloads reuse one file. Settings shows image, WebView, and online metadata cache sizes. Clearing cache removes downloadable artwork and metadata, retains embedded and custom playlist artwork, and clears the WebView profile on the next launch.

Playlist covers can follow the first track's current artwork or use a fixed uploaded image. Existing playlists are upgraded to the first-track mode so refreshed artwork appears immediately; their previously saved cover path remains available in the playlist editor for selection as a fixed image.
