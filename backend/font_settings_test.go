package backend

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestFontSettingsPreservePriorityAndReset(t *testing.T) {
	store := testStore(t)
	settings := DefaultSettings()
	settings.UIFontFamilies = []string{"Segoe UI", "Microsoft YaHei UI", "Yu Gothic UI"}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	restored, err := store.Settings()
	if err != nil || !reflect.DeepEqual(restored.UIFontFamilies, settings.UIFontFamilies) {
		t.Fatalf("font priority not preserved: %v, %v", restored.UIFontFamilies, err)
	}
	for _, families := range [][]string{{""}, {" Segoe UI"}, {"Segoe UI", "segoe ui"}, {"a\nbody"}, {strings.Repeat("字", 101)}, {"a", "b", "c", "d", "e", "f", "g", "h", "i"}} {
		settings.UIFontFamilies = families
		if store.SaveSettings(settings) == nil {
			t.Fatalf("accepted invalid fonts: %q", families)
		}
	}
	settings.UIFontFamilies = []string{}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	restored, _ = store.Settings()
	if len(restored.UIFontFamilies) != 0 {
		t.Fatal("font reset was not saved")
	}
}

func TestSystemFontsRequireDesktopProvider(t *testing.T) {
	api := NewAPI(testStore(t), Dialogs{})
	for _, desktop := range []bool{false, true} {
		if desktop {
			api.SystemFonts = func() ([]string, error) { return []string{"Arial", "Microsoft YaHei"}, nil }
		}
		handler := api.Handler()
		capabilities := httptest.NewRecorder()
		handler.ServeHTTP(capabilities, httptest.NewRequest("GET", "/api/capabilities", nil))
		var flags map[string]any
		if err := json.Unmarshal(capabilities.Body.Bytes(), &flags); err != nil {
			t.Fatal(err)
		}
		if flags["nativeFonts"] != desktop {
			t.Fatalf("wrong font capability: %v", flags)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/fonts", nil))
		if !desktop && response.Code != 404 {
			t.Fatal("web server exposes system fonts")
		}
		if desktop && (response.Code != 200 || !strings.Contains(response.Body.String(), "Arial")) {
			t.Fatalf("desktop font response: %d %s", response.Code, response.Body.String())
		}
	}
	api.SystemFonts = func() ([]string, error) { return nil, errors.New("字体读取失败") }
	response := httptest.NewRecorder()
	api.Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/fonts", nil))
	if response.Code != 500 || !strings.Contains(response.Body.String(), "字体读取失败") {
		t.Fatal("font lookup failure was hidden")
	}
}
