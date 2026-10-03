package backend

import (
	"bytes"
	"context"
	"lunanahida/internal/restorefiles"
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprotocol"
	"os"
	"path/filepath"
	"testing"
)

func recoveryFixture(t *testing.T, s *Store, stage string) (string, restorefiles.Journal, []byte, []byte) {
	t.Helper()
	ctx := context.Background()
	parent := t.TempDir()
	parent, _ = canonical(parent)
	source, encrypted, audio := qmcFixture(t, parent, "中断 song")
	dir, err := os.MkdirTemp(parent, restoreformats.JobPrefix)
	if err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(parent, "中断 song.mp3")
	j := restorefiles.Journal{Source: source, Output: output, Retired: filepath.Join(parent, ".lunanahida-retired-test"), Stage: stage, Response: &restoreprotocol.Response{Metadata: &restoreprotocol.Metadata{Provider: "qq", ProviderID: "42"}}}
	j.SourceHash, err = restorefiles.Digest(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(output, audio, 0600); err != nil {
		t.Fatal(err)
	}
	j.OutputHash, err = restorefiles.Digest(ctx, output)
	if err != nil {
		t.Fatal(err)
	}
	if err = restorefiles.Retire(source, j.Retired); err != nil {
		t.Fatal(err)
	}
	if err = j.Save(dir); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec(`INSERT INTO conversion_jobs(path) VALUES(?)`, dir); err != nil {
		t.Fatal(err)
	}
	return dir, j, encrypted, audio
}

func TestRecoverySurvivesRestartWithoutModuleAndNeverOverwrites(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	dir, j, encrypted, audio := recoveryFixture(t, s, "source-retired")
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	jobs, err := s.ConversionJobs(ctx, nil)
	if err != nil || len(jobs) != 1 || !jobs[0].CanRestore || !jobs[0].CanImport {
		t.Fatalf("jobs=%+v err=%v", jobs, err)
	}
	// A new file at the source path must be retained; recover encrypted input beside it.
	if err = os.WriteFile(j.Source, []byte("new source"), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := s.RecoverConversion(ctx, dir, "restore")
	if err != nil || result.Status != "restored" {
		t.Fatalf("%+v %v", result, err)
	}
	for path, want := range map[string][]byte{j.Source: []byte("new source"), j.Source + ".recovered-encrypted": encrypted, j.Retired: encrypted, j.Output: audio} {
		got, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("file changed %s %v", path, err)
		}
	}
	jobs, err = s.ConversionJobs(ctx, nil)
	if err != nil || len(jobs) != 0 {
		t.Fatalf("resolved tasks=%+v %v", jobs, err)
	}
}

func TestRecoveryImportKeepsOriginalIDAndRelations(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	dir, j, encrypted, _ := recoveryFixture(t, s, "published")
	track, err := s.upsert(j.Output)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec(`UPDATE tracks SET path=?,title='Manual',manual_metadata=1 WHERE id=?`, j.Source, track.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DB.Exec(`INSERT INTO liked(track_id) VALUES(?)`, track.ID); err != nil {
		t.Fatal(err)
	}
	j.TrackID = track.ID
	j.Response.Metadata.Title = "Restored title"
	if err = j.Save(dir); err != nil {
		t.Fatal(err)
	}
	result, err := s.RecoverConversion(ctx, dir, "import")
	if err != nil || result.Track == nil || result.Track.ID != track.ID || result.Track.Title != "Manual" || !result.Track.Converted {
		t.Fatalf("%+v %v", result, err)
	}
	var liked int
	if err = s.DB.QueryRow(`SELECT count(*) FROM liked WHERE track_id=?`, track.ID).Scan(&liked); err != nil || liked != 1 {
		t.Fatalf("liked=%d %v", liked, err)
	}
	if got, _ := os.ReadFile(j.Retired); !bytes.Equal(got, encrypted) {
		t.Fatal("recovery removed source copy")
	}
}

func TestRecoveryRejectsChangedFilesAndForgedPaths(t *testing.T) {
	for _, mode := range []string{"changed-output", "changed-source-copy", "forged-source", "forged-backup", "legacy", "conflicting-copy"} {
		t.Run(mode, func(t *testing.T) {
			s := testStore(t)
			dir, j, _, audio := recoveryFixture(t, s, "published")
			action := "restore"
			switch mode {
			case "changed-output":
				action = "import"
				os.WriteFile(j.Output, []byte("replacement"), 0600)
			case "changed-source-copy":
				os.WriteFile(j.Retired, []byte("replacement"), 0600)
			case "forged-source":
				j.Source = filepath.Join(t.TempDir(), "unrelated.qmc0")
				j.Save(dir)
			case "forged-backup":
				j.Retired = j.Output
				j.Save(dir)
			case "legacy":
				j.SourceHash = ""
				j.OutputHash = ""
				j.Save(dir)
			case "conflicting-copy":
				os.WriteFile(j.Source, []byte("new"), 0600)
				os.WriteFile(j.Source+".recovered-encrypted", []byte("existing"), 0600)
			}
			if result, err := s.RecoverConversion(context.Background(), dir, action); err == nil {
				t.Fatalf("unsafe recovery succeeded %+v", result)
			}
			if mode != "changed-output" {
				got, _ := os.ReadFile(j.Output)
				if !bytes.Equal(got, audio) {
					t.Fatal("output changed")
				}
			}
		})
	}
}

func TestRecoveryDiscoversOrphanAndRetainsMalformedRecord(t *testing.T) {
	s := testStore(t)
	dir, _, _, _ := recoveryFixture(t, s, "staging")
	s.DB.Exec(`DELETE FROM conversion_jobs`)
	jobs, err := s.ConversionJobs(context.Background(), []string{filepath.Dir(dir)})
	if err != nil || len(jobs) != 1 {
		t.Fatalf("%+v %v", jobs, err)
	}
	os.WriteFile(filepath.Join(dir, "operation.json"), []byte("broken"), 0600)
	jobs, err = s.ConversionJobs(context.Background(), nil)
	if err != nil || len(jobs) != 1 || jobs[0].Error == "" || jobs[0].CanRestore {
		t.Fatalf("%+v %v", jobs, err)
	}
}
