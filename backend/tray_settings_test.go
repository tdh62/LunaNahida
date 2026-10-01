package backend

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestTraySettingsDefaultPersistenceAndNotification(t *testing.T) {
	store := testStore(t)
	settings, err := store.Settings()
	if err != nil || settings.TrayEnabled {
		t.Fatalf("tray must default to disabled: %+v, %v", settings, err)
	}
	api := NewAPI(store, Dialogs{})
	var changes []bool
	api.SettingsChanged = func(value Settings) {
		persisted, err := store.Settings()
		if err != nil || persisted.TrayEnabled != value.TrayEnabled {
			t.Fatal("settings callback ran before persistence", err)
		}
		changes = append(changes, value.TrayEnabled)
	}
	handler := api.Handler()
	for _, enabled := range []bool{true, false} {
		settings.TrayEnabled = enabled
		payload, _ := json.Marshal(settings)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("PUT", "/api/settings", bytes.NewReader(payload)))
		if response.Code != 200 {
			t.Fatal(response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("PUT", "/api/settings", bytes.NewBufferString(`{"trayEnabled":"invalid"}`)))
	if response.Code != 400 || len(changes) != 2 || !changes[0] || changes[1] {
		t.Fatal("invalid settings must not change the tray", changes, response.Code)
	}
	if _, err := store.DB.Exec(`UPDATE preferences SET value='{"theme":"forest"}' WHERE key='settings'`); err != nil {
		t.Fatal(err)
	}
	settings, err = store.Settings()
	if err != nil || settings.TrayEnabled {
		t.Fatal("upgrading old settings must keep tray disabled", err)
	}
}
