package main

import (
	"context"
	"embed"
	"log"
	"log/slog"
	"net/http"
	"path/filepath"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
	"lunanahida/backend"
	"lunanahida/internal/logging"
)

//go:embed all:dist
var frontend embed.FS

//go:embed build/appicon.png
var appIcon []byte

// Keep playback scheduling active while the window is hidden in the tray.
var desktopBrowserArgs = []string{"--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"}

func main() {
	dataRoot, browserPath, err := desktopPaths()
	dataRoot, rootErr := backend.ResolveDataRoot(dataRoot)
	if rootErr != nil {
		log.Fatal(rootErr)
	}
	logs, logErr := logging.Open(filepath.Join(dataRoot, "logs"))
	if logErr != nil {
		log.Fatal(logErr)
	}
	defer logs.Close()
	log.SetOutput(logs)
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	logger := slog.New(slog.NewTextHandler(logs, nil))
	slog.SetDefault(logger)
	defer func() {
		if value := recover(); value != nil {
			log.Printf("panic: %v\n%s", value, debug.Stack())
			panic(value)
		}
	}()
	if err != nil {
		log.Fatal(err)
	}
	store, err := backend.Open(dataRoot)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	if err := store.ClearPendingWebviewCache(); err != nil {
		log.Printf("webview cache cleanup pending: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := logs.Prune(); err != nil {
					log.Printf("log cleanup: %v", err)
				}
			}
		}
	}()
	log.Print("desktop application starting")
	var api *backend.API
	var apiHandler http.Handler
	notifier := notifications.New()
	app := application.New(application.Options{
		Name:     "LunaNahida",
		Logger:   logger,
		Icon:     appIcon,
		Services: []application.Service{application.NewService(notifier)},
		Windows: application.WindowsOptions{
			AdditionalBrowserArgs: desktopBrowserArgs,
			WebviewUserDataPath:   filepath.Join(store.Root, "cache", "webview"),
			WebviewBrowserPath:    browserPath,
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/api/") {
						apiHandler.ServeHTTP(w, r)
						return
					}
					if pageRoute(r.URL.Path) {
						copy := r.Clone(r.Context())
						url := *r.URL
						url.Path = "/"
						copy.URL = &url
						next.ServeHTTP(w, copy)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
	})
	api = backend.NewAPI(store, backend.Dialogs{
		Files: func() ([]string, error) {
			return app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false).PromptForMultipleSelection()
		},
		Folder: func() (string, error) {
			return app.Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).PromptForSingleSelection()
		},
		Cover: func() (string, error) {
			return app.Dialog.OpenFile().CanChooseFiles(true).CanChooseDirectories(false).SetTitle("选择歌单封面").AddFilter("图片文件", "*.jpg;*.jpeg;*.png;*.webp;*.gif").PromptForSingleSelection()
		},
		BackupSave: func() (string, error) {
			return app.Dialog.SaveFile().SetFilename("LunaNahida-"+time.Now().Format("2006-01-02")+".zip").AddFilter("ZIP 备份", "*.zip").PromptForSingleSelection()
		},
	})
	api.AuthorizeTimerNotification = notifier.RequestNotificationAuthorization
	api.SendTimerNotification = func(startedAt int64) error {
		return notifier.SendNotification(notifications.NotificationOptions{ID: "work-timer-" + strconv.FormatInt(startedAt, 10), Title: "LunaNahida · 倒计时结束", Body: "可以休息一下了。", Sound: &notifications.NotificationSound{Silent: true}})
	}
	apiHandler = api.Handler()
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "LunaNahida", Width: 1280, Height: 800,
		MinWidth: 900, MinHeight: 600, EnableFileDrop: true, URL: "/",
		Frameless: true,
	})
	configureTray(app, window, api)
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		app.Event.Emit("lunanahida:files-dropped", event.Context().DroppedFiles())
		time.AfterFunc(100*time.Millisecond, window.Focus)
	})
	api.RunScans(ctx, func(result backend.ScanResult) { app.Event.Emit("lunanahida:scan-complete", result) })
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

func pageRoute(route string) bool {
	for _, base := range []string{"/settings", "/music", "/liked", "/recent", "/artists", "/albums", "/playlists"} {
		if route == base || strings.HasPrefix(route, base+"/") {
			return true
		}
	}
	return false
}
