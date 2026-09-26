package backend

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/longbridgeapp/opencc"
	"golang.org/x/text/unicode/norm"
)

type Music struct {
	store        *Store
	client       *http.Client
	mu           sync.Mutex
	slots        map[string]time.Time
	queue        chan struct{}
	token        string
	tokenExpires time.Time
	converter    *opencc.OpenCC
}

func NewMusic(store *Store) *Music {
	converter, _ := opencc.New("t2s")
	return &Music{store: store, client: &http.Client{Timeout: 12 * time.Second}, slots: map[string]time.Time{}, queue: make(chan struct{}, 24), converter: converter}
}

type song struct{ ID, Mid, Title, Artist, Artwork string }
type enrichment struct {
	Cover       string `json:"cover,omitempty"`
	Lyric       string `json:"lyric,omitempty"`
	Translation string `json:"translation,omitempty"`
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

var trailingEdition = regexp.MustCompile(`(?i)\s+(?:[ivxlcdm]+|\d+)$`)
var qqCallback = regexp.MustCompile(`^(?:callback|MusicJsonCallback|jsonCallback)\((.*)\)\s*;?\s*$`)

func obj(v any) map[string]any { m, _ := v.(map[string]any); return m }
func arr(v any) []any          { a, _ := v.([]any); return a }
func str(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatInt(int64(x), 10)
	case json.Number:
		return x.String()
	default:
		return ""
	}
}
func number(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int:
		return int64(x)
	case int64:
		return x
	case json.Number:
		n, _ := x.Int64()
		return n
	default:
		n, _ := strconv.ParseInt(str(v), 10, 64)
		return n
	}
}
func choose(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
func (m *Music) simple(v string) string {
	v = norm.NFKC.String(v)
	if m.converter != nil {
		if converted, err := m.converter.Convert(v); err == nil {
			v = converted
		}
	}
	return v
}
func (m *Music) normalized(v string) string {
	v = strings.ToLower(trailingEdition.ReplaceAllString(m.simple(v), ""))
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			return -1
		}
		return r
	}, v)
}
func (m *Music) match(item song, title, artist string) bool {
	if m.normalized(item.Title) != m.normalized(title) {
		return false
	}
	for _, name := range strings.FieldsFunc(item.Artist, func(r rune) bool { return strings.ContainsRune(",，、/＆&;；", r) }) {
		if m.normalized(name) == m.normalized(artist) {
			return true
		}
	}
	return false
}

func (m *Music) cached(key string, ttl time.Duration, refresh bool, load func() (any, error)) (any, error) {
	if !refresh {
		var raw string
		var expires int64
		err := m.store.DB.QueryRow(`SELECT value,expires_at FROM metadata_cache WHERE key=?`, key).Scan(&raw, &expires)
		if err == nil && expires > time.Now().Unix() {
			var value any
			if json.Unmarshal([]byte(raw), &value) == nil {
				return value, nil
			}
		}
	}
	value, err := load()
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(value)
	if err == nil {
		_, err = m.store.DB.Exec(`INSERT INTO metadata_cache(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at`, key, string(raw), time.Now().Add(ttl).Unix())
	}
	return value, err
}

func (m *Music) request(ctx context.Context, source, method, target string, body io.Reader, headers map[string]string) ([]byte, http.Header, error) {
	select {
	case m.queue <- struct{}{}:
		defer func() { <-m.queue }()
	default:
		return nil, nil, errors.New("request queue full")
	}
	m.mu.Lock()
	wait := time.Until(m.slots[source])
	if wait < 0 {
		wait = 0
	}
	m.slots[source] = time.Now().Add(wait + 1200*time.Millisecond)
	m.mu.Unlock()
	if wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		}
	}
	requestCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, method, target, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	response, err := m.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, nil, fmt.Errorf("upstream status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	return data, response.Header, err
}

func randomHex(size int) string {
	value := make([]byte, size)
	_, _ = rand.Read(value)
	return hex.EncodeToString(value)
}
func (m *Music) anonymous(ctx context.Context) (string, error) {
	m.mu.Lock()
	if time.Now().Before(m.tokenExpires) {
		token := m.token
		m.mu.Unlock()
		return token, nil
	}
	m.mu.Unlock()
	device := "NMUSIC"
	key := "3go8&$833h0k(2)2"
	encoded := make([]byte, len(device))
	for i := range encoded {
		encoded[i] = device[i] ^ key[i%len(key)]
	}
	digest := md5.Sum(encoded)
	username := base64.StdEncoding.EncodeToString([]byte(device + " " + base64.StdEncoding.EncodeToString(digest[:])))
	params, err := weapi(map[string]any{"username": username, "csrf_token": ""})
	if err != nil {
		return "", err
	}
	_, headers, err := m.request(ctx, "ncm", "POST", "https://music.163.com/weapi/register/anonimous", strings.NewReader(params.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Referer": "https://music.163.com"})
	if err != nil {
		return "", err
	}
	for _, cookie := range headers.Values("Set-Cookie") {
		if strings.HasPrefix(cookie, "MUSIC_A=") {
			token := strings.SplitN(strings.TrimPrefix(cookie, "MUSIC_A="), ";", 2)[0]
			m.mu.Lock()
			m.token = token
			m.tokenExpires = time.Now().Add(6 * time.Hour)
			m.mu.Unlock()
			return token, nil
		}
	}
	return "", errors.New("anonymous token unavailable")
}

func (m *Music) ncm(ctx context.Context, target string, data map[string]any, mode, path string) (map[string]any, error) {
	token, err := m.anonymous(ctx)
	if err != nil {
		return nil, err
	}
	cookie := "MUSIC_A=" + url.QueryEscape(token) + "; os=ios; appver=8.20.21; _ntes_nuid=" + randomHex(16) + "; NMTID=" + randomHex(16)
	var values url.Values
	if mode == "eapi" {
		header := map[string]any{"osver": "17,1,2", "appver": "8.20.21", "versioncode": "140", "buildver": strconv.FormatInt(time.Now().Unix(), 10), "resolution": "1920x1080", "__csrf": "", "os": "ios", "requestId": fmt.Sprintf("%d_%04d", time.Now().UnixMilli(), time.Now().UnixNano()%10000), "MUSIC_A": token}
		data["header"] = header
		values, err = eapi(path, data)
	} else {
		data["csrf_token"] = ""
		values, err = weapi(data)
	}
	if err != nil {
		return nil, err
	}
	payload, _, err := m.request(ctx, "ncm", "POST", target, strings.NewReader(values.Encode()), map[string]string{"Content-Type": "application/x-www-form-urlencoded", "Referer": "https://music.163.com", "Cookie": cookie})
	if err != nil {
		return nil, err
	}
	if mode == "eapi" {
		payload, err = decryptEapi(payload)
		if err != nil {
			return nil, err
		}
	}
	var result map[string]any
	if err = json.Unmarshal(payload, &result); err != nil {
		return nil, err
	}
	if number(result["code"]) != 200 {
		return nil, fmt.Errorf("ncm code %v", result["code"])
	}
	return result, nil
}

func (m *Music) search(ctx context.Context, source, query string) ([]song, error) {
	if source == "ncm" {
		value, err := m.ncm(ctx, "https://music.163.com/weapi/search/get", map[string]any{"s": query, "type": 1, "limit": 30, "offset": 0}, "weapi", "")
		if err != nil {
			return nil, err
		}
		items := arr(obj(value["result"])["songs"])
		if items == nil {
			return nil, errors.New("ncm missing songs")
		}
		songs := []song{}
		for _, raw := range items {
			item := obj(raw)
			artists := arr(chooseAny(item["artists"], item["ar"]))
			names := []string{}
			for _, person := range artists {
				names = append(names, str(obj(person)["name"]))
			}
			songs = append(songs, song{ID: str(item["id"]), Title: str(item["name"]), Artist: strings.Join(names, ", "), Artwork: choose(str(obj(item["album"])["picUrl"]), str(obj(item["al"])["picUrl"]))})
		}
		return songs, nil
	}
	request := map[string]any{"req_1": map[string]any{"module": "music.search.SearchCgiService", "method": "DoSearchForQQMusicDesktop", "param": map[string]any{"num_per_page": 20, "page_num": 1, "query": query, "search_type": 0}}}
	body, _ := json.Marshal(request)
	payload, _, err := m.request(ctx, "qq", "POST", "https://u.y.qq.com/cgi-bin/musicu.fcg", strings.NewReader(string(body)), map[string]string{"Content-Type": "application/json", "Referer": "https://y.qq.com/", "Cookie": "uin="})
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err = json.Unmarshal(payload, &value); err != nil {
		return nil, err
	}
	req := obj(value["req_1"])
	items := arr(obj(obj(obj(req["data"])["body"])["song"])["list"])
	if items == nil || req["code"] != nil && number(req["code"]) != 0 {
		return nil, fmt.Errorf("qq search code %v", req["code"])
	}
	songs := []song{}
	for _, raw := range items {
		item := obj(raw)
		names := []string{}
		for _, person := range arr(item["singer"]) {
			names = append(names, str(obj(person)["name"]))
		}
		mid := choose(str(obj(item["album"])["mid"]), str(item["albummid"]))
		artwork := ""
		if mid != "" {
			artwork = "https://y.gtimg.cn/music/photo_new/T002R300x300M000" + mid + ".jpg"
		}
		songs = append(songs, song{ID: choose(str(item["id"]), str(item["songid"])), Mid: choose(str(item["mid"]), str(item["songmid"])), Title: choose(str(item["title"]), str(item["songname"])), Artist: strings.Join(names, ", "), Artwork: artwork})
	}
	return songs, nil
}
func chooseAny(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func (m *Music) lyrics(ctx context.Context, source string, item song) (string, string, error) {
	if source == "ncm" {
		value, err := m.ncm(ctx, "https://interface3.music.163.com/eapi/song/lyric/v1", map[string]any{"id": item.ID, "cp": false, "tv": 0, "lv": 0, "rv": 0, "kv": 0, "yv": 0, "ytv": 0, "yrv": 0}, "eapi", "/api/song/lyric/v1")
		if err != nil {
			value, err = m.ncm(ctx, "https://music.163.com/weapi/song/lyric", map[string]any{"id": item.ID, "lv": -1, "tv": -1, "cp": false}, "weapi", "")
		}
		if err != nil {
			return "", "", err
		}
		return str(obj(value["lrc"])["lyric"]), str(obj(value["tlyric"])["lyric"]), nil
	}
	if item.Mid == "" {
		return "", "", nil
	}
	params := url.Values{"songmid": {item.Mid}, "g_tk": {"5381"}, "loginUin": {"0"}, "hostUin": {"0"}, "inCharset": {"utf8"}, "outCharset": {"utf-8"}, "notice": {"0"}, "platform": {"yqq"}, "needNewCode": {"0"}}
	payload, _, err := m.request(ctx, "qq", "GET", "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?"+params.Encode(), nil, map[string]string{"Referer": "https://y.qq.com/", "Cookie": "uin="})
	if err != nil {
		return "", "", err
	}
	text := strings.TrimSpace(string(payload))
	if match := qqCallback.FindStringSubmatch(text); match != nil {
		text = match[1]
	}
	var value map[string]any
	if err = json.Unmarshal([]byte(text), &value); err != nil {
		return "", "", err
	}
	if value["retcode"] != nil && number(value["retcode"]) != 0 {
		return "", "", errors.New("qq lyric unavailable")
	}
	decode := func(raw string) string {
		data, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return ""
		}
		return html.UnescapeString(string(data))
	}
	return decode(str(value["lyric"])), decode(str(value["trans"])), nil
}

func validArtwork(source string) bool {
	parsed, err := url.Parse(source)
	if err != nil || parsed.Scheme != "https" && parsed.Scheme != "http" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return strings.HasSuffix(host, ".music.126.net") || host == "y.gtimg.cn"
}
func (m *Music) localArtwork(ctx context.Context, source string) string {
	if !validArtwork(source) {
		return ""
	}
	source = strings.Replace(source, "http://", "https://", 1)
	payload, headers, err := m.request(ctx, "cover", "GET", source, nil, nil)
	if err != nil || len(payload) > 15<<20 {
		return ""
	}
	ext := ".jpg"
	switch {
	case strings.Contains(headers.Get("Content-Type"), "png"):
		ext = ".png"
	case strings.Contains(headers.Get("Content-Type"), "webp"):
		ext = ".webp"
	}
	saved, err := m.store.SaveCover(strings.NewReader(string(payload)), ext)
	if err != nil {
		return ""
	}
	return saved
}

func (m *Music) enrich(ctx context.Context, title, artist string, cover, lyric, force bool) (enrichment, error) {
	result := enrichment{}
	failed := false
	matched := false
	for _, source := range []string{"ncm", "qq"} {
		if (!cover || result.Cover != "") && (!lyric || result.Lyric != "") {
			break
		}
		var found *song
		for _, query := range []string{m.simple(title), m.simple(title) + " " + m.simple(artist)} {
			key := "search:v6:" + source + ":" + m.normalized(query)
			value, err := m.cached(key, time.Hour, force, func() (any, error) { return m.search(ctx, source, query) })
			if err != nil {
				failed = true
				log.Printf("music search %s: %v", source, err)
				continue
			}
			raw, _ := json.Marshal(value)
			var candidates []song
			_ = json.Unmarshal(raw, &candidates)
			for _, item := range candidates {
				if m.match(item, title, artist) {
					copy := item
					found = &copy
					break
				}
			}
			if found != nil {
				break
			}
		}
		if found == nil {
			continue
		}
		matched = true
		if cover && result.Cover == "" {
			if source == "ncm" && found.Artwork == "" {
				detail, err := m.ncm(ctx, "https://music.163.com/weapi/v3/song/detail", map[string]any{"c": fmt.Sprintf(`[{"id":%s}]`, found.ID)}, "weapi", "")
				if err == nil && len(arr(detail["songs"])) > 0 {
					album := obj(obj(arr(detail["songs"])[0])["al"])
					found.Artwork = str(album["picUrl"])
				} else if err != nil {
					failed = true
				}
			}
			result.Cover = m.localArtwork(ctx, found.Artwork)
		}
		if lyric && result.Lyric == "" {
			key := "lyric:" + source + ":" + found.ID + ":" + found.Mid
			value, err := m.cached(key, 24*time.Hour, force, func() (any, error) {
				text, translation, err := m.lyrics(ctx, source, *found)
				return map[string]string{"lyric": text, "translation": translation}, err
			})
			if err != nil {
				failed = true
				log.Printf("music lyric %s: %v", source, err)
			} else {
				result.Lyric = str(obj(value)["lyric"])
				result.Translation = str(obj(value)["translation"])
			}
		}
	}
	if failed && result.Cover == "" && result.Lyric == "" {
		return result, errors.New("music source unavailable")
	}
	_ = matched
	return result, nil
}

func queryValid(r *http.Request, fields ...string) bool {
	query := r.URL.Query()
	for _, field := range fields {
		value := query.Get(field)
		if strings.TrimSpace(value) == "" || len(value) > 120 {
			return false
		}
	}
	refresh := query.Get("refresh")
	return refresh == "" || refresh == "1"
}
func (m *Music) Enrich(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !queryValid(r, "title", "artist") || (q.Get("cover") != "0" && q.Get("cover") != "1") || (q.Get("lyric") != "0" && q.Get("lyric") != "1") || q.Get("cover") == "0" && q.Get("lyric") == "0" {
		fail(w, 400, errors.New("无效的曲目信息"))
		return
	}
	title := strings.TrimSpace(q.Get("title"))
	artist := strings.TrimSpace(q.Get("artist"))
	cover := q.Get("cover") == "1"
	lyric := q.Get("lyric") == "1"
	force := q.Get("refresh") == "1"
	key := fmt.Sprintf("enrich:v7:%s:%s:%t:%t", m.normalized(title), m.normalized(artist), cover, lyric)
	value, err := m.cached(key, 30*time.Minute, force, func() (any, error) { return m.enrich(r.Context(), title, artist, cover, lyric, force) })
	if err != nil {
		fail(w, 502, errors.New("音乐资料暂时不可用"))
		return
	}
	respond(w, 200, value)
}

func (m *Music) Artist(w http.ResponseWriter, r *http.Request) {
	if !queryValid(r, "name") {
		fail(w, 400, errors.New("无效的歌手名称"))
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	value, err := m.cached("artist-description:v2:"+m.normalized(name), 10*365*24*time.Hour, r.URL.Query().Get("refresh") == "1", func() (any, error) { return m.artist(r.Context(), name) })
	if err != nil {
		fail(w, 502, errors.New("歌手介绍暂时不可用"))
		return
	}
	if value == nil {
		fail(w, 404, errors.New("网易云音乐中未找到该歌手"))
		return
	}
	respond(w, 200, value)
}
func (m *Music) artist(ctx context.Context, name string) (any, error) {
	result, err := m.ncm(ctx, "https://music.163.com/weapi/search/get", map[string]any{"s": m.simple(name), "type": 100, "limit": 30, "offset": 0}, "weapi", "")
	if err != nil {
		return nil, err
	}
	artists := arr(obj(result["result"])["artists"])
	if artists == nil {
		return nil, errors.New("artist list missing")
	}
	for _, raw := range artists {
		item := obj(raw)
		names := append([]any{item["name"]}, arr(item["alias"])...)
		match := false
		for _, candidate := range names {
			if m.normalized(str(candidate)) == m.normalized(name) {
				match = true
				break
			}
		}
		if !match {
			continue
		}
		detail, err := m.ncm(ctx, "https://music.163.com/weapi/artist/introduction", map[string]any{"id": str(item["id"])}, "weapi", "")
		if err != nil {
			return nil, err
		}
		introduction := []map[string]string{}
		for _, part := range arr(detail["introduction"]) {
			entry := obj(part)
			if str(entry["ti"]) != "" || str(entry["txt"]) != "" {
				introduction = append(introduction, map[string]string{"ti": str(entry["ti"]), "txt": str(entry["txt"])})
			}
		}
		return map[string]any{"id": str(item["id"]), "name": str(item["name"]), "picture": m.localArtwork(ctx, choose(str(item["picUrl"]), str(item["img1v1Url"]))), "briefDesc": str(detail["briefDesc"]), "introduction": introduction}, nil
	}
	return nil, nil
}

func (m *Music) Album(w http.ResponseWriter, r *http.Request) {
	if !queryValid(r, "name", "artist") {
		fail(w, 400, errors.New("无效的专辑信息"))
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	artist := strings.TrimSpace(r.URL.Query().Get("artist"))
	value, err := m.cached("album-description:v2:"+m.normalized(name)+":"+m.normalized(artist), 10*365*24*time.Hour, r.URL.Query().Get("refresh") == "1", func() (any, error) { return m.album(r.Context(), name, artist) })
	if err != nil {
		fail(w, 502, errors.New("专辑资料暂时不可用"))
		return
	}
	if value == nil {
		fail(w, 404, errors.New("网易云音乐中未找到匹配的专辑"))
		return
	}
	respond(w, 200, value)
}
func (m *Music) album(ctx context.Context, name, artist string) (any, error) {
	search := func(query string) ([]any, error) {
		value, err := m.ncm(ctx, "https://music.163.com/weapi/search/get", map[string]any{"s": query, "type": 10, "limit": 30, "offset": 0}, "weapi", "")
		if err != nil {
			return nil, err
		}
		items := arr(obj(value["result"])["albums"])
		if items == nil && number(obj(value["result"])["albumCount"]) != 0 {
			return nil, errors.New("album list missing")
		}
		return items, nil
	}
	items, err := search(m.simple(name))
	if err != nil {
		return nil, err
	}
	combined, err := search(m.simple(name) + " " + m.simple(artist))
	if err == nil {
		items = append(items, combined...)
	}
	var selected map[string]any
	for _, raw := range items {
		item := obj(raw)
		people := append([]any{item["artist"]}, arr(item["artists"])...)
		artistMatches := false
		for _, person := range people {
			p := obj(person)
			names := append([]any{p["name"]}, arr(p["alias"])...)
			for _, candidate := range names {
				if m.normalized(str(candidate)) == m.normalized(artist) {
					artistMatches = true
				}
			}
		}
		if !artistMatches {
			continue
		}
		names := append([]any{item["name"]}, arr(item["alias"])...)
		for _, candidate := range names {
			if m.normalized(str(candidate)) == m.normalized(name) {
				selected = item
				break
			}
		}
		if selected != nil {
			break
		}
	}
	if selected == nil {
		return nil, nil
	}
	id := number(selected["id"])
	if id <= 0 {
		return nil, nil
	}
	detailResult, err := m.ncm(ctx, fmt.Sprintf("https://music.163.com/weapi/v1/album/%d", id), map[string]any{}, "weapi", "")
	if err != nil {
		return nil, err
	}
	detail := obj(detailResult["album"])
	if number(detail["id"]) != id || m.normalized(str(detail["name"])) != m.normalized(str(selected["name"])) {
		return nil, errors.New("album detail mismatch")
	}
	songs := []map[string]any{}
	for _, raw := range arr(detailResult["songs"]) {
		item := obj(raw)
		names := []string{}
		for _, person := range arr(item["ar"]) {
			names = append(names, str(obj(person)["name"]))
		}
		songs = append(songs, map[string]any{"id": str(item["id"]), "name": str(item["name"]), "artist": strings.Join(names, " / "), "duration": number(item["dt"]), "number": number(item["no"]), "disc": choose(str(item["cd"]), "1")})
	}
	aliases := []string{}
	for _, raw := range arr(detail["alias"]) {
		aliases = append(aliases, str(raw))
	}
	tags := []string{}
	for _, tag := range strings.FieldsFunc(str(detail["tags"]), func(r rune) bool { return strings.ContainsRune(",，、", r) }) {
		if strings.TrimSpace(tag) != "" {
			tags = append(tags, strings.TrimSpace(tag))
		}
	}
	return map[string]any{"id": str(detail["id"]), "name": str(detail["name"]), "picture": m.localArtwork(ctx, str(detail["picUrl"])), "description": choose(str(detail["description"]), str(detail["briefDesc"])), "artist": choose(str(obj(detail["artist"])["name"]), str(obj(selected["artist"])["name"]), artist), "type": str(detail["type"]), "subType": str(detail["subType"]), "company": str(detail["company"]), "publishTime": number(detail["publishTime"]), "size": number(detail["size"]), "aliases": aliases, "tags": tags, "commentCount": number(obj(detail["info"])["commentCount"]), "shareCount": number(obj(detail["info"])["shareCount"]), "songs": songs}, nil
}

var _ = sql.ErrNoRows
