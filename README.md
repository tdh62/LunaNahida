# LunaNahida

Windows desktop music player built with React, Go, SQLite, and Wails v3 beta.26.

设置提供分类导航和搜索；支持恢复上次曲库歌曲与播放位置、组合筛选及排序、每首歌的歌词时间校准、自动备份和恢复记录。新建或编辑歌单时可选择条件歌单，符合用户设置条件的歌曲会自动收录。详见 [产品改进与使用说明](docs/product-improvements.md)。

**设置 → 桌面窗口 → 最小化到系统托盘** is disabled by default. Enabling it immediately adds a tray icon; minimising either the main or mini player hides the window while music/noise continues. Click the tray icon to restore the window, or right-click for playback controls and **退出**. Closing the window still exits the app. The preference is saved across restarts. Media Session metadata follows the current title, artist, album and displayed cover, with play/pause, track changes and seeking available to the system. On Windows WebView2, the system reads the title, artist (the secondary display line) and thumbnail; its separate Subtitle and AlbumTitle fields may remain empty.

## Requirements

- Go 1.26.8 (or Go 1.23+ with toolchain auto-download)
- Node.js and pnpm 10.14.0 via Corepack
- WebView2 on Windows

## Development

The toolbox includes **计时器** with a stopwatch, countdown, focus/break presets, pause, resume and reset. Its start time and state are saved in the existing SQLite database; reopening the app counts time spent closed unless paused, and elapsed countdowns restore as completed. An active timer adds a button beside the toolbox entry with a hover preview and direct access to the non-modal timer window. Timing and completion never change music/noise playback or the queue. See `docs/work-timer.md` for persistence and behavior details.

The expanded spectrum view has its own **显示标准音阶** switch and **标记数量** slider (4–128, default 24), without visiting Settings. Markers follow the visible frequency range using equal temperament with A4 = 440 Hz; A4 stays highlighted whenever it is in range. The requested count is a maximum, labels use two collision-free rows on narrow charts, and pointer readouts still identify any frequency's nearest note. Visibility and count are remembered in local storage across view changes and restarts, separately from backend playback settings.

Song lists provide **定位当前播放** to bring the current track into view without changing playback, the queue, or multi-selection. This is available in the library, favorites, recent tracks, playlist/artist/album song lists, and both queue panels. The button is disabled when the current track is absent from the displayed search/tag results. Large song lists reserve the full filtered list height immediately and only render the viewport with overscan, so scrolling or jumping to a distant track does not grow the scrollbar in batches. Returning to the playback page immediately centers the current lyric before the page is painted, clears any previous manual-browsing delay, and then resumes the selected lyric scrolling style.

The toolbox entry opens an application menu. Choose a tool card to open its dedicated panel, and use **返回工具箱** to return to the menu. New tools are listed through the toolbox application registry rather than adding tabs. The menu shows pending conversion files and active noise status; imported encrypted audio still opens format restoration directly.

The toolbox includes **曲库整理** with independent template renaming, artist-folder filing, duplicate cleanup, and multi-folder consolidation. Every operation requires a preview and confirmation. Matching lyrics and images follow the audio; destination conflicts never overwrite files. Duplicate versions require a retention choice and are moved to a recovery folder instead of being permanently deleted. See `docs/music-organizer.md` for behavior, safety, and recovery details.

Organizer previews stream scan progress (discovered/processed tracks, current file, bytes and percentage) and can be canceled without modifying files. Deduplication offers optional **快速匹配** using fresh library metadata, or matching filenames and sizes when no usable metadata is cached, without opening audio or sidecar contents. All quick matches remain unverified candidates and require a retention choice. Full content checks remain the default; execution still verifies copied files, and directory sidecar indexes are reused for large collections.

The toolbox also includes **噪音发生器** for continuous white, pink, and brown noise. Its panel does not block the page, and closing it keeps noise playing in the background. Noise and music never play together; the original music queue, selection, and position are retained. The main playback button, volume controls, media shortcuts, and sleep timer also control noise. Stop noise to manually resume music, or select a song to switch back to music. See `docs/noise-generator.md`.

`corepack pnpm install --frozen-lockfile` installs the frontend dependencies.
`corepack pnpm dev` starts the local Go API on `127.0.0.1:8787` and Vite on `127.0.0.1:8080`.
The browser preview uses the same Go API as the desktop app. Browser-selected or dropped songs play only in the current session and never enter the backend library. Native dialogs and true file paths require Wails; to manage watched folders in the browser preview, enter a folder path accessible to the Go backend in Settings.

## Standalone Web

`corepack pnpm dev:web` runs the frontend without a Go API proxy. `corepack pnpm build:web` writes the static frontend to `dist`; `corepack pnpm preview` serves it at `http://127.0.0.1:8082` without proxying to Go.

Standalone Web supports temporary local file playback, queue ordering, audio effects, spectrum, appearance settings, noise (where supported), sleep timing, and a session-only work timer. Library management, native paths, scanning, conversion, organization, online music services, backend caches and backups are disabled. Refreshing clears temporary files and the session timer; no browser music database is created. Static hosting needs an `index.html` fallback for application routes. See `docs/web-mode.md` for the capability matrix and verification commands.

## Desktop build

The playback bar's **迷你模式** icon switches the Wails window to a 400 x 168 player without a title bar, showing the cover, track information and essential controls. Drag the header to move it, optionally pin it above other windows, and use **退出迷你模式** or Escape to restore the previous full window. Playback continues through both transitions. The entry is absent in browsers. See `docs/mini-mode.md`.

`corepack pnpm build:desktop` writes `bin/LunaNahida.exe`. The executable embeds `dist` and serves the Go API inside the Wails asset handler. It does not open a network API port.

Packaged Windows desktop and portable builds use the GUI subsystem and do not show a command window. Application and Wails logs are written to `logs` inside the application data directory (`%LOCALAPPDATA%/LunaNahida` by default, `userdata` beside the portable executable, or `LUNANAHIDA_DATA_DIR` for a custom desktop path). The active `app.log` rotates daily or at 1 MiB and is gzip-compressed on rotation and normal exit. Archives are cleaned at startup, rotation, and hourly: files older than 30 days are deleted, then the oldest files are deleted until their combined compressed size is at most 10 MiB. The current uncompressed log is limited to 1 MiB in addition to that archive budget.

To build a portable package, first place the Microsoft WebView2 Fixed Version Runtime for Windows x64 in `resources/WebView2`. This locally supplied runtime is not tracked in Git. `corepack pnpm build:portable` writes `bin/portable/LunaNahida.exe` and copies the runtime into `bin/portable/WebView2`. Move the whole `bin/portable` folder together. Any `.cab` source archive in `resources` is not included in the package. This build requires Windows x64.

The portable build stores its SQLite database, artwork cache, and WebView profile in `bin/portable/userdata` beside the executable. Run it from a writable folder; `userdata` is created on first launch. Keep `userdata` when updating the executable and runtime. Music files remain at their original paths, so moving the package separately from the music may require adding the new folders again. The portable build ignores `LUNANAHIDA_DATA_DIR` to keep its data beside the executable.

The standard desktop build stores data in the local user cache directory under `LunaNahida/data/library.db` and `LunaNahida/cache/covers`. `LUNANAHIDA_DATA_DIR` overrides the root for development. SQLite contains library metadata, playlists, favorites, playback history, queue, settings, watched folders, and music information cache. New libraries start with the light forest theme.

On first launch the library is empty. Add files through the desktop dialog or drop them into the window. The default action asks whether to play only this time, add to the library, or watch the containing folder. Settings include startup scans, manual scans, and optional scheduled scans. Missing files remain in the library and can be rediscovered when they return.

Use **网络歌曲** in the sidebar to open a single HTTP(S) audio file URL. In **设置 → 网络音乐库**, add WebDAV, FTP, or explicit FTPS folders, or an HTTP(S) M3U/M3U8 playlist. Network folders are scanned recursively (up to 5,000 audio files); HTTP playlists support up to 1,000 HTTP(S) audio URLs and relative paths. Existing songs remain in the library when a scan cannot reach a source. FTP passwords are protected with Windows DPAPI in the local database. FTP is unencrypted; use FTPS or HTTPS WebDAV for private accounts. Network audio is played through the local API with seeking, and the latest N played songs can be cached in **设置 → 缓存空间**. Direct URL query strings are saved locally with the song, so expiring links may need to be reopened.

Settings can retain complete copies of the most recently played 0, 5, 10, 20, 30, or 50 network songs (10 by default; 512 MB maximum per song). The network audio cache can be cleared separately, and the general cache action clears it too. Cached songs remain playable when the network is unavailable. The source is checked periodically when online; a changed source invalidates its cached copy.

Embedded artwork and lyrics are read from supported audio tags during import and scanning, and take priority over online metadata. Existing library entries are checked once after this upgrade. A sidecar `.lrc` file is used when the audio file has no embedded lyrics.

Cover files use their MD5 digest as the cache key, so identical downloads reuse one file. Settings shows image, WebView, and online metadata cache sizes. Clearing cache removes downloadable artwork and metadata, retains embedded and custom playlist artwork, and clears the WebView profile on the next launch.

Playlist covers can follow the first track's current artwork or use a fixed uploaded image. Existing playlists are upgraded to the first-track mode so refreshed artwork appears immediately; their previously saved cover path remains available in the playlist editor for selection as a fixed image.
