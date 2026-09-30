package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"
)

type timerReminders struct {
	SoundEnabled        bool   `json:"soundEnabled"`
	Sound               string `json:"sound"`
	Volume              int    `json:"volume"`
	NotificationEnabled bool   `json:"notificationEnabled"`
}

func (s *Store) timerReminders() (timerReminders, error) {
	settings := timerReminders{Sound: "chime", Volume: 60}
	var raw string
	err := s.DB.QueryRow(`SELECT value FROM preferences WHERE key='timer_reminders'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	err = json.Unmarshal([]byte(raw), &settings)
	return settings, err
}

func (s *Store) claimTimerAlert(startedAt int64) (bool, error) {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()
	// Recheck under the command lock so a reset cannot claim an obsolete round.
	var raw string
	if err := s.DB.QueryRow(`SELECT value FROM preferences WHERE key=?`, workTimerPreference).Scan(&raw); err != nil {
		return false, err
	}
	var state workTimerState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return false, err
	}
	if state.Status != "completed" || state.StartedAt != startedAt {
		return false, nil
	}
	result, err := s.DB.Exec(`INSERT INTO preferences(key,value) VALUES('timer_alerted_started_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE preferences.value <> excluded.value`, strconv.FormatInt(startedAt, 10))
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

func (a *API) registerTimerReminders(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/timer/reminders", func(w http.ResponseWriter, r *http.Request) {
		settings, err := a.Store.timerReminders()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, settings)
	})
	mux.HandleFunc("PUT /api/timer/reminders", func(w http.ResponseWriter, r *http.Request) {
		var settings timerReminders
		if err := decode(r, &settings); err != nil {
			fail(w, 400, err)
			return
		}
		if (settings.Sound != "chime" && settings.Sound != "bell" && settings.Sound != "beep") || settings.Volume < 0 || settings.Volume > 100 {
			fail(w, 400, errors.New("无效的计时提醒设置"))
			return
		}
		raw, err := json.Marshal(settings)
		if err == nil {
			_, err = a.Store.DB.Exec(`INSERT INTO preferences(key,value) VALUES('timer_reminders',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw))
		}
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, settings)
	})
	mux.HandleFunc("POST /api/timer/notification/authorize", func(w http.ResponseWriter, r *http.Request) {
		if a.AuthorizeTimerNotification == nil {
			fail(w, 501, errors.New("当前环境不支持原生通知"))
			return
		}
		granted, err := a.AuthorizeTimerNotification()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]bool{"granted": granted})
	})
	mux.HandleFunc("POST /api/timer/alert", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			StartedAt           int64 `json:"startedAt"`
			DesktopNotification bool  `json:"desktopNotification"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		state, err := a.Store.workTimerAt(r.Context(), nil, time.Now().UnixMilli())
		if err != nil {
			fail(w, 500, err)
			return
		}
		if state.Status != "completed" || state.StartedAt != input.StartedAt {
			fail(w, 409, errors.New("该轮计时尚未结束或已重置"))
			return
		}
		settings, err := a.Store.timerReminders()
		if err != nil {
			fail(w, 500, err)
			return
		}
		claimed, err := a.Store.claimTimerAlert(state.StartedAt)
		if err != nil {
			fail(w, 500, err)
			return
		}
		notificationError := ""
		if claimed && settings.NotificationEnabled && input.DesktopNotification {
			if a.SendTimerNotification == nil {
				notificationError = "当前环境不支持原生通知"
			} else if err := a.SendTimerNotification(state.StartedAt); err != nil {
				notificationError = err.Error()
			}
		}
		respond(w, 200, map[string]any{"claimed": claimed, "notificationError": notificationError})
	})
}
