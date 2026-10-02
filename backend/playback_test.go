package backend

import "testing"

func TestPlaybackPersistsAndClampsPosition(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB.Exec(`INSERT INTO tracks(id,path,title,artist,album,duration,size,modified,added_at) VALUES(1,'song.wav','Song','Artist','Album',30,1,1,1)`)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.SavePlayback(PlaybackState{TrackID: 1, Position: 45}); err != nil {
		t.Fatal(err)
	}
	if err = store.SavePlayback(PlaybackState{TrackID: -1, Position: 3}); err == nil {
		t.Fatal("temporary track accepted")
	}
	store.Close()
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	value, err := store.Playback()
	if err != nil || value.TrackID != 1 || value.Position != 30 {
		t.Fatalf("playback: %+v %v", value, err)
	}
}
