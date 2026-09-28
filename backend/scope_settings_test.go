package backend

import "testing"

func TestScopeSettingsPersistAndUpgrade(t *testing.T) {
	store := testStore(t)
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.Scope != (ScopeSettings{Mode: "spectrum", FFTSize: 8192, MinFrequency: 20, MaxFrequency: 20000, Smoothing: 0.72}) {
		t.Fatalf("unexpected default scope settings: %+v", settings.Scope)
	}

	settings.Scope = ScopeSettings{Mode: "waveform", FFTSize: 16384, MinFrequency: 200, MaxFrequency: 8000, Smoothing: 0.3}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	reloaded, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Scope != settings.Scope {
		t.Fatalf("scope settings changed after reload: got %+v, want %+v", reloaded.Scope, settings.Scope)
	}

	if _, err := store.DB.Exec(`UPDATE preferences SET value='{"visual":"频谱"}' WHERE key='settings'`); err != nil {
		t.Fatal(err)
	}
	upgraded, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if upgraded.Scope != DefaultSettings().Scope {
		t.Fatalf("legacy settings lost scope defaults: %+v", upgraded.Scope)
	}
}
