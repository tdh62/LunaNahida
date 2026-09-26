package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist
var frontend embed.FS

func main() {
	app := application.New(application.Options{
		Name: "Luma Tune",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
		},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Luma Tune", Width: 1280, Height: 800,
		MinWidth: 900, MinHeight: 600, EnableFileDrop: true, URL: "/",
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
