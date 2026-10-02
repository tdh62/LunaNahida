package backend

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAutomaticBackupRetentionRestoreAndHistory(t *testing.T) {
	store := testStore(t)
	if err := store.SaveBackupPolicy(BackupPolicy{Enabled: false, IntervalHours: 24, KeepCount: 2}); err != nil {
		t.Fatal(err)
	}
	if name, err := store.CreateAutomaticBackup(false); err != nil || name != "" {
		t.Fatalf("disabled backup ran: %s %v", name, err)
	}
	_, err := store.DB.Exec(`INSERT INTO tracks(id,path,title,artist,album,duration,size,modified,added_at,tags_checked) VALUES(1,'song.wav','Song','Artist','Album',30,1,1,1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		name, err := store.CreateAutomaticBackup(true)
		if err != nil {
			t.Fatal(err)
		}
		// Make snapshot order deterministic without waiting for the filesystem clock.
		stamp := time.Now().Add(time.Duration(i-3) * time.Hour)
		if err = os.Chtimes(filepath.Join(store.Root, "backups", name), stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	files, err := store.AutomaticBackups()
	if err != nil || len(files) != 2 {
		t.Fatalf("retention: %+v %v", files, err)
	}
	if _, err = store.DB.Exec(`DELETE FROM tracks`); err != nil {
		t.Fatal(err)
	}
	result, err := store.RestoreAutomaticBackup(files[0].Name)
	if err != nil || result.Tracks != 1 {
		t.Fatalf("restore: %+v %v", result, err)
	}
	if _, err = store.RestoreAutomaticBackup("../library.db"); err == nil {
		t.Fatal("path traversal accepted")
	}
	events, err := store.BackupEvents()
	if err != nil || len(events) != 4 || events[0].Action != "restore" || events[0].Status != "success" {
		t.Fatalf("history: %+v %v", events, err)
	}
	if err = store.SaveBackupPolicy(BackupPolicy{Enabled: true, IntervalHours: 24, KeepCount: 2}); err != nil {
		t.Fatal(err)
	}
	if name, err := store.CreateAutomaticBackup(false); err != nil || name != "" {
		t.Fatalf("fresh backup repeated: %s %v", name, err)
	}
}

func TestAutomaticBackupFailureRecordedAndPolicyValidated(t *testing.T) {
	store := testStore(t)
	if err := store.SaveBackupPolicy(BackupPolicy{IntervalHours: 1, KeepCount: 0}); err == nil {
		t.Fatal("invalid policy accepted")
	}
	directory, err := store.backupDirectory()
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(directory, "auto-broken.zip"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = store.RestoreAutomaticBackup("auto-broken.zip"); err == nil {
		t.Fatal("broken backup accepted")
	}
	events, err := store.BackupEvents()
	if err != nil || len(events) != 1 || events[0].Status != "failed" {
		t.Fatalf("failure missing: %+v %v", events, err)
	}
}
