package backend

import (
	"bytes"
	"reflect"
	"testing"
)

func TestConditionPlaylistRecomputesAfterFavoritesTagsAndImport(t *testing.T) {
	store := testStore(t)
	_, err := store.DB.Exec(`INSERT INTO tracks(id,path,title,artist,album,duration,year,size,modified,added_at,tags_checked) VALUES(1,'a.flac','Song 10','Artist','Album',180,'2020',1,1,1,1),(2,'b.mp3','Song 2','Artist','Album',60,'2022',1,1,2,1); INSERT INTO custom_tags(name) VALUES('夜晚'); INSERT INTO track_custom_tags(track_id,name) VALUES(1,'夜晚')`)
	if err != nil {
		t.Fatal(err)
	}
	rule := &PlaylistRules{Conditions: TrackConditions{Artist: "artist", Favorite: "liked", Tags: []string{"夜晚"}}, Sort: "title"}
	if err = store.SavePlaylists([]Playlist{{ID: "smart", Name: "Night", CoverMode: "first-track", Rules: rule, TrackIDs: []int64{2}}}); err != nil {
		t.Fatal(err)
	}
	check := func(ids []int64) {
		t.Helper()
		state, err := store.State()
		if err != nil || len(state.Playlists) != 1 || !reflect.DeepEqual(state.Playlists[0].TrackIDs, ids) {
			t.Fatalf("membership: %+v expected %v err %v", state.Playlists, ids, err)
		}
	}
	check([]int64{})
	if err = store.SaveIDs("liked", []int64{1, 2}); err != nil {
		t.Fatal(err)
	}
	check([]int64{1})
	_, err = store.DB.Exec(`INSERT INTO track_custom_tags(track_id,name) VALUES(2,'夜晚')`)
	if err != nil {
		t.Fatal(err)
	}
	check([]int64{2, 1})
	_, err = store.DB.Exec(`INSERT INTO tracks(id,path,title,artist,album,duration,year,size,modified,added_at,tags_checked) VALUES(3,'c.wav','Song 1','Artist','Album',90,'2024',1,1,3,1);INSERT INTO liked(track_id) VALUES(3);INSERT INTO track_custom_tags(track_id,name) VALUES(3,'夜晚')`)
	if err != nil {
		t.Fatal(err)
	}
	check([]int64{3, 2, 1})
	if err = store.SaveIDs("liked", []int64{2, 3}); err != nil {
		t.Fatal(err)
	}
	check([]int64{3, 2})
	var archive bytes.Buffer
	if err = store.ExportBackup(&archive); err != nil {
		t.Fatal(err)
	}
	target := testStore(t)
	if _, err = target.ImportBackup(bytes.NewReader(archive.Bytes())); err != nil {
		t.Fatal(err)
	}
	state, err := target.State()
	if err != nil || len(state.Playlists) != 1 || state.Playlists[0].Rules == nil || !reflect.DeepEqual(state.Playlists[0].TrackIDs, []int64{3, 2}) {
		t.Fatalf("backup rule lost: %+v %v", state.Playlists, err)
	}
}
func TestConditionPlaylistValidationAndNumericBounds(t *testing.T) {
	duration := 100.0
	year := 2021
	conditions := TrackConditions{MinDuration: &duration, MinYear: &year, Source: "network", Format: "flac", Availability: "playable"}
	track := Track{ID: 1, FileName: "song.flac", Duration: 120, Year: "2024", Kind: "network", Available: true}
	if !matchesConditions(track, conditions, map[int64]bool{}) {
		t.Fatal("valid track excluded")
	}
	track.Year = ""
	if matchesConditions(track, conditions, map[int64]bool{}) {
		t.Fatal("unknown year matched")
	}
	rule := &PlaylistRules{Conditions: conditions, Sort: "title"}
	if err := validatePlaylistRules(rule); err != nil {
		t.Fatal(err)
	}
	rule.Conditions.MaxDuration = new(float64)
	if err := validatePlaylistRules(rule); err == nil {
		t.Fatal("inverted bounds accepted")
	}
}
