package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"lunanahida/internal/restoreformats"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const organizerRecoveryFolder = ".luma-organizer-recovery"

type organizeOptions struct {
	Paths     []string `json:"paths"`
	Target    string   `json:"target"`
	Mode      string   `json:"mode"`
	Template  string   `json:"template"`
	MatchMode string   `json:"matchMode,omitempty"`
}
type organizeMove struct {
	Source      string   `json:"source"`
	Destination string   `json:"destination"`
	Companions  []string `json:"companions"`
}
type organizeGroup struct {
	ID            string         `json:"id"`
	Match         string         `json:"match"`
	Files         []organizeFile `json:"files"`
	SuggestedKeep string         `json:"suggestedKeep"`
}
type organizeStamp struct {
	Size     int64
	Modified int64
	Digest   string
}
type organizeOperation struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	CopyOnly    bool   `json:"copyOnly"`
	audio       bool
	keep        string
}
type organizePlan struct {
	ID         string          `json:"id"`
	Mode       string          `json:"mode"`
	Moves      []organizeMove  `json:"moves"`
	Groups     []organizeGroup `json:"groups"`
	Warnings   []string        `json:"warnings"`
	Scanned    int             `json:"scanned"`
	MatchMode  string          `json:"matchMode"`
	created    time.Time
	operations []organizeOperation
	stamps     map[string]organizeStamp
	files      []organizeFile
}
type organizeExecute struct {
	ID   string            `json:"id"`
	Keep map[string]string `json:"keep"`
}
type organizeResult struct {
	TemporaryTracks []Track         `json:"temporaryTracks"`
	Warnings        []string        `json:"warnings"`
	Moved           int             `json:"moved"`
	Quarantined     int             `json:"quarantined"`
	Companions      int             `json:"companions"`
	RecoveryPaths   []string        `json:"recoveryPaths"`
	Manifest        string          `json:"manifest"`
	RemappedIDs     map[int64]int64 `json:"remappedIds"`
}
type Organizer struct {
	store *Store
	mu    sync.Mutex
	plans map[string]*organizePlan
}

func newOrganizer(store *Store) *Organizer {
	return &Organizer{store: store, plans: map[string]*organizePlan{}}
}

func (o *Organizer) register(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/organizer/preview", func(w http.ResponseWriter, r *http.Request) {
		var options organizeOptions
		if err := decode(r, &options); err != nil {
			fail(w, 400, err)
			return
		}
		if strings.Contains(r.Header.Get("Accept"), "application/x-ndjson") {
			w.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			ctx, cancel := context.WithCancel(r.Context())
			defer cancel()
			encoder := json.NewEncoder(w)
			send := func(value any) {
				if err := encoder.Encode(value); err != nil {
					cancel()
					return
				}
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
			plan, err := o.previewWithProgress(ctx, options, func(progress organizeProgress) { send(map[string]any{"progress": progress}) })
			if err != nil {
				send(map[string]any{"error": err.Error()})
				return
			}
			send(map[string]any{"plan": plan})
			return
		}
		plan, err := o.preview(r.Context(), options)
		if err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, plan)
	})
	mux.HandleFunc("POST /api/organizer/execute", func(w http.ResponseWriter, r *http.Request) {
		var input organizeExecute
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		result, err := o.execute(r.Context(), input)
		if err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, result)
	})
}

func organizeResolved(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("请输入绝对路径")
	}
	path = filepath.Clean(path)
	ancestor := path
	for {
		if _, err := os.Lstat(ancestor); err == nil {
			resolved, err := filepath.EvalSymlinks(ancestor)
			if err != nil {
				return "", err
			}
			relative, err := filepath.Rel(ancestor, path)
			if err != nil {
				return "", err
			}
			return filepath.Join(resolved, relative), nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return "", errors.New("路径不存在")
		}
		ancestor = parent
	}
}

func (o *Organizer) preview(ctx context.Context, options organizeOptions) (*organizePlan, error) {
	return o.previewWithProgress(ctx, options, nil)
}

func (o *Organizer) previewWithProgress(ctx context.Context, options organizeOptions, emit func(organizeProgress)) (*organizePlan, error) {
	reporter := &organizeReporter{value: organizeProgress{Phase: "discover", Quick: options.MatchMode == "quick"}, emit: emit}
	reporter.send(true)
	o.mu.Lock()
	defer o.mu.Unlock()
	for id, plan := range o.plans {
		if time.Since(plan.created) > 30*time.Minute {
			delete(o.plans, id)
		}
	}
	if len(options.Paths) == 0 || len(options.Paths) > 100 {
		return nil, errors.New("请选择 1–100 个来源路径")
	}
	if options.MatchMode == "" {
		options.MatchMode = "content"
	}
	if options.MatchMode != "content" && options.MatchMode != "quick" || options.MatchMode == "quick" && options.Mode != "deduplicate" {
		return nil, errors.New("无效的匹配方式，快速匹配仅用于去重")
	}
	switch options.Mode {
	case "rename", "artist", "deduplicate", "consolidate":
	default:
		return nil, errors.New("无效的整理操作")
	}
	if options.Mode == "rename" {
		if strings.TrimSpace(options.Template) == "" {
			return nil, errors.New("请填写命名格式")
		}
		remaining := options.Template
		for _, token := range []string{"{title}", "{artist}", "{album}", "{filename}"} {
			remaining = strings.ReplaceAll(remaining, token, "")
		}
		if strings.ContainsAny(remaining, "{}") {
			return nil, errors.New("命名格式只支持 {title}、{artist}、{album}、{filename}")
		}
	}
	plan := &organizePlan{ID: randomHex(16), Mode: options.Mode, Moves: []organizeMove{}, Groups: []organizeGroup{}, Warnings: []string{}, created: time.Now(), stamps: map[string]organizeStamp{}}
	plan.MatchMode = options.MatchMode
	target := ""
	if options.Target != "" && options.Mode != "deduplicate" {
		root, err := organizeResolved(strings.TrimSpace(options.Target))
		if err != nil {
			return nil, err
		}
		if info, statErr := os.Stat(root); statErr == nil && !info.IsDir() {
			return nil, errors.New("目标路径不是文件夹")
		}
		target = root
	} else if options.Mode == "artist" || options.Mode == "consolidate" {
		return nil, errors.New("请选择目标文件夹")
	}
	paths := map[string]bool{}
	for _, source := range options.Paths {
		root, err := canonical(strings.TrimSpace(source))
		if err != nil {
			return nil, err
		}
		if err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() {
				if entry.Name() == organizerRecoveryFolder || entry.Name() == backupFolder || restoreformats.JobDirectory(entry.Name()) {
					return filepath.SkipDir
				}
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 || !audioTypes[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			paths[path] = true
			reporter.value.Total, reporter.value.Current = len(paths), path
			reporter.send(false)
			if len(paths) > 5000 {
				return errors.New("单次最多整理 5000 首，请分批处理")
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	ordered := make([]string, 0, len(paths))
	for path := range paths {
		ordered = append(ordered, path)
	}
	sort.Strings(ordered)
	cache := map[string]organizeFile{}
	if options.MatchMode == "quick" {
		var err error
		cache, err = o.organizeCachedMetadata(ctx)
		if err != nil {
			return nil, err
		}
		plan.Warnings = append(plan.Warnings, "快速匹配不读取音频内容：使用曲库中未过期的元数据；无可用元数据时仅按同名与文件大小匹配。全部为疑似重复，必须逐组选择，不会自动保留。执行移动时仍进行完整复制校验。")
	}
	reporter.value.Phase, reporter.value.Total = "scan", len(ordered)
	if options.MatchMode != "quick" {
		for _, path := range ordered {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			info, err := os.Lstat(path)
			if err != nil {
				return nil, err
			}
			reporter.value.TotalBytes += info.Size()
		}
	}
	reporter.send(true)
	sidecars := map[string]*organizeSidecarDirectory{}
	files := []organizeFile{}
	for _, path := range ordered {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		reporter.value.Current = path
		reporter.send(false)
		var item organizeFile
		var err error
		if options.MatchMode == "quick" {
			item, err = organizeQuickRead(path, cache)
		} else {
			item, err = organizeReadContext(ctx, path, func(count int64) { reporter.value.Bytes += count; reporter.send(false) })
		}
		if err != nil {
			return nil, err
		}
		item.Companions, item.shared, err = organizeSidecarsCached(path, sidecars)
		if err != nil {
			return nil, err
		}
		files = append(files, item)
		plan.stamps[path] = organizeStamp{item.Size, item.Modified, item.Digest}
		for _, companion := range item.Companions {
			if _, present := plan.stamps[companion]; present {
				continue
			}
			info, err := os.Lstat(companion)
			if err != nil || !info.Mode().IsRegular() {
				return nil, fmt.Errorf("无法读取附属文件：%s", companion)
			}
			digest := ""
			if options.MatchMode != "quick" {
				digest, err = organizeDigestContext(ctx, companion, nil)
				if err != nil {
					return nil, err
				}
			}
			plan.stamps[companion] = organizeStamp{info.Size(), info.ModTime().UnixNano(), digest}
		}
		if !item.Tagged && (options.Mode == "rename" || options.Mode == "artist") {
			plan.Warnings = append(plan.Warnings, path+"：标签不完整，使用文件名或未知歌手")
		}
		for companion, shared := range item.shared {
			if shared {
				plan.Warnings = append(plan.Warnings, companion+"：多个音频共用，复制到新位置并保留原文件")
			}
		}
		reporter.value.Processed++
		reporter.send(false)
	}
	reporter.value.Phase = "group"
	reporter.send(true)
	plan.Scanned = len(files)
	plan.files = files
	if options.Mode == "deduplicate" {
		plan.Groups = organizeDuplicates(files)
	} else {
		reserved := map[string]bool{}
		for _, item := range files {
			directory := target
			if directory == "" {
				directory = filepath.Dir(item.Path)
			}
			stem := strings.TrimSuffix(filepath.Base(item.Path), filepath.Ext(item.Path))
			if options.Mode == "rename" {
				stem = organizeName(strings.NewReplacer("{title}", item.Title, "{artist}", item.Artist, "{album}", item.Album, "{filename}", stem).Replace(options.Template))
			}
			if options.Mode == "artist" {
				directory = filepath.Join(directory, organizeName(item.Artist))
			}
			operations, err := organizeBundle(item, directory, stem, reserved)
			if err != nil {
				return nil, err
			}
			if len(operations) == 0 {
				continue
			}
			plan.operations = append(plan.operations, operations...)
			plan.Moves = append(plan.Moves, organizeMove{item.Path, operations[0].Destination, item.Companions})
		}
	}
	if len(o.plans) >= 8 {
		var oldest *organizePlan
		for _, existing := range o.plans {
			if oldest == nil || existing.created.Before(oldest.created) {
				oldest = existing
			}
		}
		delete(o.plans, oldest.ID)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	o.plans[plan.ID] = plan
	reporter.value.Phase = "ready"
	reporter.send(true)
	return plan, nil
}

func organizeDuplicates(files []organizeFile) []organizeGroup {
	groups := []organizeGroup{}
	parents := make([]int, len(files))
	for index := range parents {
		parents[index] = index
	}
	var root func(int) int
	root = func(index int) int {
		if parents[index] != index {
			parents[index] = root(parents[index])
		}
		return parents[index]
	}
	buckets := map[string][]int{}
	for index, item := range files {
		identity := "name:" + strings.ToLower(strings.TrimSpace(item.Title))
		if item.Tagged {
			identity = "tags:" + strings.ToLower(item.Title+"\x00"+item.Artist+"\x00"+item.Album)
		}
		if item.Digest == "" && !item.Tagged {
			identity += fmt.Sprintf(":size:%d", item.Size)
		}
		keys := []string{identity}
		if item.Digest != "" {
			keys = append(keys, "hash:"+item.Digest)
		}
		for _, key := range keys {
			buckets[key] = append(buckets[key], index)
		}
	}
	for key, indices := range buckets {
		if len(indices) < 2 {
			continue
		}
		anchor := -1
		if strings.HasPrefix(key, "hash:") {
			anchor = indices[0]
		} else {
			for _, index := range indices {
				if files[index].Duration == 0 {
					anchor = index
					break
				}
			}
		}
		if anchor >= 0 {
			for _, index := range indices {
				parents[root(index)] = root(anchor)
			}
			continue
		}
		sort.Slice(indices, func(first, second int) bool { return files[indices[first]].Duration < files[indices[second]].Duration })
		for position := 1; position < len(indices); position++ {
			previous, index := indices[position-1], indices[position]
			if math.Abs(files[index].Duration-files[previous].Duration) <= 2 {
				parents[root(index)] = root(previous)
			}
		}
	}
	sets := map[int][]organizeFile{}
	for index, item := range files {
		sets[root(index)] = append(sets[root(index)], item)
	}
	for _, items := range sets {
		if len(items) < 2 {
			continue
		}
		group := organizeGroup{ID: items[0].Path, Match: "filename", Files: items}
		identical, tagged := true, true
		for _, item := range items {
			identical = identical && item.Digest != "" && item.Digest == items[0].Digest
			tagged = tagged && item.Tagged
		}
		if tagged {
			group.Match = "metadata"
		}
		if identical {
			group.Match = "exact"
			group.SuggestedKeep = items[0].Path
		}
		groups = append(groups, group)
	}
	sort.Slice(groups, func(first, second int) bool { return groups[first].ID < groups[second].ID })
	return groups
}

func organizeBundle(item organizeFile, directory, stem string, reserved map[string]bool) ([]organizeOperation, error) {
	for suffix := 1; suffix <= 10000; suffix++ {
		name := stem
		if suffix > 1 {
			name = fmt.Sprintf("%s (%d)", stem, suffix)
		}
		destination := filepath.Join(directory, name+filepath.Ext(item.Path))
		if strings.EqualFold(destination, item.Path) {
			return nil, nil
		}
		operations := []organizeOperation{{Source: item.Path, Destination: destination, audio: true}}
		for _, path := range item.Companions {
			base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
			companionName := name
			if strings.EqualFold(base, filepath.Base(item.Path)) {
				companionName += filepath.Ext(item.Path)
			}
			operations = append(operations, organizeOperation{Source: path, Destination: filepath.Join(directory, companionName+filepath.Ext(path)), CopyOnly: item.shared[path]})
		}
		collision := false
		local := map[string]bool{}
		for _, operation := range operations {
			key := strings.ToLower(operation.Destination)
			if reserved[key] || local[key] {
				collision = true
				break
			}
			local[key] = true
			if _, err := os.Lstat(operation.Destination); err == nil {
				collision = true
				break
			} else if !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
		}
		if collision {
			continue
		}
		for key := range local {
			reserved[key] = true
		}
		return operations, nil
	}
	return nil, errors.New("同名文件过多，无法分配安全文件名")
}
