package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func workTimerInput(action, mode string, duration, revision int64) *workTimerCommand {
	return &workTimerCommand{Action: action, Mode: mode, DurationMs: duration, Revision: &revision}
}

func TestWorkTimerCountdownSurvivesDatabaseReopen(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	state, err := store.workTimerAt(context.Background(), workTimerInput("start", "countdown", 60000, 0), 100000)
	if err != nil || state.StartedAt != 100000 || state.AnchorAt != 100000 || state.Status != "running" {
		t.Fatalf("start: %+v %v", state, err)
	}
	var raw string
	if err := store.DB.QueryRow(`SELECT value FROM preferences WHERE key=?`, workTimerPreference).Scan(&raw); err != nil || !strings.Contains(raw, `"startedAt":100000`) {
		t.Fatalf("start not saved in SQLite: %s %v", raw, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err = store.workTimerAt(context.Background(), nil, 145000)
	if err != nil || state.Status != "running" || workTimerElapsed(state, 145000) != 45000 || state.StartedAt != 100000 {
		t.Fatalf("reopened: %+v %v", state, err)
	}
	state, err = store.workTimerAt(context.Background(), nil, 170000)
	if err != nil || state.Status != "completed" || state.CompletedAt != 160000 || state.ElapsedMs != 60000 {
		t.Fatalf("offline expiry: %+v %v", state, err)
	}
	revision := state.Revision
	state, err = store.workTimerAt(context.Background(), nil, 300000)
	if err != nil || state.Revision != revision || state.CompletedAt != 160000 {
		t.Fatalf("expiry was written twice: %+v %v", state, err)
	}
}

func TestWorkTimerStopwatchPauseResumeAndReset(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	state, err := store.workTimerAt(ctx, workTimerInput("start", "stopwatch", 0, 0), 100000)
	if err != nil {
		t.Fatal(err)
	}
	state, err = store.workTimerAt(ctx, workTimerInput("pause", "", 0, state.Revision), 115500)
	if err != nil || state.ElapsedMs != 15500 || state.AnchorAt != 0 || state.Status != "paused" {
		t.Fatalf("pause: %+v %v", state, err)
	}
	if workTimerElapsed(state, 200000) != 15500 {
		t.Fatal("paused timer accumulates elapsed time")
	}
	state, err = store.workTimerAt(ctx, workTimerInput("resume", "", 0, state.Revision), 300000)
	if err != nil || state.StartedAt != 100000 || workTimerElapsed(state, 305000) != 20500 {
		t.Fatalf("resume: %+v %v", state, err)
	}
	if workTimerElapsed(state, 299000) != 15500 {
		t.Fatal("clock moving backwards produced negative elapsed time")
	}
	state, err = store.workTimerAt(ctx, workTimerInput("reset", "", 0, state.Revision), 310000)
	if err != nil || state.Status != "idle" || state.StartedAt != 0 || state.ElapsedMs != 0 {
		t.Fatalf("reset: %+v %v", state, err)
	}
}

func TestWorkTimerPausedCountdownSurvivesReopen(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	state, err := store.workTimerAt(context.Background(), workTimerInput("start", "countdown", 10000, 0), 100000)
	if err != nil {
		t.Fatal(err)
	}
	state, err = store.workTimerAt(context.Background(), workTimerInput("pause", "", 0, state.Revision), 103000)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err = store.workTimerAt(context.Background(), nil, 1000000)
	if err != nil || state.Status != "paused" || workTimerElapsed(state, 1000000) != 3000 {
		t.Fatalf("paused reopen: %+v %v", state, err)
	}
	state, err = store.workTimerAt(context.Background(), workTimerInput("resume", "", 0, state.Revision), 1000000)
	if err != nil {
		t.Fatal(err)
	}
	state, err = store.workTimerAt(context.Background(), nil, 1007000)
	if err != nil || state.Status != "completed" || state.CompletedAt != 1007000 || state.StartedAt != 100000 {
		t.Fatalf("resume deadline: %+v %v", state, err)
	}
}

func TestWorkTimerRejectsInvalidAndStaleCommands(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	for _, command := range []*workTimerCommand{workTimerInput("unknown", "", 0, 0), workTimerInput("start", "unknown", 1000, 0), workTimerInput("start", "countdown", 999, 0), workTimerInput("start", "countdown", workTimerMaxDuration+1, 0), workTimerInput("resume", "", 0, 0), workTimerInput("pause", "", 0, 0), {Action: "start", Mode: "stopwatch"}} {
		if _, err := store.workTimerAt(ctx, command, 100000); err == nil {
			t.Fatalf("accepted invalid: %+v", command)
		}
	}
	state, err := store.workTimerAt(ctx, workTimerInput("start", "countdown", 1000, 0), 100000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.workTimerAt(ctx, workTimerInput("start", "stopwatch", 0, state.Revision), 100100); err == nil {
		t.Fatal("replaced active timer")
	}
	if _, err := store.workTimerAt(ctx, workTimerInput("reset", "", 0, 0), 100100); !errors.Is(err, errWorkTimerConflict) {
		t.Fatal("stale revision accepted", err)
	}
	if _, err := store.workTimerAt(ctx, workTimerInput("pause", "", 0, state.Revision), 101000); !errors.Is(err, errWorkTimerConflict) {
		t.Fatal("expired timer paused", err)
	}
	state, err = store.workTimerAt(ctx, nil, 101001)
	if err != nil || state.Status != "completed" {
		t.Fatal("expiry not committed")
	}
	state, err = store.workTimerAt(ctx, workTimerInput("start", "countdown", 5000, state.Revision), 102000)
	if err != nil || state.StartedAt != 102000 || state.CompletedAt != 0 {
		t.Fatal("completed timer restart failed", err)
	}
}

func TestWorkTimerAPI(t *testing.T) {
	store := testStore(t)
	handler := NewAPI(store, Dialogs{}).Handler()
	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/timer", nil))
	var snapshot workTimerResponse
	if get.Code != 200 || json.Unmarshal(get.Body.Bytes(), &snapshot) != nil || snapshot.Timer.Status != "idle" || snapshot.ServerNow <= 0 {
		t.Fatal("timer GET", get.Body.String())
	}
	call := func(body string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/timer", bytes.NewBufferString(body)))
		return response
	}
	if response := call(`{"action":"start","mode":"countdown","durationMs":60000,"revision":0}`); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	if response := call(`{"action":"pause","revision":0}`); response.Code != 409 {
		t.Fatal("stale API status", response.Code)
	}
	if response := call(`{"action":"pause","revision":1,"startedAt":123}`); response.Code != 400 {
		t.Fatal("client supplied timestamp accepted")
	}
	if response := call(`{"action":"pause","revision":1}`); response.Code != 200 {
		t.Fatal(response.Body.String())
	}
}

func TestWorkTimerSeparateStoresCannotOverwriteEachOther(t *testing.T) {
	root := t.TempDir()
	first, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, store := range []*Store{first, second} {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := store.workTimerAt(context.Background(), workTimerInput("start", "stopwatch", 0, 0), 100000)
			results <- err
		}()
	}
	wait.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, errWorkTimerConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("lost update: success=%d conflicts=%d", success, conflicts)
	}
}
