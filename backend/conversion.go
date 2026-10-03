package backend

import (
	"bytes"
	"context"
	"errors"
	"lunanahida/internal/restorefiles"
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprotocol"
	"os"
	"path/filepath"
	"strings"
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

func encryptedFile(path string) bool { return restoreformats.Encrypted(path) }

func (s *Store) Convert(ctx context.Context, input string, backup, addToLibrary bool) ConversionResult {
	s.convertMu.Lock()
	defer s.convertMu.Unlock()
	result := ConversionResult{Source: input, Status: "failed"}
	if err := ctx.Err(); err != nil {
		result.Status, result.Error = "cancelled", "已取消"
		return result
	}
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

	if !s.ConversionAvailable() {
		result.Error = "未安装或无法使用加密音乐还原模块"
		return result
	}
	before, err := os.Stat(path)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	workDir, err := os.MkdirTemp(filepath.Dir(path), restoreformats.JobPrefix)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	keepJob := false
	journal := restorefiles.Journal{Source: path, Stage: "decoding", Backup: backup, AddToLibrary: addToLibrary}
	_ = s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, path).Scan(&journal.TrackID)
	if err = journal.Save(workDir); err != nil {
		_ = os.RemoveAll(workDir)
		result.Error = err.Error()
		return result
	}
	if _, err = s.DB.Exec(`INSERT INTO conversion_jobs(path) VALUES(?)`, workDir); err != nil {
		_ = os.RemoveAll(workDir)
		result.Error = err.Error()
		return result
	}
	defer func() {
		if !keepJob {
			if err := os.RemoveAll(workDir); err == nil {
				_, _ = s.DB.Exec(`DELETE FROM conversion_jobs WHERE path=?`, workDir)
			}
		}
	}()
	response, err := s.converter.restore(ctx, path, workDir)
	if err != nil {
		result.Error = err.Error()
		if ctx.Err() != nil {
			result.Status, result.Error = "cancelled", "已取消"
		}
		return result
	}
	tmpPath, err := restoreformats.StagedFile(workDir, response.AudioFile, 0)
	if err != nil {
		s.converter.invalidate()
		result.Error = err.Error()
		return result
	}
	if err = restoreformats.Verify(tmpPath, response.Extension); err != nil {
		s.converter.invalidate()
		result.Error = err.Error()
		return result
	}
	name := filepath.Base(path)
	suffix := restoreformats.SourceSuffix(path)
	if suffix == "" || response.SourceSuffix != suffix || len(name) <= len(suffix) {
		s.converter.invalidate()
		result.Error = "模块返回了无效源文件后缀"
		return result
	}
	out := filepath.Join(filepath.Dir(path), name[:len(name)-len(suffix)]+response.Extension)
	if !strings.EqualFold(path, out) {
		if _, err := os.Stat(out); !errors.Is(err, os.ErrNotExist) {
			result.Error = "目标文件已存在或无法访问，未覆盖"
			return result
		}
	}
	meta := response.Metadata
	provider, providerID := "", ""
	var cover []byte
	if meta != nil {
		provider, providerID = meta.Provider, meta.ProviderID
		if meta.CoverFile != "" {
			coverPath, coverErr := restoreformats.StagedFile(workDir, meta.CoverFile, restoreprotocol.MaxCover)
			if coverErr != nil {
				s.converter.invalidate()
				result.Error = coverErr.Error()
				return result
			}
			cover, err = os.ReadFile(coverPath)
			if err != nil {
				result.Error = err.Error()
				return result
			}
		}
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		result.Error = "源文件在还原期间发生变化"
		return result
	}
	if err = ctx.Err(); err != nil {
		result.Status, result.Error = "cancelled", "已取消"
		return result
	}
	journal.Output, journal.Stage, journal.Response = out, "staging", &response
	journal.SourceHash, err = restorefiles.Digest(ctx, path)
	if err == nil {
		journal.OutputHash, err = restorefiles.Digest(ctx, tmpPath)
	}
	if err != nil {
		result.Error = err.Error()
		if ctx.Err() != nil {
			result.Status, result.Error = "cancelled", "已取消"
		}
		return result
	}
	if current, e := os.Stat(path); e != nil || !os.SameFile(before, current) || before.Size() != current.Size() || !before.ModTime().Equal(current.ModTime()) {
		result.Error = "源文件在还原期间发生变化"
		return result
	}
	if err = journal.Save(workDir); err != nil {
		result.Error = err.Error()
		return result
	}
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
	journal.Retired, journal.Stage = retired, "source-retired"
	if err = journal.Save(workDir); err != nil {
		result.Error = err.Error()
		return result
	}
	if err = restorefiles.Retire(path, retired); err != nil {
		result.Error = err.Error()
		return result
	}
	if err = restorefiles.Publish(tmpPath, out); err != nil {
		if rollbackErr := restorefiles.Retire(retired, path); rollbackErr != nil {
			keepJob = true
			result.Error = "恢复源文件失败，请检查：" + retired + "；记录：" + workDir
			return result
		}
		result.Error = err.Error()
		return result
	}
	journal.Stage = "published"
	if err = journal.Save(workDir); err != nil {
		keepJob = true
		result.Error = "已转换，但操作记录未完成：" + workDir
	}
	if backup {
		result.Backup = retired
	} else {
		if removeErr := os.Remove(retired); removeErr != nil {
			keepJob = true
			result.Error = "已转换，但源文件清理失败：" + removeErr.Error() + "；源文件副本：" + retired + "；记录：" + workDir
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
			keepJob = true
			result.Error += "；记录：" + workDir
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
			keepJob = true
			result.Error += "；记录：" + workDir
		}
	}
	if !keepJob {
		journal.Stage = "completed"
		if err := journal.Save(workDir); err != nil {
			keepJob = true
			result.Error += "；操作记录未完成：" + workDir
		}
	}
	return result
}

func (s *Store) applyConvertedMeta(track Track, meta *restoreprotocol.Metadata, cover []byte) (Track, error) {
	title, artist, album := strings.TrimSpace(meta.Title), strings.Join(meta.Artists, " / "), strings.TrimSpace(meta.Album)
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
	if mime := restoreformats.ImageMIME(cover); mime != "" {
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
