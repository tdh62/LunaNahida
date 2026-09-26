package backend

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/url"
	"strings"
)

const ncmPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`

func padPKCS7(data []byte) []byte {
	size := aes.BlockSize - len(data)%aes.BlockSize
	return append(data, bytes.Repeat([]byte{byte(size)}, size)...)
}
func unpadPKCS7(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("empty encrypted payload")
	}
	size := int(data[len(data)-1])
	if size <= 0 || size > aes.BlockSize || size > len(data) {
		return nil, errors.New("invalid padding")
	}
	for _, v := range data[len(data)-size:] {
		if int(v) != size {
			return nil, errors.New("invalid padding")
		}
	}
	return data[:len(data)-size], nil
}
func encryptCBC(value string, key []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	data := padPKCS7([]byte(value))
	cipher.NewCBCEncrypter(block, []byte("0102030405060708")).CryptBlocks(data, data)
	return base64.StdEncoding.EncodeToString(data), nil
}
func encryptECB(value string, key []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	data := padPKCS7([]byte(value))
	for i := 0; i < len(data); i += aes.BlockSize {
		block.Encrypt(data[i:i+aes.BlockSize], data[i:i+aes.BlockSize])
	}
	return strings.ToUpper(hex.EncodeToString(data)), nil
}

func weapi(data any) (url.Values, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	alphabet := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	random := make([]byte, 16)
	if _, err = rand.Read(random); err != nil {
		return nil, err
	}
	secret := make([]byte, 16)
	for i, b := range random {
		secret[i] = alphabet[int(b)%len(alphabet)]
	}
	first, err := encryptCBC(string(payload), []byte("0CoJUm6Qyw8W8jud"))
	if err != nil {
		return nil, err
	}
	params, err := encryptCBC(first, secret)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode([]byte(ncmPublicKey))
	if block == nil {
		return nil, errors.New("invalid public key")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	pub := pubAny.(*rsa.PublicKey)
	message := make([]byte, 128)
	for i := range secret {
		message[112+i] = secret[15-i]
	}
	number := new(big.Int).SetBytes(message)
	encrypted := new(big.Int).Exp(number, big.NewInt(int64(pub.E)), pub.N)
	encSecKey := fmt.Sprintf("%0256X", encrypted)
	return url.Values{"params": {params}, "encSecKey": {encSecKey}}, nil
}

func eapi(path string, data any) (url.Values, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	digest := md5.Sum([]byte("nobody" + path + "use" + string(payload) + "md5forencrypt"))
	value := path + "-36cd479b6b5-" + string(payload) + "-36cd479b6b5-" + hex.EncodeToString(digest[:])
	encrypted, err := encryptECB(value, []byte("e82ckenh8dichen8"))
	if err != nil {
		return nil, err
	}
	return url.Values{"params": {encrypted}}, nil
}

func decryptEapi(data []byte) ([]byte, error) {
	data = bytes.TrimSpace(data)
	if len(data) > 0 && (data[0] == '{' || data[0] == '[') {
		return data, nil
	}
	if decoded, err := hex.DecodeString(string(data)); err == nil {
		data = decoded
	}
	if len(data)%aes.BlockSize != 0 {
		return nil, errors.New("invalid encrypted payload")
	}
	block, err := aes.NewCipher([]byte("e82ckenh8dichen8"))
	if err != nil {
		return nil, err
	}
	for i := 0; i < len(data); i += aes.BlockSize {
		block.Decrypt(data[i:i+aes.BlockSize], data[i:i+aes.BlockSize])
	}
	return unpadPKCS7(data)
}
