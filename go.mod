module lunanahida

go 1.26.8

require github.com/wailsapp/wails/v3 v3.0.0-beta.26

require (
	github.com/bogem/id3v2/v2 v2.1.4
	github.com/dhowden/tag v0.0.0-20240417053706-3d75831295e8
	github.com/go-flac/flacpicture v0.3.0
	github.com/go-flac/flacvorbis v0.2.0
	github.com/go-flac/go-flac v1.0.0
	github.com/longbridgeapp/opencc v0.3.13
	go.uber.org/zap v1.27.0
	golang.org/x/text v0.42.0
	modernc.org/sqlite v1.59.0
	unlock-music.dev/cli v0.0.0
)

replace unlock-music.dev/cli => ./third_party/unlock-music

require (
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/liuzl/cedar-go v0.0.0-20170805034717-80a9c64b256d // indirect
	github.com/liuzl/da v0.0.0-20180704015230-14771aad5b1d // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/samber/lo v1.47.0 // indirect
	go.uber.org/multierr v1.11.0 // indirect
	golang.org/x/crypto v0.53.0 // indirect
	golang.org/x/exp v0.0.0-20260410095643-746e56fc9e2f // indirect
	golang.org/x/sys v0.47.0 // indirect
	google.golang.org/protobuf v1.35.2 // indirect
	modernc.org/libc v1.75.7 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
	unlock-music.dev/mmkv v0.1.0 // indirect
)
