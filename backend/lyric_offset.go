package backend

import (
	"errors"
	"net/http"
	"strconv"
)

func (s *Store) SaveLyricOffset(id int64, offset int) error {
	if id <= 0 || offset < -60000 || offset > 60000 {
		return errors.New("歌词偏移须在正负 60 秒以内")
	}
	_, err := s.DB.Exec(`INSERT INTO track_lyric_offsets(track_id,offset_ms) VALUES(?,?) ON CONFLICT(track_id) DO UPDATE SET offset_ms=excluded.offset_ms`, id, offset)
	return err
}
func (a *API) registerLyricOffset(mux *http.ServeMux) {
	mux.HandleFunc("PUT /api/tracks/{id}/lyric-offset", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			fail(w, 400, err)
			return
		}
		var input struct {
			Offset int `json:"offsetMs"`
		}
		if err = decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err = a.Store.SaveLyricOffset(id, input.Offset); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
}
