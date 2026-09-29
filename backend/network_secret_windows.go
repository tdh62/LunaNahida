package backend

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

func protectNetworkSecret(value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	input := []byte(value)
	in := windows.DataBlob{Size: uint32(len(input)), Data: &input[0]}
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...), nil
}

func unprotectNetworkSecret(value []byte) (string, error) {
	if len(value) == 0 {
		return "", nil
	}
	in := windows.DataBlob{Size: uint32(len(value)), Data: &value[0]}
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return "", err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return string(unsafe.Slice(out.Data, out.Size)), nil
}
