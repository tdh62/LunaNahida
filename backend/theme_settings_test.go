package backend

import "testing"

func TestCustomThemeSettings(t *testing.T) {
	store := testStore(t)
	settings := DefaultSettings()
	settings.Theme = "custom"
	settings.ThemeColor = "#FcC800"
	for _, appearance := range []string{"light", "dark"} {
		settings.Appearance = appearance
		if err := store.SaveSettings(settings); err != nil {
			t.Fatal(err)
		}
		restored, err := store.Settings()
		if err != nil || restored.Theme != "custom" || restored.ThemeColor != settings.ThemeColor || restored.Appearance != appearance {
			t.Fatalf("custom theme lost: %+v, %v", restored, err)
		}
	}
	for _, color := range []string{"red", "#abc", "#GGGGGG", "#12345678"} {
		settings.ThemeColor = color
		if err := store.SaveSettings(settings); err == nil {
			t.Fatalf("accepted invalid base color: %s", color)
		}
	}
	settings.ThemeColor = ""
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	restored, _ := store.Settings()
	if restored.ThemeColor != "#FcC800" {
		t.Fatal("older clients must preserve the custom color")
	}
	if _, err := store.DB.Exec(`UPDATE preferences SET value='{"theme":"forest"}' WHERE key='settings'`); err != nil {
		t.Fatal(err)
	}
	restored, _ = store.Settings()
	if restored.ThemeColor != DefaultSettings().ThemeColor {
		t.Fatal("older settings must receive a default base color")
	}
}
