# Desktop Mini Mode

The **迷你模式** icon in the playback bar opens a 400 x 168 Wails window without a native title bar. The entry is available only in Wails, including when the window is on Settings or a library page. Neither standalone Web nor a browser connected to Go offers this mode.

The compact player shows the current cover, title, artist, elapsed/total time and progress. It provides previous/next, play/pause, seeking, mute and volume. Long titles and artists truncate with their full text available on hover. With an empty queue, playback controls are disabled; restoring the full window remains available.

Drag the header or track information to move the window. Header controls toggle pinning above other windows, restore the full player, minimise or close the application. **退出迷你模式** and Escape restore the full player. The mini window has a fixed size; the full window regains its original resize capability and minimum size.

Switching uses the same Wails window, React player and audio element. It does not reload the page, reset the queue, restart a song or change playback settings. Returning restores the full window's previous dimensions and position, plus its maximised or fullscreen state. Moving the mini window does not move the saved full window. Pinning applies only while mini mode is active and is cleared when returning. Mini mode and pinning are not persisted across application restarts.

Noise playback uses the same compact play/pause and volume controls, with a stop button. Seeking and previous/next are disabled for noise. Timers keep running. Dropping native files into the mini window first restores the full player, where the normal import preference or conversion workflow applies.

Wails may inject its environment after React has started. The runtime provider listens for `wails:runtime-config-ready` and rediscovers desktop capabilities without remounting an already running player.

## Verification

`corepack pnpm test:frontend` covers normal, maximised and fullscreen restoration, repeated transitions, movement/pinning, failed entry rollback and failed exit retry. `corepack pnpm test:web` covers absent browser entries, late Wails environment injection, empty queues, compact playback/volume/seek controls, noise, repeated restoration, unchanged audio streams and bounds without overflow. Its desktop transport is simulated.

Actual Windows Wails verification also passed with an isolated data directory and a temporary test build exposing WebView2 debugging. It checked the real 400 x 168 client area without a title bar, empty mode, playing audio, pinning, ordinary/maximised restoration and screenshot bounds. The production executable does not include that debugging configuration. macOS and Linux native GUI behavior has not been exercised.
