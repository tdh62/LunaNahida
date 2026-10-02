package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
)

type PlaybackState struct {
	TrackID  int64   `json:"trackId"`
	Position float64 `json:"position"`
}

func (s *Store) Playback() (PlaybackState, error) {
	var value PlaybackState
	var raw string
	err := s.DB.QueryRow(`SELECT value FROM preferences WHERE key='playback'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	err = json.Unmarshal([]byte(raw), &value)
	return value, err
}

func (s *Store) SavePlayback(value PlaybackState) error {
	if value.TrackID < 0 || value.Position < 0 || math.IsNaN(value.Position) || math.IsInf(value.Position, 0) {
		return errors.New("播放记录无效")
	}
	if value.TrackID > 0 {
		var duration float64
		if err := s.DB.QueryRow(`SELECT duration FROM tracks WHERE id=?`, value.TrackID).Scan(&duration); err != nil {
			return err
		}
		if duration > 0 {
			value.Position = math.Min(value.Position, duration)
		}
	} else {
		value.Position = 0
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO preferences(key,value) VALUES('playback',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw))
	return err
}

func (a *API) registerPlayback(mux *http.ServeMux) {
	mux.HandleFunc("PUT /api/playback", func(w http.ResponseWriter, r *http.Request) {
		var value PlaybackState
		if err := decode(r, &value); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.SavePlayback(value); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
}
