import { createCipheriv, createDecipheriv, createHash, createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto';

const iv = Buffer.from('0102030405060708');
const presetKey = Buffer.from('0CoJUm6Qyw8W8jud');
const eapiKey = Buffer.from('e82ckenh8dichen8');
const publicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`);
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function encrypt(text: string, key: Buffer, mode: 'cbc' | 'ecb', encoding: 'base64' | 'hex') {
  const cipher = createCipheriv(`aes-128-${mode}`, key, mode === 'cbc' ? iv : null);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString(encoding);
}

export function weapi(data: object) {
  const secret = Array.from(randomBytes(16), byte => alphabet[byte % alphabet.length]).join('');
  const params = encrypt(encrypt(JSON.stringify(data), presetKey, 'cbc', 'base64'), Buffer.from(secret), 'cbc', 'base64');
  const block = Buffer.alloc(128);
  Buffer.from(secret.split('').reverse().join('')).copy(block, 112);
  const encSecKey = publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, block).toString('hex').toUpperCase();
  return new URLSearchParams({ params, encSecKey });
}

export function eapi(path: string, data: object) {
  const text = JSON.stringify(data);
  const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex');
  return new URLSearchParams({ params: encrypt(`${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`, eapiKey, 'ecb', 'hex').toUpperCase() });
}

export function decryptEapi(buffer: Buffer) {
  const text = buffer.toString('utf8').trim();
  if (text.startsWith('{') || text.startsWith('[')) return JSON.parse(text);
  const payload = /^[\da-f]+$/i.test(text) && text.length % 2 === 0 ? Buffer.from(text, 'hex') : buffer;
  const decipher = createDecipheriv('aes-128-ecb', eapiKey, null);
  return JSON.parse(Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8'));
}
