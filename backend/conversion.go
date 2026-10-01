package backend

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	id3v2 "github.com/bogem/id3v2/v2"
	"github.com/go-flac/flacpicture"
	"github.com/go-flac/flacvorbis"
	flac "github.com/go-flac/go-flac"
	"go.uber.org/zap"
	"unlock-music.dev/cli/algo/audio"
	"unlock-music.dev/cli/algo/common"
	_ "unlock-music.dev/cli/algo/kgm"
	_ "unlock-music.dev/cli/algo/kwm"
	_ "unlock-music.dev/cli/algo/ncm"
	_ "unlock-music.dev/cli/algo/qmc"
	_ "unlock-music.dev/cli/algo/tm"
	_ "unlock-music.dev/cli/algo/xiami"
	_ "unlock-music.dev/cli/algo/ximalaya"
)

const backupFolder = ".lunanahida-original-backup"

type ConversionResult struct {
	Source string `json:"source"`
	Output string `json:"output,omitempty"`
	Backup string `json:"backup,omitempty"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
	Track  *Track `json:"track,omitempty"`
}

func encryptedFile(path string) bool {
	if len(common.GetDecoder(path, true)) == 0 {
		return false
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp3", ".flac", ".m4a", ".wav":
		file, err := os.Open(path)
		if err != nil {
			return false
		}
		defer file.Close()
		header := make([]byte, 4)
		_, err = io.ReadFull(file, header)
		return err == nil && bytes.Equal(header, []byte("ifmt"))
	}
	return true
}

func (s *Store) Convert(ctx context.Context, input string, backup, addToLibrary bool) ConversionResult {
	s.convertMu.Lock()
	defer s.convertMu.Unlock()
	result := ConversionResult{Source: input, Status: "failed"}
	path, err := canonical(input)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Source = path
	if !encryptedFile(path) {
		result.Error = "不支持此加密格式"
		return result
	}
	if info, statErr := os.Stat(path); statErr != nil || info.IsDir() {
		result.Error = "源文件不可读取"
		return result
	}
	file, err := os.Open(path)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer file.Close()
	var decoder common.Decoder
	var suffix string
	for _, factory := range common.GetDecoder(path, true) {
		_, _ = file.Seek(0, io.SeekStart)
		candidate := factory.Create(&common.DecoderParams{Reader: file, Extension: filepath.Ext(path), FilePath: path, Logger: zap.NewNop()})
		if err = candidate.Validate(); err == nil {
			decoder, suffix = candidate, factory.Suffix
			break
		}
	}
	if decoder == nil {
		result.Error = "无法还原：可能需要额外密钥，或文件已损坏"
		return result
	}
	provider, providerID := "", ""
	if strings.EqualFold(filepath.Ext(path), ".ncm") {
		provider = "ncm"
	}
	if songID, yes := decoder.(interface{ SongID() int }); yes && songID.SongID() > 0 {
		provider, providerID = "qq", strconv.Itoa(songID.SongID())
	}
	header := make([]byte, 64)
	n, readErr := io.ReadFull(decoder, header)
	if readErr != nil && readErr != io.ErrUnexpectedEOF {
		result.Error = "解密后的音频为空或不完整"
		return result
	}
	header = header[:n]
	ext, ok := audio.Extension(header)
	if !ok && len(header) > 2 && header[0] == 0xff && header[1]&0xe0 == 0xe0 {
		ext, ok = ".mp3", true
	}
	if !ok && bytes.HasPrefix(header, []byte("MAC ")) {
		ext, ok = ".ape", true
	}
	if !ok {
		result.Error = "解密结果不是可识别的音频"
		return result
	}
	name := filepath.Base(path)
	base := name[:len(name)-len(suffix)]
	if base == "" {
		result.Error = "无效的输出文件名"
		return result
	}
	out := filepath.Join(filepath.Dir(path), base+ext)
	if !strings.EqualFold(path, out) {
		if _, statErr := os.Stat(out); statErr == nil {
			result.Error = "目标文件已存在，未覆盖"
			return result
		} else if !errors.Is(statErr, os.ErrNotExist) {
			result.Error = statErr.Error()
			return result
		}
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".lunanahida-convert-*"+ext)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	_, err = io.Copy(tmp, io.MultiReader(bytes.NewReader(header), decoder))
	if syncErr := tmp.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil || ctx.Err() != nil {
		result.Error = "写入转换结果失败"
		return result
	}
	var meta common.AudioMeta
	if getter, yes := decoder.(common.AudioMetaGetter); yes && strings.EqualFold(filepath.Ext(path), ".ncm") {
		meta, _ = getter.GetAudioMeta(ctx)
	}
	var cover []byte
	if getter, yes := decoder.(interface{ EmbeddedCover() []byte }); yes && strings.EqualFold(filepath.Ext(path), ".ncm") {
		cover = getter.EmbeddedCover()
		if len(cover) > 15<<20 {
			cover = nil
		}
	}
	if identified, yes := meta.(interface{ GetMusicID() string }); yes {
		providerID = identified.GetMusicID()
	}
	if meta != nil {
		if err = writeConvertedMeta(ctx, tmpPath, ext, meta, cover); err != nil {
			result.Error = "写入音频标签失败：" + err.Error()
			return result
		}
	}
	if err = verifyConverted(tmpPath, ext); err != nil {
		result.Error = err.Error()
		return result
	}
	_ = file.Close()
	// Retire the source before publishing, so same-extension conversions can replace it safely.
	retired := ""
	if backup {
		folder := filepath.Join(filepath.Dir(path), backupFolder)
		if err = os.MkdirAll(folder, 0700); err != nil {
			result.Error = err.Error()
			return result
		}
		retired = filepath.Join(folder, filepath.Base(path))
		if _, statErr := os.Stat(retired); statErr == nil {
			result.Error = "备份文件已存在，未覆盖"
			return result
		}
	} else {
		retiredFile, createErr := os.CreateTemp(filepath.Dir(path), ".lunanahida-retired-*")
		if createErr != nil {
			result.Error = createErr.Error()
			return result
		}
		retired = retiredFile.Name()
		retiredFile.Close()
		os.Remove(retired)
	}
	if err = os.Rename(path, retired); err != nil {
		result.Error = err.Error()
		return result
	}
	if err = publishConverted(tmpPath, out); err != nil {
		_ = os.Rename(retired, path)
		result.Error = err.Error()
		return result
	}
	if backup {
		result.Backup = retired
	} else {
		if removeErr := os.Remove(retired); removeErr != nil {
			result.Error = "已转换，但源文件清理失败：" + removeErr.Error()
		}
	}
	result.Output, result.Status = out, "converted"
	var existingID int64
	if err := s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, path).Scan(&existingID); err == nil {
		if _, err = s.DB.Exec(`UPDATE tracks SET path=? WHERE id=?`, out, existingID); err != nil {
			if result.Error != "" {
				result.Error += "；"
			}
			result.Error += "已转换，但更新曲库路径失败：" + err.Error()
			return result
		}
		addToLibrary = true
	}
	if addToLibrary {
		track, importErr := s.upsert(out)
		if importErr == nil {
			_, importErr = s.DB.Exec(`UPDATE tracks SET provider=?,provider_id=?,converted=1 WHERE id=?`, provider, providerID, track.ID)
		}
		if importErr == nil {
			if meta != nil {
				track, importErr = s.applyConvertedMeta(track, meta, cover)
			}
			if importErr == nil {
				track, importErr = s.GetTrack(track.ID)
				if importErr == nil {
					result.Track = &track
				}
			}
		}
		if importErr != nil {
			if result.Error != "" {
				result.Error += "；"
			}
			result.Error += "已转换，但加入曲库失败：" + importErr.Error()
		}
	}
	return result
}

func publishConverted(temp, output string) error {
	if err := os.Link(temp, output); err == nil {
		_ = os.Remove(temp)
		return nil
	} else if _, statErr := os.Stat(output); statErr == nil {
		return errors.New("目标文件已存在，未覆盖")
	}
	source, err := os.Open(temp)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(target, source)
	if syncErr := target.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := target.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(output)
		return err
	}
	_ = os.Remove(temp)
	return nil
}

func verifyConverted(path, ext string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() < 64 {
		return errors.New("转换结果过短")
	}
	header := make([]byte, 64)
	_, err = io.ReadFull(file, header)
	if err != nil {
		return err
	}
	detected, ok := audio.Extension(header)
	if !ok && ext == ".mp3" && header[0] == 0xff && header[1]&0xe0 == 0xe0 {
		detected, ok = ".mp3", true
	}
	if !ok && ext == ".ape" && bytes.HasPrefix(header, []byte("MAC ")) {
		detected, ok = ".ape", true
	}
	if !ok || detected != ext && !(detected == ".mp4" && ext == ".m4a") {
		return errors.New("转换结果音频格式不匹配")
	}
	return nil
}

func writeConvertedMeta(ctx context.Context, path, ext string, meta common.AudioMeta, cover []byte) error {
	switch ext {
	case ".mp3":
		tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return err
		}
		defer tag.Close()
		if v := meta.GetTitle(); v != "" {
			tag.SetTitle(v)
		}
		if v := strings.Join(meta.GetArtists(), " / "); v != "" {
			tag.SetArtist(v)
		}
		if v := meta.GetAlbum(); v != "" {
			tag.SetAlbum(v)
		}
		if mime := imageMIME(cover); mime != "" {
			tag.DeleteFrames("APIC")
			tag.AddAttachedPicture(id3v2.PictureFrame{Encoding: id3v2.EncodingUTF8, MimeType: mime, PictureType: id3v2.PTFrontCover, Picture: cover})
		}
		return tag.Save()
	case ".flac":
		f, err := flac.ParseFile(path)
		if err != nil {
			return err
		}
		comment := flacvorbis.MetaDataBlockVorbisComment{Vendor: "LunaNahida"}
		for _, existing := range f.Meta {
			if existing.Type != flac.VorbisComment {
				continue
			}
			parsed, parseErr := flacvorbis.ParseFromMetaDataBlock(*existing)
			if parseErr != nil {
				break
			}
			comment.Vendor = parsed.Vendor
			for _, entry := range parsed.Comments {
				field, _, found := strings.Cut(entry, "=")
				if !found {
					continue
				}
				switch strings.ToUpper(field) {
				case flacvorbis.FIELD_TITLE:
					if meta.GetTitle() != "" {
						continue
					}
				case flacvorbis.FIELD_ALBUM:
					if meta.GetAlbum() != "" {
						continue
					}
				case flacvorbis.FIELD_ARTIST:
					if len(meta.GetArtists()) != 0 {
						continue
					}
				}
				comment.Comments = append(comment.Comments, entry)
			}
			break
		}
		if v := meta.GetTitle(); v != "" {
			_ = comment.Add(flacvorbis.FIELD_TITLE, v)
		}
		if v := meta.GetAlbum(); v != "" {
			_ = comment.Add(flacvorbis.FIELD_ALBUM, v)
		}
		for _, artist := range meta.GetArtists() {
			_ = comment.Add(flacvorbis.FIELD_ARTIST, artist)
		}
		block := comment.Marshal()
		replaced := false
		for i, existing := range f.Meta {
			if existing.Type == flac.VorbisComment {
				f.Meta[i] = &block
				replaced = true
				break
			}
		}
		if !replaced {
			f.Meta = append(f.Meta, &block)
		}
		if mime := imageMIME(cover); mime != "" {
			picture, err := flacpicture.NewFromImageData(flacpicture.PictureTypeFrontCover, "Front cover", cover, mime)
			if err == nil {
				block := picture.Marshal()
				replaced := false
				for i, existing := range f.Meta {
					if existing.Type == flac.Picture {
						f.Meta[i] = &block
						replaced = true
						break
					}
				}
				if !replaced {
					f.Meta = append(f.Meta, &block)
				}
			}
		}
		tagged := path + ".tagged.flac"
		defer os.Remove(tagged)
		if err = f.Save(tagged); err != nil {
			return err
		}
		if err = os.Remove(path); err != nil {
			return err
		}
		return os.Rename(tagged, path)
	default:
		if _, err := exec.LookPath("ffmpeg"); err != nil {
			return nil
		}
		out := path + ".tagged" + ext
		defer os.Remove(out)
		args := []string{"-v", "error", "-nostdin", "-i", path, "-map", "0:a", "-c:a", "copy"}
		if title := meta.GetTitle(); title != "" {
			args = append(args, "-metadata", "title="+title)
		}
		if artist := strings.Join(meta.GetArtists(), " / "); artist != "" {
			args = append(args, "-metadata", "artist="+artist)
		}
		if album := meta.GetAlbum(); album != "" {
			args = append(args, "-metadata", "album="+album)
		}
		args = append(args, "-y", out)
		commandCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		command := exec.CommandContext(commandCtx, "ffmpeg", args...)
		hideCommandWindow(command)
		if output, err := command.CombinedOutput(); err != nil {
			return fmt.Errorf("ffmpeg: %w: %s", err, output)
		}
		if err := os.Remove(path); err != nil {
			return err
		}
		return os.Rename(out, path)
	}
}

func imageMIME(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	mime := http.DetectContentType(data)
	if mime == "image/jpeg" || mime == "image/png" || mime == "image/webp" || mime == "image/gif" {
		return mime
	}
	return ""
}

func (s *Store) applyConvertedMeta(track Track, meta common.AudioMeta, cover []byte) (Track, error) {
	title, artist, album := strings.TrimSpace(meta.GetTitle()), strings.Join(meta.GetArtists(), " / "), strings.TrimSpace(meta.GetAlbum())
	if title == "" {
		title = track.Title
	}
	if artist == "" {
		artist = track.Artist
	}
	if album == "" {
		album = track.Album
	}
	coverPath := track.Cover
	embedded := track.EmbeddedCover
	if mime := imageMIME(cover); mime != "" {
		ext := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}[mime]
		if saved, err := s.SaveCover(bytes.NewReader(cover), ext); err == nil {
			coverPath, embedded = saved, true
		}
	}
	_, err := s.DB.Exec(`UPDATE tracks SET title=CASE WHEN manual_metadata=1 THEN title ELSE ? END,artist=CASE WHEN manual_metadata=1 THEN artist ELSE ? END,album=CASE WHEN manual_metadata=1 THEN album ELSE ? END,cover=?,embedded_cover=? WHERE id=?`, title, artist, album, coverPath, embedded, track.ID)
	if err != nil {
		return track, err
	}
	return s.GetTrack(track.ID)
}
