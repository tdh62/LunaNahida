//go:build !windows

package systemfonts

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

func installedFamilies() ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if runtime.GOOS == "darwin" {
		raw, err := exec.CommandContext(ctx, "system_profiler", "SPFontsDataType", "-json").Output()
		if err != nil {
			return nil, fmt.Errorf("无法读取系统字体: %w", err)
		}
		var data any
		if err = json.Unmarshal(raw, &data); err != nil {
			return nil, err
		}
		families := []string{}
		var visit func(any)
		visit = func(value any) {
			switch value := value.(type) {
			case map[string]any:
				if family, ok := value["family"].(string); ok {
					families = append(families, family)
				}
				for _, child := range value {
					visit(child)
				}
			case []any:
				for _, child := range value {
					visit(child)
				}
			}
		}
		visit(data)
		return families, nil
	}
	raw, err := exec.CommandContext(ctx, "fc-list", "--format=%{family[0]}\n").Output()
	if err != nil {
		return nil, fmt.Errorf("无法读取系统字体: %w", err)
	}
	return strings.Split(string(raw), "\n"), nil
}
