package backend

import (
	"encoding/json"
	"testing"
)

func TestUITextSizeSettings(t *testing.T) {
	store := testStore(t)
	settings, err := store.Settings()
	if err != nil || settings.UITextSize != 100 {
		t.Fatalf("default text size: %d, %v", settings.UITextSize, err)
	}
	for _, size := range []int{90, 100, 110, 120, 125} {
		settings.UITextSize = size
		if err := store.SaveSettings(settings); err != nil {
			t.Fatal(err)
		}
		restored, err := store.Settings()
		if err != nil || restored.UITextSize != size {
			t.Fatalf("text size %d not preserved: %d, %v", size, restored.UITextSize, err)
		}
	}
	for _, size := range []int{-1, 89, 99, 126, 200} {
		settings.UITextSize = size
		if store.SaveSettings(settings) == nil {
			t.Fatalf("accepted invalid text size: %d", size)
		}
	}
	// Saving from an older client must not reset an existing preference.
	settings.UITextSize = 0
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	restored, _ := store.Settings()
	if restored.UITextSize != 125 {
		t.Fatal("older client reset text size")
	}
	// Preferences written before this feature or containing a bad value use the original size.
	raw, _ := json.Marshal(DefaultSettings())
	var legacy map[string]any
	_ = json.Unmarshal(raw, &legacy)
	for _, size := range []any{nil, 0, -100, 500} {
		delete(legacy, "uiTextSize")
		if size != nil {
			legacy["uiTextSize"] = size
		}
		raw, _ = json.Marshal(legacy)
		if _, err := store.DB.Exec(`UPDATE preferences SET value=? WHERE key='settings'`, string(raw)); err != nil {
			t.Fatal(err)
		}
		restored, err := store.Settings()
		if err != nil || restored.UITextSize != 100 {
			t.Fatalf("legacy/invalid size %v: %d, %v", size, restored.UITextSize, err)
		}
	}
}
