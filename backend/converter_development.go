//go:build !production

package backend

import "os"

func converterOverride() string { return os.Getenv("LUNANAHIDA_CONVERTER") }
