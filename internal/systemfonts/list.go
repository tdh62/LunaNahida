package systemfonts

import (
	"errors"
	"sort"
	"strings"
)

// List returns installed family names rather than font file paths or face styles.
func List() ([]string, error) {
	values, err := installedFamilies()
	if err != nil {
		return nil, err
	}
	families := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		name := strings.TrimSpace(value)
		key := strings.ToLower(name)
		if name == "" || strings.HasPrefix(name, "@") || seen[key] {
			continue
		}
		seen[key] = true
		families = append(families, name)
	}
	sort.Slice(families, func(i, j int) bool { return strings.ToLower(families[i]) < strings.ToLower(families[j]) })
	if len(families) == 0 {
		return nil, errors.New("未找到系统字体")
	}
	return families, nil
}
