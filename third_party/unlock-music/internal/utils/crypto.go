package utils

import "crypto/aes"

func PKCS7UnPadding(encrypt []byte) []byte {
	length := len(encrypt)
	if length == 0 {
		return nil
	}
	unPadding := int(encrypt[length-1])
	if unPadding < 1 || unPadding > length {
		return nil
	}
	return encrypt[:(length - unPadding)]
}

func DecryptAES128ECB(data, key []byte) []byte {
	if len(data)%aes.BlockSize != 0 {
		return nil
	}
	cipher, _ := aes.NewCipher(key)
	decrypted := make([]byte, len(data))
	size := 16
	for bs, be := 0, size; bs < len(data); bs, be = bs+size, be+size {
		cipher.Decrypt(decrypted[bs:be], data[bs:be])
	}
	return decrypted
}
