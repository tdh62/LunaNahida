package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"lunanahida/backend"
)

//go:embed all:dist
var frontend embed.FS

//go:embed build/appicon.png
var appIcon []byte

func main() {
	dataRoot, browserPath, err := desktopPaths()
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
	var api *backend.API
	var apiHandler http.Handler
	app := application.New(application.Options{
		Name: "LunaNahida",
		Icon: appIcon,
		Windows: application.WindowsOptions{
			WebviewUserDataPath: filepath.Join(store.Root, "cache", "webview"),
			WebviewBrowserPath:  browserPath,
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
	})
	apiHandler = api.Handler()
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "LunaNahida", Width: 1280, Height: 800,
		MinWidth: 900, MinHeight: 600, EnableFileDrop: true, URL: "/",
	})
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
