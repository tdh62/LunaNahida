package backend

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestAudioAndCustomTags(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "tagged.mp3")
	frame := func(name string, payload []byte) []byte {
		value := make([]byte, 10+len(payload))
		copy(value, name)
		binary.BigEndian.PutUint32(value[4:8], uint32(len(payload)))
		copy(value[10:], payload)
		return value
	}
	frames := bytes.Join([][]byte{
		frame("TCON", append([]byte{3}, []byte("Rock; Jazz")...)),
		frame("TXXX", append([]byte{3}, []byte("Tags\x00夜晚, 收藏")...)),
	}, nil)
	size := len(frames)
	header := []byte{'I', 'D', '3', 3, 0, 0, byte(size >> 21), byte(size >> 14 & 0x7f), byte(size >> 7 & 0x7f), byte(size & 0x7f)}
	if err := os.WriteFile(path, append(header, frames...), 0600); err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "library")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("import: %+v %v", tracks, err)
	}
	if !reflect.DeepEqual(tracks[0].EmbeddedTags, []string{"Rock", "Jazz", "夜晚", "收藏"}) {
		t.Fatalf("embedded tags: %v", tracks[0].EmbeddedTags)
	}
	if err := store.CreateTag("通勤"); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveTrackTags([]int64{tracks[0].ID}, []string{"通勤"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RenameTag("通勤", "出行"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import([]string{path}, "library"); err != nil {
		t.Fatal(err)
	}
	state, err := store.State()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(state.Tags, []string{"出行"}) || !reflect.DeepEqual(state.Tracks[0].CustomTags, []string{"出行"}) || !reflect.DeepEqual(state.Tracks[0].EmbeddedTags, tracks[0].EmbeddedTags) {
		t.Fatalf("tags after scan: %+v", state)
	}
	if err := store.DeleteTag("出行"); err != nil {
		t.Fatal(err)
	}
	track, err := store.GetTrack(tracks[0].ID)
	if err != nil || len(track.CustomTags) != 0 || !reflect.DeepEqual(track.EmbeddedTags, tracks[0].EmbeddedTags) {
		t.Fatalf("tags after delete: %+v %v", track, err)
	}
}
