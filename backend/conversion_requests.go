package backend

import (
	"context"
	"errors"
	"sync"
	"time"
)

// Explicit cancellation also works when the embedded desktop HTTP transport does not
// propagate a browser disconnect. Early cancel messages are remembered briefly.
type conversionRequests struct {
	mu        sync.Mutex
	running   map[string]context.CancelFunc
	cancelled map[string]time.Time
}

func validConversionRequestID(id string) bool {
	if len(id) < 8 || len(id) > 80 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}

func (m *conversionRequests) prune() {
	if m.running == nil {
		m.running = map[string]context.CancelFunc{}
		m.cancelled = map[string]time.Time{}
	}
	for id, when := range m.cancelled {
		if time.Since(when) > time.Minute {
			delete(m.cancelled, id)
		}
	}
}

func (m *conversionRequests) start(parent context.Context, id string) (context.Context, func(), error) {
	ctx, cancel := context.WithCancel(parent)
	if id == "" {
		return ctx, cancel, nil
	}
	if !validConversionRequestID(id) {
		cancel()
		return nil, nil, errors.New("无效的还原请求编号")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	if _, exists := m.running[id]; exists || len(m.running) >= 64 {
		cancel()
		return nil, nil, errors.New("还原请求重复或过多")
	}
	if _, stopped := m.cancelled[id]; stopped {
		cancel()
		delete(m.cancelled, id)
	}
	m.running[id] = cancel
	return ctx, func() { cancel(); m.mu.Lock(); delete(m.running, id); m.mu.Unlock() }, nil
}

func (m *conversionRequests) stop(id string) error {
	if !validConversionRequestID(id) {
		return errors.New("无效的还原请求编号")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prune()
	if cancel, ok := m.running[id]; ok {
		cancel()
		return nil
	}
	if len(m.cancelled) >= 128 {
		return errors.New("取消请求过多，请稍后重试")
	}
	m.cancelled[id] = time.Now()
	return nil
}
