package musicrestore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
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
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprocess"
	"lunanahida/internal/restoreprotocol"
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

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func Restore(ctx context.Context, path, workDir string) (restoreprotocol.Response, error) {
	result := restoreprotocol.Response{Protocol: restoreprotocol.Version, Status: "failed"}
	if !restoreformats.Encrypted(path) {
		return result, errors.New("不支持此加密格式")
	}
	file, err := os.Open(path)
	if err != nil {
		result.Message = err.Error()
		return result, errors.New(result.Message)
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
		result.Message = "无法还原：可能需要额外密钥，或文件已损坏"
		return result, errors.New(result.Message)
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
		result.Message = "解密后的音频为空或不完整"
		return result, errors.New(result.Message)
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
		result.Message = "解密结果不是可识别的音频"
		return result, errors.New(result.Message)
	}
	tmp, err := os.CreateTemp(workDir, "audio-*"+ext)
	if err != nil {
		result.Message = err.Error()
		return result, errors.New(result.Message)
	}
	tmpPath := tmp.Name()
	_, err = io.Copy(tmp, contextReader{ctx, io.MultiReader(bytes.NewReader(header), decoder)})
	if syncErr := tmp.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil || ctx.Err() != nil {
		result.Message = "写入转换结果失败"
		return result, errors.New(result.Message)
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
			result.Message = "写入音频标签失败：" + err.Error()
			return result, errors.New(result.Message)
		}
	}
	if err = restoreformats.Verify(tmpPath, ext); err != nil {
		result.Message = err.Error()
		return result, errors.New(result.Message)
	}

	metadata := &restoreprotocol.Metadata{Provider: provider, ProviderID: providerID}
	if meta != nil {
		metadata.Title, metadata.Artists, metadata.Album = meta.GetTitle(), meta.GetArtists(), meta.GetAlbum()
	}
	if restoreformats.ImageMIME(cover) != "" {
		metadata.CoverFile = "cover.image"
		if err := os.WriteFile(filepath.Join(workDir, metadata.CoverFile), cover, 0600); err != nil {
			return result, err
		}
	}
	result.Status, result.AudioFile, result.Extension, result.SourceSuffix, result.Metadata = "ready", filepath.Base(tmpPath), ext, suffix, metadata
	return result, nil
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
		if mime := restoreformats.ImageMIME(cover); mime != "" {
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
		if mime := restoreformats.ImageMIME(cover); mime != "" {
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
		if _, err := restoreprocess.Run(commandCtx, "ffmpeg", args, nil); err != nil {
			return fmt.Errorf("ffmpeg: %w", err)
		}
		if err := os.Remove(path); err != nil {
			return err
		}
		return os.Rename(out, path)
	}
}
