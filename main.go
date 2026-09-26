package main

import (
	"context"
	"embed"
	"log"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"lumatune/backend"
)

//go:embed all:dist
var frontend embed.FS

func main() {
	store, err := backend.Open("")
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var api *backend.API
	app := application.New(application.Options{
		Name: "Luma Tune",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/api/") {
						api.Handler().ServeHTTP(w, r)
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
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Luma Tune", Width: 1280, Height: 800,
		MinWidth: 900, MinHeight: 600, EnableFileDrop: true, URL: "/",
	})
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		app.Event.Emit("luma:files-dropped", event.Context().DroppedFiles())
	})
	api.RunScans(ctx, func(result backend.ScanResult) { app.Event.Emit("luma:scan-complete", result) })
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
