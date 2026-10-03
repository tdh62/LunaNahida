package main

import (
	"context"
	"log"
	"lunanahida/backend"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
)

func main() {
	// go run places the executable in a temporary directory; locate the module explicitly.
	if os.Getenv("LUNANAHIDA_CONVERTER") == "" {
		name := "LunaNahida.Converter"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		path, _ := filepath.Abs(filepath.Join("bin", "converter", "modules", "music-restore", name))
		_ = os.Setenv("LUNANAHIDA_CONVERTER", path)
	}
	store, err := backend.Open("")
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	api := backend.NewAPI(store, backend.Dialogs{})
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	api.RunScans(ctx, nil)
	port := os.Getenv("LUNANAHIDA_API_PORT")
	if port == "" {
		port = "8787"
	}
	server := &http.Server{Addr: "127.0.0.1:" + port, Handler: api.Handler()}
	go func() { <-ctx.Done(); _ = server.Shutdown(context.Background()) }()
	log.Printf("LunaNahida development API on %s", server.Addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
