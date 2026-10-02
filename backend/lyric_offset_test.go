package backend

import (
	"bytes"
	"testing"
)

func TestLyricOffsetSurvivesBackupAndRejectsOutOfRange(t *testing.T) {
	source := testStore(t)
	_, err := source.DB.Exec(`INSERT INTO tracks(id,path,title,artist,album,duration,size,modified,added_at,tags_checked) VALUES(1,'song.wav','Song','Artist','Album',30,1,1,1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	if err = source.SaveLyricOffset(1, -1500); err != nil {
		t.Fatal(err)
	}
	if err = source.SaveLyricOffset(1, 60001); err == nil {
		t.Fatal("out of range accepted")
	}
	var archive bytes.Buffer
	if err = source.ExportBackup(&archive); err != nil {
		t.Fatal(err)
	}
	target := testStore(t)
	if _, err = target.ImportBackup(bytes.NewReader(archive.Bytes())); err != nil {
		t.Fatal(err)
	}
	state, err := target.State()
	if err != nil || len(state.Tracks) != 1 || state.Tracks[0].LyricOffsetMs != -1500 {
		t.Fatalf("offset lost: %+v %v", state.Tracks, err)
	}
}
