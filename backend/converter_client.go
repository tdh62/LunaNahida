package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"lunanahida/internal/restoreprocess"
	"lunanahida/internal/restoreprotocol"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"time"
)

var errConverterUnavailable = errors.New("未安装或无法使用加密音乐还原模块")

type converterClient struct {
	path      string
	mu        sync.Mutex
	checked   time.Time
	info      os.FileInfo
	available bool
	fault     bool
	reason    string
	ctx       context.Context
	cancel    context.CancelFunc
}

func newConverter(path string) *converterClient {
	if path == "" {
		path = converterOverride()
		if path == "" {
			executable, _ := os.Executable()
			name := "LunaNahida.Converter"
			if runtime.GOOS == "windows" {
				name += ".exe"
			}
			path = filepath.Join(filepath.Dir(executable), "modules", "music-restore", name)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &converterClient{path: path, ctx: ctx, cancel: cancel}
}

func (c *converterClient) ready() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	info, err := os.Stat(c.path)
	if err != nil || !info.Mode().IsRegular() {
		c.available = false
		c.info = nil
		return false
	}
	if c.fault && c.info != nil && os.SameFile(c.info, info) && c.info.Size() == info.Size() && c.info.ModTime().Equal(info.ModTime()) {
		return false
	}
	if c.info != nil && os.SameFile(c.info, info) && c.info.Size() == info.Size() && c.info.ModTime().Equal(info.ModTime()) && time.Since(c.checked) < 2*time.Second {
		return c.available
	}
	// A previously successful handshake stays valid while the executable is unchanged.
	if c.available && c.info != nil && os.SameFile(c.info, info) && c.info.Size() == info.Size() && c.info.ModTime().Equal(info.ModTime()) {
		return true
	}
	c.info, c.checked = info, time.Now()
	c.fault = false
	ctx, cancel := context.WithTimeout(c.ctx, time.Second)
	defer cancel()
	data, err := restoreprocess.Run(ctx, c.path, []string{"--describe", "--managed"}, nil)
	var description restoreprotocol.Description
	if err == nil {
		err = restoreprotocol.Decode(bytes.NewReader(data), &description)
	}
	if err == nil && (description.Module != restoreprotocol.Module || description.Protocol != restoreprotocol.Version || description.ClassificationRevision != restoreprotocol.ClassificationRevision || !slices.Contains(description.Operations, "restore")) {
		err = errors.New("不兼容的还原模块协议")
	}
	c.available = err == nil
	if err != nil && c.reason != err.Error() {
		c.reason = err.Error()
		log.Printf("music restore module unavailable: %s", c.reason)
	}
	return c.available
}

func (s *Store) ConversionAvailable() bool { return s.converter != nil && s.converter.ready() }

func (c *converterClient) invalidate() {
	c.mu.Lock()
	c.available, c.fault = false, true
	c.mu.Unlock()
}

func (c *converterClient) restore(ctx context.Context, source, workDir string) (restoreprotocol.Response, error) {
	var response restoreprotocol.Response
	if !c.ready() {
		return response, errConverterUnavailable
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(c.ctx, cancel)
	defer stop()
	request := restoreprotocol.Request{Protocol: restoreprotocol.Version, RequestID: filepath.Base(workDir), Operation: "restore", Source: source, WorkDir: workDir}
	input, _ := json.Marshal(request)
	data, err := restoreprocess.Run(ctx, c.path, []string{"--worker"}, input)
	if err != nil {
		if ctx.Err() == nil {
			c.mu.Lock()
			c.available, c.fault = false, true
			c.mu.Unlock()
		}
		return response, err
	}
	if err = restoreprotocol.Decode(bytes.NewReader(data), &response); err != nil || response.Protocol != restoreprotocol.Version || response.RequestID != request.RequestID {
		c.mu.Lock()
		c.available = false
		c.fault = true
		c.mu.Unlock()
		return response, errors.New("还原模块返回了无效响应")
	}
	if response.Status == "failed" {
		return response, errors.New(response.Message)
	}
	if response.Status != "ready" {
		c.mu.Lock()
		c.available, c.fault = false, true
		c.mu.Unlock()
		return response, errors.New("还原模块未生成有效结果")
	}
	return response, nil
}
