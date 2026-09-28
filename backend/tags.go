package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
)

func normalizeTag(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 40 || strings.ContainsAny(name, "\r\n\x00") {
		return "", errors.New("invalid tag name")
	}
	return name, nil
}

func decodeTags(raw string) []string {
	result := []string{}
	_ = json.Unmarshal([]byte(raw), &result)
	if result == nil {
		return []string{}
	}
	return result
}

func splitAudioTags(value string) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, part := range strings.FieldsFunc(value, func(r rune) bool { return strings.ContainsRune(";,，、/\x00", r) }) {
		name, err := normalizeTag(part)
		if err == nil && !seen[strings.ToLower(name)] {
			result = append(result, name)
			seen[strings.ToLower(name)] = true
		}
	}
	return result
}

func (s *Store) loadCustomTags(state *State) error {
	rows, err := s.DB.Query(`SELECT name FROM custom_tags ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			break
		}
		state.Tags = append(state.Tags, name)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	index := make(map[int64]int, len(state.Tracks))
	for i, track := range state.Tracks {
		index[track.ID] = i
	}
	rows, err = s.DB.Query(`SELECT track_id,name FROM track_custom_tags ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var name string
		if err = rows.Scan(&id, &name); err != nil {
			break
		}
		if i, ok := index[id]; ok {
			state.Tracks[i].CustomTags = append(state.Tracks[i].CustomTags, name)
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	return err
}

func (s *Store) trackCustomTags(id int64) ([]string, error) {
	tags := []string{}
	rows, err := s.DB.Query(`SELECT name FROM track_custom_tags WHERE track_id=? ORDER BY name COLLATE NOCASE`, id)
	if err != nil {
		return tags, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return tags, err
		}
		tags = append(tags, name)
	}
	return tags, rows.Err()
}

func (s *Store) CreateTag(name string) error {
	var err error
	name, err = normalizeTag(name)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO custom_tags(name) VALUES(?)`, name)
	return err
}

func (s *Store) RenameTag(oldName, newName string) error {
	var err error
	newName, err = normalizeTag(newName)
	if err != nil {
		return err
	}
	result, err := s.DB.Exec(`UPDATE custom_tags SET name=? WHERE name=?`, newName, oldName)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) DeleteTag(name string) error {
	result, err := s.DB.Exec(`DELETE FROM custom_tags WHERE name=?`, name)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) SaveTrackTags(ids []int64, names []string) error {
	if len(ids) == 0 || len(ids) > 10000 || len(names) > 100 {
		return errors.New("invalid tag selection")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	unique := map[string]bool{}
	for _, name := range names {
		name, err = normalizeTag(name)
		if err != nil {
			return err
		}
		if unique[strings.ToLower(name)] {
			continue
		}
		unique[strings.ToLower(name)] = true
		var stored string
		if err = tx.QueryRow(`SELECT name FROM custom_tags WHERE name=?`, name).Scan(&stored); err != nil {
			return err
		}
	}
	for _, id := range ids {
		if id <= 0 {
			return errors.New("invalid track")
		}
		if _, err = tx.Exec(`DELETE FROM track_custom_tags WHERE track_id=?`, id); err != nil {
			return err
		}
		for _, name := range names {
			if _, err = tx.Exec(`INSERT OR IGNORE INTO track_custom_tags(track_id,name) VALUES(?,?)`, id, strings.TrimSpace(name)); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (s *Store) ChangeTrackTag(ids []int64, name string, add bool) error {
	if len(ids) == 0 || len(ids) > 10000 {
		return errors.New("invalid track selection")
	}
	var err error
	name, err = normalizeTag(name)
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var stored string
	if err = tx.QueryRow(`SELECT name FROM custom_tags WHERE name=?`, name).Scan(&stored); err != nil {
		return err
	}
	for _, id := range ids {
		if id <= 0 {
			return errors.New("invalid track")
		}
		var exists int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM tracks WHERE id=?`, id).Scan(&exists); err != nil {
			return err
		}
		if exists == 0 {
			return sql.ErrNoRows
		}
		if add {
			_, err = tx.Exec(`INSERT OR IGNORE INTO track_custom_tags(track_id,name) VALUES(?,?)`, id, stored)
		} else {
			_, err = tx.Exec(`DELETE FROM track_custom_tags WHERE track_id=? AND name=?`, id, stored)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
