package backend

import (
	"bytes"
	"context"
	"crypto/aes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dhowden/tag"
	"go.uber.org/zap"
	"unlock-music.dev/cli/algo/common"
	"unlock-music.dev/cli/algo/ncm"
)

func ncmEncryptBlock(t *testing.T, data, key []byte) []byte {
	t.Helper()
	cipher, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	padding := aes.BlockSize - len(data)%aes.BlockSize
	data = append(data, bytes.Repeat([]byte{byte(padding)}, padding)...)
	result := make([]byte, len(data))
	for i := 0; i < len(data); i += aes.BlockSize {
		cipher.Encrypt(result[i:i+aes.BlockSize], data[i:i+aes.BlockSize])
	}
	return result
}

func ncmAudioBox(key []byte) []byte {
	box := make([]byte, 256)
	for i := range box {
		box[i] = byte(i)
	}
	var j byte
	for i := range box {
		j = box[i] + j + key[i%len(key)]
		box[i], box[j] = box[j], box[i]
	}
	result := make([]byte, 256)
	for i := range result {
		si := box[byte(i+1)]
		sj := box[byte(i+1)+si]
		result[i] = box[si+sj]
	}
	return result
}

func makeNCMFixture(t *testing.T, path string) {
	makeNCMFixtureWithAudio(t, path, "qmc0_static_target.bin", "mp3", "123456")
}

func makeNCMFixtureWithAudio(t *testing.T, path, fixture, format, musicID string) {
	t.Helper()
	audio, err := os.ReadFile(filepath.Join("..", "third_party", "unlock-music", "algo", "qmc", "testdata", fixture))
	if err != nil {
		t.Fatal(err)
	}
	key := []byte("local-test-key")
	core := []byte{0x68, 0x7a, 0x48, 0x52, 0x41, 0x6d, 0x73, 0x6f, 0x35, 0x6b, 0x49, 0x6e, 0x62, 0x61, 0x78, 0x57}
	metaKey := []byte{0x23, 0x31, 0x34, 0x6c, 0x6a, 0x6b, 0x5f, 0x21, 0x5c, 0x5d, 0x26, 0x30, 0x55, 0x3c, 0x27, 0x28}
	keyData := ncmEncryptBlock(t, append([]byte("neteasecloudmusic"), key...), core)
	for i := range keyData {
		keyData[i] ^= 0x64
	}
	meta := []byte(`music:{"musicName":"Local title","artist":[["Local artist",123]],"album":"Local album","musicId":` + musicID + `,"format":"` + format + `"}`)
	metaData := append([]byte("163 key(Don't modify):"), []byte(base64.StdEncoding.EncodeToString(ncmEncryptBlock(t, meta, metaKey)))...)
	for i := 22; i < len(metaData); i++ {
		metaData[i] ^= 0x63
	}
	cover := image.NewRGBA(image.Rect(0, 0, 2, 2))
	cover.Set(0, 0, color.RGBA{R: 220, G: 80, B: 70, A: 255})
	var picture bytes.Buffer
	if err := png.Encode(&picture, cover); err != nil {
		t.Fatal(err)
	}
	box := ncmAudioBox(key)
	for i := range audio {
		audio[i] ^= box[i&0xff]
	}
	var file bytes.Buffer
	file.WriteString("CTENFDAM")
	file.Write([]byte{0, 0})
	write := func(data []byte) { _ = binary.Write(&file, binary.LittleEndian, uint32(len(data))); file.Write(data) }
	write(keyData)
	write(metaData)
	file.Write(make([]byte, 5))
	_ = binary.Write(&file, binary.LittleEndian, uint32(picture.Len()))
	write(picture.Bytes())
	file.Write(audio)
	if err := os.WriteFile(path, file.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
}

func qmcFixture(t *testing.T, folder, name string) (string, []byte, []byte) {
	t.Helper()
	base := filepath.Join("..", "third_party", "unlock-music", "algo", "qmc", "testdata", "qmc0_static")
	body, err := os.ReadFile(base + "_raw.bin")
	if err != nil {
		t.Fatal(err)
	}
	suffix, err := os.ReadFile(base + "_suffix.bin")
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(base + "_target.bin")
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(folder, name+".qmc0")
	input := append(body, suffix...)
	if err = os.WriteFile(source, input, 0600); err != nil {
		t.Fatal(err)
	}
	return source, input, want
}

func TestConvertQMCBackupAndLibrary(t *testing.T) {
	store := testStore(t)
	folder := t.TempDir()
	source, encrypted, want := qmcFixture(t, folder, "song")
	result := store.Convert(context.Background(), source, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil {
		t.Fatalf("convert: %+v", result)
	}
	expectedOutput, _ := canonical(filepath.Join(folder, "song.mp3"))
	expectedBackup, _ := canonical(filepath.Join(folder, backupFolder, "song.qmc0"))
	if result.Output != expectedOutput || result.Backup != expectedBackup {
		t.Fatalf("paths: %+v; expected output=%q backup=%q", result, expectedOutput, expectedBackup)
	}
	got, err := os.ReadFile(result.Output)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("decoded output differs: %v", err)
	}
	backup, err := os.ReadFile(result.Backup)
	if err != nil || !bytes.Equal(backup, encrypted) {
		t.Fatalf("backup differs: %v", err)
	}
	if _, err = os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source still exists: %v", err)
	}
	if result.Track.Path != result.Output || result.Track.PlaybackStatus != "unknown" {
		t.Fatalf("library track: %+v", result.Track)
	}
	tracks, err := store.Import([]string{folder}, "library")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("backup reimported: %+v, %v", tracks, err)
	}
}

func TestConvertQMCWithoutBackupAndCollision(t *testing.T) {
	store := testStore(t)
	folder := t.TempDir()
	source, encrypted, _ := qmcFixture(t, folder, "song")
	out := filepath.Join(folder, "song.mp3")
	if err := os.WriteFile(out, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), source, false, false)
	if result.Status != "failed" || result.Error == "" {
		t.Fatalf("collision: %+v", result)
	}
	got, _ := os.ReadFile(source)
	if !bytes.Equal(got, encrypted) {
		t.Fatal("collision changed source")
	}
	got, _ = os.ReadFile(out)
	if !bytes.Equal(got, []byte("existing")) {
		t.Fatal("collision changed target")
	}
	if err := os.Remove(out); err != nil {
		t.Fatal(err)
	}
	result = store.Convert(context.Background(), source, false, false)
	if result.Status != "converted" || result.Backup != "" {
		t.Fatalf("no-backup conversion: %+v", result)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source was not removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(folder, backupFolder)); !os.IsNotExist(err) {
		t.Fatalf("unexpected backup directory: %v", err)
	}
}

func TestUnsupportedPlaybackStatus(t *testing.T) {
	for _, ext := range []string{".wma", ".dff", ".ape"} {
		if got := playbackStatus("song" + ext); got != "unplayable" {
			t.Fatalf("%s: %s", ext, got)
		}
	}
	if got := playbackStatus("song.mp3"); got != "unknown" {
		t.Fatal(got)
	}
}

func TestConvertedDFFStaysInLibraryAsUnplayable(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "dsd.tm0")
	data := append([]byte("FRM8"), make([]byte, 128)...)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Track == nil || result.Track.PlaybackStatus != "unplayable" || filepath.Ext(result.Output) != ".dff" {
		t.Fatalf("dff conversion: %+v", result)
	}
}

func TestConvertNCMEmbeddedMetadata(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "local.ncm")
	makeNCMFixture(t, path)
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil {
		t.Fatalf("ncm conversion: %+v", result)
	}
	track := result.Track
	if track.Title != "Local title" || track.Artist != "Local artist" || track.Album != "Local album" || !track.EmbeddedCover || track.Provider != "ncm" || track.ProviderID != "123456" {
		t.Fatalf("embedded metadata: %+v", track)
	}
	file, err := os.Open(result.Output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	metadata, err := tag.ReadFrom(file)
	if err != nil || metadata.Title() != "Local title" || metadata.Artist() != "Local artist" || metadata.Picture() == nil {
		t.Fatalf("output tags: %v", err)
	}
}

func TestConvertNCMFLACEmbeddedMetadata(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "local.ncm")
	makeNCMFixtureWithAudio(t, path, "mflac_map_target.bin", "flac", "123456")
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil || filepath.Ext(result.Output) != ".flac" {
		t.Fatalf("ncm flac conversion: %+v", result)
	}
	file, err := os.Open(result.Output)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	metadata, err := tag.ReadFrom(file)
	if err != nil || metadata.Title() != "Local title" || metadata.Artist() != "Local artist" || metadata.Picture() == nil {
		t.Fatalf("flac output tags: %v", err)
	}
}

func TestConvertNCMStringMusicID(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "local.ncm")
	makeNCMFixtureWithAudio(t, path, "qmc0_static_target.bin", "mp3", `"123456"`)
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil || result.Track.ProviderID != "123456" {
		t.Fatalf("string music ID conversion: %+v", result)
	}
}

func TestProvidedNCMSample(t *testing.T) {
	sample := filepath.Join("..", "demo_project", "霞光 - 曲锦楠.ncm")
	if _, err := os.Stat(sample); os.IsNotExist(err) {
		t.Skip("sample file is not available")
	}
	file, err := os.Open(sample)
	if err != nil {
		t.Fatal(err)
	}
	decoder := ncm.NewDecoder(&common.DecoderParams{Reader: file, Extension: ".ncm", FilePath: sample, Logger: zap.NewNop()})
	if err = decoder.Validate(); err != nil {
		file.Close()
		t.Fatalf("sample decoder validation: %v", err)
	}
	file.Close()
	store := testStore(t)
	path := filepath.Join(t.TempDir(), filepath.Base(sample))
	data, err := os.ReadFile(sample)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil {
		t.Fatalf("sample conversion: %+v", result)
	}
	if filepath.Ext(result.Output) != ".flac" || result.Track.ProviderID != "2027067479" || result.Track.Title != "霞光" || result.Track.Artist != "曲锦楠" || !result.Track.EmbeddedCover {
		t.Fatalf("sample metadata: %+v", result)
	}
	if _, err = os.Stat(result.Backup); err != nil {
		t.Fatalf("sample backup: %v", err)
	}
	if _, err = os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("sample source was not retired: %v", err)
	}
}

func TestSameExtensionConversionPreservesTrackID(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "typed.mp3")
	want, err := os.ReadFile(filepath.Join("..", "third_party", "unlock-music", "algo", "qmc", "testdata", "qmc0_static_target.bin"))
	if err != nil {
		t.Fatal(err)
	}
	header := []byte{'i', 'f', 'm', 't', ' ', 'M', 'P', '3', 0xfe, 0xfe, 0xfe, 0xfe, 0, 0, 0, 0}
	if err = os.WriteFile(path, append(header, want...), 0600); err != nil {
		t.Fatal(err)
	}
	old, err := store.upsert(path)
	if err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), path, true, false)
	if result.Status != "converted" || result.Track == nil || result.Track.ID != old.ID {
		t.Fatalf("same-path conversion: %+v", result)
	}
	got, err := os.ReadFile(result.Output)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("same-path output differs: %v", err)
	}
	backup, err := os.ReadFile(result.Backup)
	if err != nil || !bytes.HasPrefix(backup, header) {
		t.Fatalf("same-path backup: %v", err)
	}
}

func TestAutoConvertImportAndScan(t *testing.T) {
	store := testStore(t)
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.AutoConvert || !settings.BackupOriginal {
		t.Fatalf("conversion defaults: %+v", settings)
	}
	settings.AutoConvert = true
	if err = store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	folder := t.TempDir()
	qmcFixture(t, folder, "first")
	tracks, err := store.Import([]string{folder}, "watch")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("auto import: %+v, %v", tracks, err)
	}
	qmcFixture(t, folder, "second")
	result, err := store.Scan(context.Background())
	if err != nil || result.Added != 1 || len(result.Errors) != 0 {
		t.Fatalf("auto scan: %+v, %v", result, err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 2 {
		t.Fatalf("library after scan: %+v, %v", state.Tracks, err)
	}
}

func TestDirectIDEnrichmentUsesVerifiedCachedSong(t *testing.T) {
	music := NewMusic(testStore(t))
	if _, err := music.cached("direct:v1:ncm:123456", time.Hour, false, func() (any, error) {
		return song{ID: "123456", Title: "Local title", Artist: "Local artist, Guest"}, nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := music.cached("lyric:ncm:123456:", time.Hour, false, func() (any, error) {
		return map[string]any{"lyric": "[00:01.00]Local lyric", "translation": ""}, nil
	}); err != nil {
		t.Fatal(err)
	}
	result, err := music.enrichWithID(context.Background(), "Local title", "Local artist / Guest", "", false, true, false, "ncm", "123456")
	if err != nil || result.Lyric != "[00:01.00]Local lyric" {
		t.Fatalf("direct enrichment: %+v, %v", result, err)
	}
}
