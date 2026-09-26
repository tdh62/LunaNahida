# Project Notes

Luma Tune is a React interface packaged by Wails v3. Go owns the local music library, native paths, scanning, media streaming, external music information, and SQLite persistence. The browser is a development preview only; Vite proxies `/api` to the loopback Go development server.

The production app starts with an empty library. Do not add demonstration songs, synthetic audio, or browser-only persistent music data. Images are stored under the application's local cache directory; configuration and metadata are stored in SQLite.
