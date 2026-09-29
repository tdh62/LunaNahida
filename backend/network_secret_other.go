//go:build !windows

package backend

import "errors"

func protectNetworkSecret(value string) ([]byte, error) {
	if value != "" {
		return nil, errors.New("此平台暂不支持保存网络密码")
	}
	return nil, nil
}

func unprotectNetworkSecret(value []byte) (string, error) {
	if len(value) != 0 {
		return "", errors.New("此平台无法读取网络密码")
	}
	return "", nil
}
