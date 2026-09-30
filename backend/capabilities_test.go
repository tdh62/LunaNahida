package backend

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestRuntimeCapabilities(t *testing.T) {
	store := testStore(t)
	for _, native := range []bool{false, true} {
		dialogs := Dialogs{}
		if native {
			dialogs.Files = func() ([]string, error) { t.Fatal("discovery opened a dialog"); return nil, nil }
		}
		response := httptest.NewRecorder()
		NewAPI(store, dialogs).Handler().ServeHTTP(response, httptest.NewRequest("GET", "/api/capabilities", nil))
		var value struct {
			Application   string `json:"application"`
			NativeFiles   bool   `json:"nativeFiles"`
			NativeFolders bool   `json:"nativeFolders"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || value.Application != "LunaNahida" || value.NativeFiles != native || value.NativeFolders {
			t.Fatalf("unexpected capabilities: %d %+v", response.Code, value)
		}
	}
}
