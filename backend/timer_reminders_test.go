package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestTimerRemindersAPIAndPersistence(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, Dialogs{})
	handler := api.Handler()
	put := func(body string) int {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, "/api/timer/reminders", bytes.NewBufferString(body)))
		return recorder.Code
	}
	for _, body := range []string{`{"sound":"unknown","volume":60}`, `{"sound":"chime","volume":101}`, `{"sound":"bell","volume":-1}`} {
		if put(body) != 400 {
			t.Fatal("invalid reminder accepted", body)
		}
	}
	if put(`{"soundEnabled":true,"sound":"bell","volume":42,"notificationEnabled":true}`) != 200 {
		t.Fatal("save failed")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	settings, err := store.timerReminders()
	if err != nil || settings != (timerReminders{true, "bell", 42, true}) {
		t.Fatal(settings, err)
	}
}

func TestTimerAlertsOnlyOnceAndOnlyWhenCompleted(t *testing.T) {
	store := testStore(t)
	api := NewAPI(store, Dialogs{})
	var sent atomic.Int32
	api.AuthorizeTimerNotification = func() (bool, error) { return true, nil }
	api.SendTimerNotification = func(int64) error { sent.Add(1); return errors.New("notification unavailable") }
	handler := api.Handler()
	post := func(path, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body)))
		return recorder
	}
	if post("/api/timer/notification/authorize", "").Code != 200 {
		t.Fatal("authorization failed")
	}
	now := time.Now().UnixMilli()
	state, err := store.workTimerAt(context.Background(), workTimerInput("start", "countdown", 1000, 0), now-2000)
	if err != nil {
		t.Fatal(err)
	}
	if post("/api/timer/alert", `{"startedAt":1}`).Code != 409 {
		t.Fatal("wrong run accepted")
	}
	_, err = store.DB.Exec(`INSERT INTO preferences(key,value) VALUES('timer_reminders','{"sound":"chime","volume":60,"notificationEnabled":true}')`)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"startedAt": state.StartedAt, "desktopNotification": true})
	var claimed atomic.Int32
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() {
			response := post("/api/timer/alert", string(body))
			var result struct {
				Claimed           bool   `json:"claimed"`
				NotificationError string `json:"notificationError"`
			}
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
				t.Error(response.Body.String())
				return
			}
			if result.Claimed {
				claimed.Add(1)
				if result.NotificationError == "" {
					t.Error("notification failure missing")
				}
			}
		})
	}
	workers.Wait()
	if claimed.Load() != 1 || sent.Load() != 1 {
		t.Fatal("duplicate alerts", claimed.Load(), sent.Load())
	}
	state, err = store.workTimerAt(context.Background(), nil, now)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.workTimerAt(context.Background(), workTimerInput("reset", "", 0, state.Revision), now)
	if err != nil {
		t.Fatal(err)
	}
	if post("/api/timer/alert", string(body)).Code != 409 {
		t.Fatal("reset run alerted")
	}
}
