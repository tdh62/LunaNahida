package backend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"lunanahida/internal/restorefiles"
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprotocol"
	"os"
	"path/filepath"
	"strings"
)

func copyRecovery(ctx context.Context, source io.Reader, path string) error {
	target, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer target.Close()
	buffer := make([]byte, 128<<10)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := source.Read(buffer)
		if n > 0 {
			if _, e := target.Write(buffer[:n]); e != nil {
				return e
			}
		}
		if err == io.EOF {
			return target.Sync()
		}
		if err != nil {
			return err
		}
	}
}

type ConversionJob struct {
	Path         string `json:"path"`
	Source       string `json:"source"`
	Output       string `json:"output"`
	Retired      string `json:"retired"`
	Stage        string `json:"stage"`
	SourceExists bool   `json:"sourceExists"`
	OutputExists bool   `json:"outputExists"`
	CanRestore   bool   `json:"canRestore"`
	CanImport    bool   `json:"canImport"`
	Error        string `json:"error,omitempty"`
}

func regularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular()
}

func noRecoveryLinks(path string) bool {
	for current := filepath.Clean(path); ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return false
		}
		if filepath.Dir(current) == current {
			return true
		}
	}
}

// Records are untrusted disk data. Restrict every referenced file to its task's parent.
func readConversionJournal(dir string) (restorefiles.Journal, error) {
	var j restorefiles.Journal
	if !filepath.IsAbs(dir) || !restoreformats.JobDirectory(filepath.Base(dir)) {
		return j, errors.New("无效的任务目录")
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return j, errors.New("任务目录不存在或已被替换")
	}
	if !noRecoveryLinks(dir) {
		return j, errors.New("任务目录不允许链接")
	}
	path, err := restoreformats.StagedFile(dir, "operation.json", restoreprotocol.MaxMessage)
	if err != nil {
		return j, err
	}
	body, err := os.ReadFile(path)
	if err != nil {
		return j, err
	}
	if err = json.Unmarshal(body, &j); err != nil {
		return j, errors.New("操作记录损坏，请打开文件夹检查")
	}
	parent, err := canonical(filepath.Dir(dir))
	if err != nil {
		return j, err
	}
	direct := func(path string) bool {
		directory, e := canonical(filepath.Dir(path))
		return filepath.IsAbs(path) && e == nil && strings.EqualFold(directory, parent)
	}
	if !direct(j.Source) || j.Output != "" && !direct(j.Output) {
		return j, errors.New("记录中的文件路径不属于任务目录")
	}
	if j.Retired != "" {
		backupDir, e := canonical(filepath.Dir(j.Retired))
		isBackup := e == nil && strings.EqualFold(backupDir, filepath.Join(parent, backupFolder)) && strings.EqualFold(filepath.Base(j.Retired), filepath.Base(j.Source))
		if !isBackup && !(direct(j.Retired) && strings.HasPrefix(filepath.Base(j.Retired), ".lunanahida-retired-")) {
			return j, errors.New("无效的源文件副本路径")
		}
	}
	return j, nil
}

// Explicit folder scans also find tasks created by older versions or another installation.
func (s *Store) ConversionJobs(ctx context.Context, folders []string) ([]ConversionJob, error) {
	if !s.convertMu.TryLock() {
		return nil, errors.New("正在还原，请完成或取消后刷新恢复记录")
	}
	defer s.convertMu.Unlock()
	if len(folders) > 16 {
		return nil, errors.New("一次最多检查 16 个目录")
	}
	rows, err := s.DB.Query(`SELECT path FROM folders`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			rows.Close()
			return nil, err
		}
		if info, e := os.Stat(path); e == nil && info.IsDir() {
			folders = append(folders, path)
		}
	}
	rows.Close()
	visited := 0
	for _, folder := range folders {
		root, err := canonical(folder)
		if err != nil {
			return nil, err
		}
		err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			visited++
			if visited > 50000 {
				return errors.New("检查目录过多，请选择更小的文件夹")
			}
			if walkErr != nil {
				if path == root {
					return walkErr
				}
				return nil
			}
			if !entry.IsDir() {
				return nil
			}
			if restoreformats.JobDirectory(entry.Name()) {
				if _, err := s.DB.Exec(`INSERT OR IGNORE INTO conversion_jobs(path) VALUES(?)`, path); err != nil {
					return err
				}
				return filepath.SkipDir
			}
			if entry.Name() == backupFolder || strings.HasPrefix(entry.Name(), ".lunanahida-recovery") {
				return filepath.SkipDir
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	rows, err = s.DB.Query(`SELECT path FROM conversion_jobs ORDER BY path`)
	if err != nil {
		return nil, err
	}
	var paths []string
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			rows.Close()
			return nil, err
		}
		paths = append(paths, path)
	}
	rows.Close()
	jobs := []ConversionJob{}
	for _, path := range paths {
		if _, err := os.Lstat(path); errors.Is(err, os.ErrNotExist) {
			_, _ = s.DB.Exec(`DELETE FROM conversion_jobs WHERE path=?`, path)
			continue
		}
		j, err := readConversionJournal(path)
		job := ConversionJob{Path: path, Source: j.Source, Output: j.Output, Retired: j.Retired, Stage: j.Stage}
		if err != nil {
			job.Error = err.Error()
		} else {
			if j.Stage == "restored" || j.Stage == "completed" {
				continue
			}
			job.SourceExists, job.OutputExists = regularFile(j.Source), regularFile(j.Output)
			job.CanRestore = j.SourceHash != "" && regularFile(j.Retired)
			job.CanImport = j.OutputHash != "" && job.OutputExists
			if j.SourceHash == "" && j.Stage != "decoding" {
				job.Error = "旧版记录缺少文件校验信息，请打开文件夹人工检查"
			}
		}
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func checkRecoveryFile(ctx context.Context, path, expected string) error {
	if expected == "" || !regularFile(path) {
		return errors.New("文件不存在、不是普通文件或缺少校验信息")
	}
	if !noRecoveryLinks(path) {
		return errors.New("恢复文件路径不允许链接")
	}
	digest, err := restorefiles.Digest(ctx, path)
	if err != nil {
		return err
	}
	if digest != expected {
		return errors.New("文件已被修改，保留全部文件，请人工检查")
	}
	return nil
}

func (s *Store) RecoverConversion(ctx context.Context, dir, action string) (ConversionResult, error) {
	s.convertMu.Lock()
	defer s.convertMu.Unlock()
	result := ConversionResult{Status: "failed"}
	var registered string
	if err := s.DB.QueryRow(`SELECT path FROM conversion_jobs WHERE path=?`, dir).Scan(&registered); err != nil {
		return result, errors.New("请先刷新或检查文件夹以发现此任务")
	}
	j, err := readConversionJournal(registered)
	if err != nil {
		return result, err
	}
	if j.Stage == "restored" || j.Stage == "completed" {
		return result, errors.New("此任务已处理，请刷新列表")
	}
	result.Source, result.Output = j.Source, j.Output
	switch action {
	case "restore":
		if err = checkRecoveryFile(ctx, j.Retired, j.SourceHash); err != nil {
			return result, err
		}
		target := j.Source
		if _, err = os.Lstat(target); !errors.Is(err, os.ErrNotExist) {
			target = j.Source + ".recovered-encrypted"
		}
		// Copy through a fresh staged file; both the retired file and any output stay intact.
		staged, err := os.CreateTemp(dir, "recovered-*")
		if err != nil {
			return result, err
		}
		stagedPath := staged.Name()
		staged.Close()
		defer os.Remove(stagedPath)
		body, err := os.Open(j.Retired)
		if err != nil {
			return result, err
		}
		err = copyRecovery(ctx, body, stagedPath)
		body.Close()
		if err != nil {
			return result, err
		}
		if err = checkRecoveryFile(ctx, stagedPath, j.SourceHash); err != nil {
			return result, err
		}
		if err = restorefiles.Publish(stagedPath, target); err != nil {
			return result, err
		}
		j.Stage = "restored"
		if err = j.Save(dir); err != nil {
			return result, err
		}
		result.Status, result.Output = "restored", target
	case "import":
		if err = checkRecoveryFile(ctx, j.Output, j.OutputHash); err != nil {
			return result, err
		}
		if err = restoreformats.Verify(j.Output, filepath.Ext(j.Output)); err != nil {
			return result, err
		}
		// Preserve the original song ID and all its relations when its old path still belongs to it.
		if j.TrackID > 0 {
			if _, err = s.DB.Exec(`UPDATE tracks SET path=? WHERE id=? AND (path=? OR path=?)`, j.Output, j.TrackID, j.Source, j.Output); err != nil {
				return result, err
			}
		}
		track, err := s.upsert(j.Output)
		if err != nil {
			return result, err
		}
		if j.Response != nil && j.Response.Metadata != nil {
			meta := j.Response.Metadata
			var cover []byte
			if meta.CoverFile != "" {
				if coverPath, e := restoreformats.StagedFile(dir, meta.CoverFile, restoreprotocol.MaxCover); e == nil {
					cover, _ = os.ReadFile(coverPath)
				}
			}
			if _, err = s.DB.Exec(`UPDATE tracks SET provider=?,provider_id=?,converted=1 WHERE id=?`, meta.Provider, meta.ProviderID, track.ID); err != nil {
				return result, err
			}
			if track, err = s.applyConvertedMeta(track, meta, cover); err != nil {
				return result, err
			}
		}
		// Recovery deliberately retains source copies, even if the old preference disabled backups.
		j.Stage = "completed"
		if err = j.Save(dir); err != nil {
			return result, err
		}
		result.Status, result.Track = "converted", &track
	default:
		return result, errors.New("未知恢复操作")
	}
	return result, nil
}
