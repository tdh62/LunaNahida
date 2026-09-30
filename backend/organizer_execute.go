package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func organizeCopy(source, destination string, stamp organizeStamp) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	if copyErr == nil {
		copyErr = output.Sync()
	}
	closeErr := output.Close()
	if copyErr == nil {
		copyErr = closeErr
	}
	if copyErr == nil {
		digest, digestErr := organizeDigest(destination)
		if digestErr != nil {
			copyErr = digestErr
		} else if digest != stamp.Digest {
			copyErr = fmt.Errorf("复制校验失败：%s", source)
		}
	}
	if copyErr == nil {
		copyErr = os.Chtimes(destination, time.Now(), time.Unix(0, stamp.Modified))
	}
	if copyErr != nil {
		_ = os.Remove(destination)
	}
	return copyErr
}

func (o *Organizer) execute(ctx context.Context, input organizeExecute) (organizeResult, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	result := organizeResult{RecoveryPaths: []string{}, RemappedIDs: map[int64]int64{}, Warnings: []string{}, TemporaryTracks: []Track{}}
	plan := o.plans[input.ID]
	if plan == nil || time.Since(plan.created) > 30*time.Minute {
		return result, errors.New("预览已过期，请重新预览")
	}
	operations := append([]organizeOperation{}, plan.operations...)
	if plan.Mode == "deduplicate" {
		reserved := map[string]bool{}
		valid := map[string]bool{}
		for _, group := range plan.Groups {
			valid[group.ID] = true
			keep, chosen := input.Keep[group.ID]
			if !chosen {
				return result, errors.New("请为每组重复音乐选择保留版本，或全部保留")
			}
			if keep == "*" {
				continue
			}
			found := false
			for _, item := range group.Files {
				if strings.EqualFold(item.Path, keep) {
					found = true
					keep = item.Path
					break
				}
			}
			if !found {
				return result, errors.New("保留文件不属于该重复组")
			}
			for _, item := range group.Files {
				if item.Path == keep {
					continue
				}
				directory := filepath.Join(filepath.Dir(item.Path), organizerRecoveryFolder, plan.ID)
				bundle, err := organizeBundle(item, directory, strings.TrimSuffix(filepath.Base(item.Path), filepath.Ext(item.Path)), reserved)
				if err != nil {
					return result, err
				}
				bundle[0].keep = keep
				operations = append(operations, bundle...)
				result.Quarantined++
				present := false
				for _, existing := range result.RecoveryPaths {
					present = present || existing == directory
				}
				if !present {
					result.RecoveryPaths = append(result.RecoveryPaths, directory)
				}
			}
		}
		for id := range input.Keep {
			if !valid[id] {
				return result, errors.New("无效的重复组")
			}
		}
	} else if len(input.Keep) > 0 {
		return result, errors.New("此操作不支持重复音乐选择")
	}
	if len(operations) == 0 {
		delete(o.plans, input.ID)
		return result, nil
	}
	o.store.mu.Lock()
	if o.store.scanning {
		o.store.mu.Unlock()
		return result, errors.New("曲库正在扫描，请稍后执行整理")
	}
	o.store.scanning = true
	o.store.mu.Unlock()
	defer func() { o.store.mu.Lock(); o.store.scanning = false; o.store.mu.Unlock() }()
	for path, stamp := range plan.stamps {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if err := organizeUnchanged(path, stamp); err != nil {
			return result, err
		}
	}
	sidecars := map[string]*organizeSidecarDirectory{}
	for _, item := range plan.files {
		companions, sharedPaths, err := organizeSidecarsCached(item.Path, sidecars)
		if err != nil || strings.Join(companions, "\x00") != strings.Join(item.Companions, "\x00") {
			return result, fmt.Errorf("附属文件列表已变化，请重新预览：%s", item.Path)
		}
		for path, shared := range item.shared {
			if sharedPaths[path] != shared {
				return result, fmt.Errorf("共用附属文件关系已变化，请重新预览：%s", path)
			}
		}
	}
	for _, operation := range operations {
		directory := filepath.Dir(operation.Destination)
		resolved, err := organizeResolved(directory)
		if err != nil || !strings.EqualFold(directory, resolved) {
			return result, fmt.Errorf("目标文件夹已变化或包含符号链接：%s", directory)
		}
		if _, err = os.Lstat(operation.Destination); !errors.Is(err, os.ErrNotExist) {
			return result, fmt.Errorf("目标已存在或无法访问，请重新预览：%s", operation.Destination)
		}
	}
	for _, operation := range operations {
		stamp := plan.stamps[operation.Source]
		if stamp.Digest == "" {
			digest, err := organizeDigestContext(ctx, operation.Source, nil)
			if err != nil {
				return result, err
			}
			if err := organizeUnchanged(operation.Source, stamp); err != nil {
				return result, err
			}
			stamp.Digest = digest
			plan.stamps[operation.Source] = stamp
		}
	}
	manifestDirectory := filepath.Join(o.store.Root, "organizer-history")
	if err := os.MkdirAll(manifestDirectory, 0700); err != nil {
		return result, err
	}
	result.Manifest = filepath.Join(manifestDirectory, plan.ID+".json")
	writeManifest := func(status string) error {
		payload, err := json.MarshalIndent(struct {
			Status     string                   `json:"status"`
			Operations []organizeOperation      `json:"operations"`
			Stamps     map[string]organizeStamp `json:"stamps"`
		}{status, operations, plan.stamps}, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(result.Manifest, payload, 0600)
	}
	if err := writeManifest("pending"); err != nil {
		return result, err
	}
	created := []organizeOperation{}
	removed := map[string]bool{}
	rollback := func(cause error) (organizeResult, error) {
		recoveryErrors := []string{}
		for _, operation := range created {
			if removed[operation.Source] {
				if err := organizeCopy(operation.Destination, operation.Source, plan.stamps[operation.Source]); err != nil {
					recoveryErrors = append(recoveryErrors, operation.Destination+": "+err.Error())
					continue
				}
				delete(removed, operation.Source)
			}
			if err := os.Remove(operation.Destination); err != nil {
				recoveryErrors = append(recoveryErrors, operation.Destination+": "+err.Error())
			}
		}
		delete(o.plans, input.ID)
		if len(recoveryErrors) > 0 {
			_ = writeManifest("recovery-required")
			return result, fmt.Errorf("%w；部分文件需要按记录恢复（%s）：%s", cause, result.Manifest, strings.Join(recoveryErrors, "；"))
		}
		_ = writeManifest("rolled-back")
		return organizeResult{}, fmt.Errorf("整理失败，文件已恢复：%w", cause)
	}
	for _, operation := range operations {
		if err := ctx.Err(); err != nil {
			return rollback(err)
		}
		if err := os.MkdirAll(filepath.Dir(operation.Destination), 0755); err != nil {
			return rollback(err)
		}
		resolved, err := organizeResolved(filepath.Dir(operation.Destination))
		if err != nil || !strings.EqualFold(resolved, filepath.Dir(operation.Destination)) {
			return rollback(errors.New("目标路径已变化，请重新预览"))
		}
		if err := organizeCopy(operation.Source, operation.Destination, plan.stamps[operation.Source]); err != nil {
			return rollback(err)
		}
		created = append(created, operation)
	}
	for path, stamp := range plan.stamps {
		if err := organizeUnchanged(path, stamp); err != nil {
			return rollback(err)
		}
	}
	tx, err := o.store.DB.Begin()
	if err != nil {
		return rollback(err)
	}
	defer tx.Rollback()
	for _, operation := range operations {
		if !operation.audio {
			result.Companions++
			continue
		}
		if operation.keep != "" {
			if err = organizeMergeTrack(tx, operation.Source, operation.keep, result.RemappedIDs); err != nil {
				_ = tx.Rollback()
				return rollback(err)
			}
		} else {
			if _, err = tx.Exec(`UPDATE tracks SET path=?,available=1 WHERE path=?`, operation.Destination, operation.Source); err != nil {
				_ = tx.Rollback()
				return rollback(err)
			}
			result.Moved++
		}
	}
	for _, operation := range operations {
		if operation.CopyOnly || removed[operation.Source] {
			continue
		}
		if err = ctx.Err(); err != nil {
			_ = tx.Rollback()
			return rollback(err)
		}
		if err = os.Remove(operation.Source); err != nil {
			_ = tx.Rollback()
			return rollback(err)
		}
		removed[operation.Source] = true
	}
	if err = tx.Commit(); err != nil {
		return rollback(err)
	}
	o.store.mu.Lock()
	temporary := make(map[int64]Track, len(o.store.temporary))
	for id, track := range o.store.temporary {
		temporary[id] = track
	}
	o.store.mu.Unlock()
	for id, track := range temporary {
		for _, operation := range operations {
			if operation.audio && track.Path == operation.Source {
				if operation.keep != "" {
					if info, err := os.Stat(operation.keep); err == nil {
						if refreshed, err := o.store.readTrack(operation.keep, info); err == nil {
							refreshed.ID, refreshed.Source, refreshed.Temporary = track.ID, track.Source, true
							track = refreshed
						} else {
							result.Warnings = append(result.Warnings, "临时歌曲信息刷新失败："+err.Error())
						}
					}
					track.Path = operation.keep
				} else {
					track.Path = operation.Destination
				}
				track.FileName = filepath.Base(track.Path)
				o.store.mu.Lock()
				if current, exists := o.store.temporary[id]; exists && current.Path == operation.Source {
					o.store.temporary[id] = track
					result.TemporaryTracks = append(result.TemporaryTracks, track)
				}
				o.store.mu.Unlock()
				break
			}
		}
	}
	delete(o.plans, input.ID)
	if err = writeManifest("completed"); err != nil {
		result.Warnings = append(result.Warnings, "文件已整理，但记录写入失败："+err.Error())
	}
	return result, nil
}

func organizeUnchanged(path string, stamp organizeStamp) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != stamp.Size || info.ModTime().UnixNano() != stamp.Modified {
		return fmt.Errorf("预览后文件已变化，请重新预览：%s", path)
	}
	if stamp.Digest == "" {
		return nil
	}
	digest, err := organizeDigest(path)
	if err != nil || digest != stamp.Digest {
		return fmt.Errorf("预览后文件内容已变化：%s", path)
	}
	return nil
}

func organizeMergeTrack(tx *sql.Tx, source, keep string, remapped map[int64]int64) error {
	var sourceID, keepID int64
	err := tx.QueryRow(`SELECT id FROM tracks WHERE path=?`, source).Scan(&sourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	err = tx.QueryRow(`SELECT id FROM tracks WHERE path=?`, keep).Scan(&keepID)
	if errors.Is(err, sql.ErrNoRows) {
		info, statErr := os.Stat(keep)
		if statErr != nil {
			return statErr
		}
		_, err = tx.Exec(`UPDATE tracks SET path=?,size=?,modified=?,duration=0,tags_checked=0,available=1 WHERE id=?`, keep, info.Size(), info.ModTime().UnixNano(), sourceID)
		return err
	}
	if err != nil {
		return err
	}
	for _, query := range []string{
		`INSERT OR IGNORE INTO playlist_tracks(playlist_id,track_id,position) SELECT playlist_id,?,position FROM playlist_tracks WHERE track_id=?`,
		`INSERT OR IGNORE INTO liked(track_id) SELECT ? FROM liked WHERE track_id=?`,
		`INSERT OR IGNORE INTO history(track_id,played_at) SELECT ?,played_at FROM history WHERE track_id=?`,
		`INSERT OR IGNORE INTO queue(track_id,position) SELECT ?,position FROM queue WHERE track_id=?`,
		`INSERT OR IGNORE INTO track_custom_tags(track_id,name) SELECT ?,name FROM track_custom_tags WHERE track_id=?`,
	} {
		if _, err = tx.Exec(query, keepID, sourceID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`DELETE FROM tracks WHERE id=?`, sourceID); err != nil {
		return err
	}
	remapped[sourceID] = keepID
	return nil
}
