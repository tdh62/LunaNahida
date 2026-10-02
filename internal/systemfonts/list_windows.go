//go:build windows

package systemfonts

import (
	"errors"
	"runtime"
	"sync"
	"syscall"
	"unsafe"
)

type logFont struct {
	Height, Width, Escapement, Orientation, Weight int32
	Italic, Underline, StrikeOut, CharSet          byte
	OutPrecision, ClipPrecision, Quality, Pitch    byte
	FaceName                                       [32]uint16
}

var gdi = syscall.NewLazyDLL("gdi32.dll")
var createDC = gdi.NewProc("CreateCompatibleDC")
var deleteDC = gdi.NewProc("DeleteDC")
var enumFonts = gdi.NewProc("EnumFontFamiliesExW")
var enumerationMu sync.Mutex
var enumerated []string
var fontCallback = syscall.NewCallback(func(font, metrics, kind, data uintptr) uintptr {
	value := (*logFont)(unsafe.Pointer(font))
	enumerated = append(enumerated, syscall.UTF16ToString(value.FaceName[:]))
	return 1
})

func installedFamilies() ([]string, error) {
	enumerationMu.Lock()
	defer enumerationMu.Unlock()
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	dc, _, _ := createDC.Call(0)
	if dc == 0 {
		return nil, errors.New("无法读取系统字体")
	}
	defer deleteDC.Call(dc)
	enumerated = []string{}
	query := logFont{CharSet: 1} // DEFAULT_CHARSET enumerates all scripts.
	enumFonts.Call(dc, uintptr(unsafe.Pointer(&query)), fontCallback, 0, 0)
	runtime.KeepAlive(query)
	families := enumerated
	enumerated = nil
	return families, nil
}
