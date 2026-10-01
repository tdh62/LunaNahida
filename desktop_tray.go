package main

import (
	"log"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"lunanahida/backend"
)

func configureTray(app *application.App, window *application.WebviewWindow, api *backend.API) {
	var enabled atomic.Bool
	var mu sync.Mutex
	var tray *application.SystemTray
	restore := func() {
		window.Show()
		window.UnMinimise()
		window.Focus()
	}
	api.SettingsChanged = func(settings backend.Settings) {
		mu.Lock()
		defer mu.Unlock()
		if enabled.Load() == settings.TrayEnabled {
			return
		}
		if settings.TrayEnabled {
			menu := application.NewMenu()
			menu.Add("显示播放器").OnClick(func(*application.Context) { restore() })
			menu.AddSeparator()
			for _, item := range []struct{ label, action string }{{"播放 / 暂停", "toggle"}, {"上一首", "previous"}, {"下一首", "next"}} {
				action := item.action
				menu.Add(item.label).OnClick(func(*application.Context) { app.Event.Emit("lunanahida:media-command", action) })
			}
			menu.AddSeparator()
			menu.Add("退出").OnClick(func(*application.Context) { app.Quit() })
			tray = app.SystemTray.New().SetIcon(appIcon).SetMenu(menu).OnClick(restore).OnDoubleClick(restore)
			tray.OnRightClick(tray.OpenMenu)
			tray.SetTooltip("LunaNahida")
			enabled.Store(true)
		} else {
			enabled.Store(false)
			restore()
			application.InvokeSync(tray.Destroy)
			tray = nil
		}
	}
	window.OnWindowEvent(events.Common.WindowMinimise, func(*application.WindowEvent) {
		mu.Lock()
		defer mu.Unlock()
		if enabled.Load() {
			window.Hide()
		}
	})
	settings, err := api.Store.Settings()
	if err != nil {
		log.Printf("load tray settings: %v", err)
		return
	}
	api.SettingsChanged(settings)
}
