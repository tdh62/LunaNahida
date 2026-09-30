package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

const workTimerPreference = "work_timer"
const workTimerMaxDuration = int64(7 * 24 * 60 * 60 * 1000)

var errWorkTimerConflict = errors.New("计时器状态已变化，请同步后重试")

type workTimerState struct {
	Mode        string `json:"mode"`
	Status      string `json:"status"`
	DurationMs  int64  `json:"durationMs"`
	ElapsedMs   int64  `json:"elapsedMs"`
	StartedAt   int64  `json:"startedAt"`
	AnchorAt    int64  `json:"anchorAt"`
	CompletedAt int64  `json:"completedAt"`
	Revision    int64  `json:"revision"`
}

type workTimerCommand struct {
	Action     string `json:"action"`
	Mode       string `json:"mode,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Revision   *int64 `json:"revision"`
}

type workTimerResponse struct {
	Timer     workTimerState `json:"timer"`
	ServerNow int64          `json:"serverNow"`
}

func defaultWorkTimer() workTimerState {
	return workTimerState{Mode: "countdown", Status: "idle", DurationMs: 25 * 60 * 1000}
}

func workTimerElapsed(state workTimerState, now int64) int64 {
	elapsed := state.ElapsedMs
	if state.Status == "running" && now > state.AnchorAt {
		elapsed += now - state.AnchorAt
	}
	if state.Mode == "countdown" && elapsed > state.DurationMs {
		elapsed = state.DurationMs
	}
	return elapsed
}

func (s *Store) workTimerAt(ctx context.Context, command *workTimerCommand, now int64) (workTimerState, error) {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()
	state := defaultWorkTimer()
	var raw string
	err := s.DB.QueryRowContext(ctx, `SELECT value FROM preferences WHERE key=?`, workTimerPreference).Scan(&raw)
	present := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return state, err
	}
	if present {
		if err := json.Unmarshal([]byte(raw), &state); err != nil {
			return state, errors.New("计时器记录无法读取")
		}
	}
	save := func() error {
		payload, err := json.Marshal(state)
		if err != nil {
			return err
		}
		var result sql.Result
		if present {
			result, err = s.DB.ExecContext(ctx, `UPDATE preferences SET value=? WHERE key=? AND value=?`, string(payload), workTimerPreference, raw)
		} else {
			result, err = s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO preferences(key,value) VALUES(?,?)`, workTimerPreference, string(payload))
		}
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return errWorkTimerConflict
		}
		raw, present = string(payload), true
		return nil
	}
	if state.Status == "running" && state.Mode == "countdown" && workTimerElapsed(state, now) >= state.DurationMs {
		state.CompletedAt = state.AnchorAt + state.DurationMs - state.ElapsedMs
		state.Status, state.ElapsedMs, state.AnchorAt = "completed", state.DurationMs, 0
		state.Revision++
		if err := save(); err != nil {
			return state, err
		}
	}
	if command == nil {
		return state, nil
	}
	if command.Revision == nil {
		return state, errors.New("缺少计时器版本，请同步后重试")
	}
	if *command.Revision != state.Revision {
		return state, errWorkTimerConflict
	}
	switch command.Action {
	case "start":
		if state.Status == "running" || state.Status == "paused" {
			return state, errors.New("请先结束当前计时")
		}
		if command.Mode != "stopwatch" && command.Mode != "countdown" {
			return state, errors.New("无效的计时模式")
		}
		if command.Mode == "countdown" && (command.DurationMs < 1000 || command.DurationMs > workTimerMaxDuration) {
			return state, errors.New("倒计时范围为 1 秒至 7 天")
		}
		state.Mode, state.Status, state.DurationMs = command.Mode, "running", command.DurationMs
		if state.Mode == "stopwatch" {
			state.DurationMs = 0
		}
		state.ElapsedMs, state.CompletedAt = 0, 0
		state.StartedAt, state.AnchorAt = now, now
	case "pause":
		if state.Status != "running" {
			return state, errors.New("计时器未在运行")
		}
		state.ElapsedMs = workTimerElapsed(state, now)
		state.Status, state.AnchorAt = "paused", 0
	case "resume":
		if state.Status != "paused" {
			return state, errors.New("计时器未暂停")
		}
		state.Status, state.AnchorAt = "running", now
	case "reset":
		state.Status = "idle"
		state.ElapsedMs, state.StartedAt, state.AnchorAt, state.CompletedAt = 0, 0, 0, 0
	default:
		return state, errors.New("无效的计时操作")
	}
	state.Revision++
	return state, save()
}

func (a *API) registerWorkTimer(mux *http.ServeMux) {
	handle := func(w http.ResponseWriter, r *http.Request, command *workTimerCommand) {
		now := time.Now().UnixMilli()
		state, err := a.Store.workTimerAt(r.Context(), command, now)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, errWorkTimerConflict) {
				status = http.StatusConflict
			}
			fail(w, status, err)
			return
		}
		respond(w, http.StatusOK, workTimerResponse{state, time.Now().UnixMilli()})
	}
	mux.HandleFunc("GET /api/timer", func(w http.ResponseWriter, r *http.Request) { handle(w, r, nil) })
	mux.HandleFunc("POST /api/timer", func(w http.ResponseWriter, r *http.Request) {
		var command workTimerCommand
		if err := decode(r, &command); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		handle(w, r, &command)
	})
}
