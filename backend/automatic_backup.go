package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type BackupPolicy struct {
	Enabled       bool `json:"enabled"`
	IntervalHours int  `json:"intervalHours"`
	KeepCount     int  `json:"keepCount"`
}
type BackupFile struct {
	Name      string `json:"name"`
	CreatedAt int64  `json:"createdAt"`
	Size      int64  `json:"size"`
}
type BackupEvent struct {
	ID     int64  `json:"id"`
	Time   int64  `json:"time"`
	Action string `json:"action"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

func (s *Store) BackupPolicy() (BackupPolicy, error) {
	value := BackupPolicy{IntervalHours: 24, KeepCount: 7}
	var raw string
	err := s.DB.QueryRow(`SELECT value FROM preferences WHERE key='automatic_backup'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	err = json.Unmarshal([]byte(raw), &value)
	return value, err
}
func (s *Store) SaveBackupPolicy(value BackupPolicy) error {
	if (value.IntervalHours != 24 && value.IntervalHours != 168) || value.KeepCount < 1 || value.KeepCount > 30 {
		return errors.New("备份周期或保留份数无效")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO preferences(key,value) VALUES('automatic_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw))
	if err == nil {
		select {
		case s.backupWake <- struct{}{}:
		default:
		}
	}
	return err
}
func (s *Store) backupDirectory() (string, error) {
	directory := filepath.Join(s.Root, "backups")
	if err := cacheDirectoryWithinRoot(s.Root, directory); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	if err := cacheDirectoryWithinRoot(s.Root, directory); err != nil {
		return "", err
	}
	return directory, nil
}
func validAutoBackupName(name string) bool {
	return filepath.Base(name) == name && !strings.ContainsAny(name, "/\\:") && strings.HasPrefix(name, "auto-") && strings.HasSuffix(name, ".zip")
}
func (s *Store) AutomaticBackups() ([]BackupFile, error) {
	result := []BackupFile{}
	directory, err := s.backupDirectory()
	if err != nil {
		return result, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return result, err
	}
	for _, entry := range entries {
		if !validAutoBackupName(entry.Name()) || entry.Type()&os.ModeSymlink != 0 || entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return result, err
		}
		if !info.Mode().IsRegular() {
			continue
		}
		result = append(result, BackupFile{Name: entry.Name(), CreatedAt: info.ModTime().UnixMilli(), Size: info.Size()})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt == result[j].CreatedAt {
			return result[i].Name > result[j].Name
		}
		return result[i].CreatedAt > result[j].CreatedAt
	})
	return result, nil
}
func (s *Store) recordBackup(action, name string, err error) {
	status, detail := "success", ""
	if err != nil {
		status = "failed"
		detail = err.Error()
	}
	_, _ = s.DB.Exec(`INSERT INTO backup_events(time,action,name,status,detail) VALUES(?,?,?,?,?)`, time.Now().UnixMilli(), action, name, status, detail)
	_, _ = s.DB.Exec(`DELETE FROM backup_events WHERE id NOT IN (SELECT id FROM backup_events ORDER BY id DESC LIMIT 100)`)
}
func (s *Store) BackupEvents() ([]BackupEvent, error) {
	result := []BackupEvent{}
	rows, err := s.DB.Query(`SELECT id,time,action,name,status,detail FROM backup_events ORDER BY id DESC LIMIT 100`)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var value BackupEvent
		if err = rows.Scan(&value.ID, &value.Time, &value.Action, &value.Name, &value.Status, &value.Detail); err != nil {
			return result, err
		}
		result = append(result, value)
	}
	return result, rows.Err()
}
func (s *Store) CreateAutomaticBackup(force bool) (name string, resultErr error) {
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	policy, err := s.BackupPolicy()
	if err != nil {
		return "", err
	}
	files, err := s.AutomaticBackups()
	if err != nil {
		return "", err
	}
	if !force && (!policy.Enabled || len(files) > 0 && time.Since(time.UnixMilli(files[0].CreatedAt)) < time.Duration(policy.IntervalHours)*time.Hour) {
		return "", nil
	}
	defer func() { s.recordBackup("backup", name, resultErr) }()
	directory, err := s.backupDirectory()
	if err != nil {
		return "", err
	}
	file, err := os.CreateTemp(directory, "auto-"+time.Now().Format("20060102-150405")+"-*.zip.pending")
	if err != nil {
		return "", err
	}
	pending := file.Name()
	defer os.Remove(pending)
	err = s.ExportBackup(file)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	name = strings.TrimSuffix(filepath.Base(pending), ".pending")
	if err = os.Rename(pending, filepath.Join(directory, name)); err != nil {
		return name, err
	}
	files, err = s.AutomaticBackups()
	if err != nil {
		return name, err
	}
	for index := policy.KeepCount; index < len(files); index++ {
		if err = os.Remove(filepath.Join(directory, files[index].Name)); err != nil {
			return name, err
		}
	}
	return name, nil
}
func (s *Store) RestoreAutomaticBackup(name string) (result BackupImportResult, resultErr error) {
	if !validAutoBackupName(name) {
		return result, errors.New("备份名称无效")
	}
	s.backupMu.Lock()
	defer s.backupMu.Unlock()
	defer func() { s.recordBackup("restore", name, resultErr) }()
	directory, err := s.backupDirectory()
	if err != nil {
		return result, err
	}
	path := filepath.Join(directory, name)
	info, err := os.Lstat(path)
	if err != nil {
		return result, err
	}
	if !info.Mode().IsRegular() {
		return result, errors.New("备份文件无效")
	}
	file, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer file.Close()
	return s.ImportBackup(file)
}
func (s *Store) startBackupScheduler() {
	s.backupOnce.Do(func() {
		s.backupWG.Add(1)
		go func() {
			defer s.backupWG.Done()
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for {
				select {
				case <-s.backupStop:
					return
				case <-ticker.C:
				case <-s.backupWake:
				}
				if _, err := s.CreateAutomaticBackup(false); err != nil {
					s.recordBackup("scheduler", "", err)
				}
			}
		}()
	})
}
func (a *API) registerAutomaticBackup(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/backups", func(w http.ResponseWriter, r *http.Request) {
		policy, err := a.Store.BackupPolicy()
		if err != nil {
			fail(w, 500, err)
			return
		}
		files, err := a.Store.AutomaticBackups()
		if err != nil {
			fail(w, 500, err)
			return
		}
		events, err := a.Store.BackupEvents()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]any{"policy": policy, "files": files, "events": events})
	})
	mux.HandleFunc("PUT /api/backups/policy", func(w http.ResponseWriter, r *http.Request) {
		var value BackupPolicy
		if err := decode(r, &value); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.SaveBackupPolicy(value); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, value)
	})
	mux.HandleFunc("POST /api/backups", func(w http.ResponseWriter, r *http.Request) {
		name, err := a.Store.CreateAutomaticBackup(true)
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]string{"name": name})
	})
	mux.HandleFunc("POST /api/backups/{name}/restore", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Store.RestoreAutomaticBackup(r.PathValue("name"))
		if err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, result)
	})
}
