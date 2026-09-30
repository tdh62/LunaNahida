# Project Notes

LunaNahida is a React interface packaged by Wails v3. Go owns the local music library, native paths, scanning, media streaming, external music information, and SQLite persistence. Browser development can connect to Go through Vite's `/api` proxy. A standalone Web build also supports session-only file playback without Go. Detect native capabilities and backend availability separately. Browser-selected or dropped files must never be imported into the backend library.

The production app starts with an empty library. Do not add demonstration songs, synthetic audio, or browser-only persistent music data. Images are stored under the application's local cache directory; configuration and metadata are stored in SQLite.
