package backend

import "testing"

func TestSidebarSettingsPersistAndUpgrade(t *testing.T) {
	store := testStore(t)
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.HideLocalMusicActions || settings.HideNetworkMusicActions {
		t.Fatal("music actions should be visible by default")
	}
	for _, hidden := range [][2]bool{{true, false}, {false, true}, {true, true}, {false, false}} {
		settings.HideLocalMusicActions, settings.HideNetworkMusicActions = hidden[0], hidden[1]
		if err := store.SaveSettings(settings); err != nil {
			t.Fatal(err)
		}
		reloaded, err := store.Settings()
		if err != nil {
			t.Fatal(err)
		}
		if reloaded.HideLocalMusicActions != hidden[0] || reloaded.HideNetworkMusicActions != hidden[1] {
			t.Fatal("sidebar visibility changed after reload")
		}
	}
	if _, err := store.DB.Exec(`UPDATE preferences SET value='{"theme":"forest"}' WHERE key='settings'`); err != nil {
		t.Fatal(err)
	}
	settings, err = store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.HideLocalMusicActions || settings.HideNetworkMusicActions {
		t.Fatal("legacy settings should keep music actions visible")
	}
}
