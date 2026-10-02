//go:build windows

package systemfonts

import (
	"strings"
	"testing"
)

func TestWindowsSystemFontFamilies(t *testing.T) {
	for attempt := 0; attempt < 2; attempt++ {
		families, err := List()
		if err != nil || len(families) == 0 {
			t.Fatalf("system font enumeration failed: %v", err)
		}
		seen := map[string]bool{}
		for _, family := range families {
			key := strings.ToLower(family)
			if family == "" || strings.HasPrefix(family, "@") || seen[key] {
				t.Fatalf("invalid or duplicate font family: %q", family)
			}
			seen[key] = true
		}
		t.Logf("enumerated %d system font families", len(families))
	}
}
