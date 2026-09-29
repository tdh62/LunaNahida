package backend

import (
	"bufio"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
)

const maxSourceEntries = 5000

type davMultistatus struct {
	Responses []davResponse `xml:"response"`
}

type davResponse struct {
	Href  string        `xml:"href"`
	Props []davPropstat `xml:"propstat"`
}

type davPropstat struct {
	Status string `xml:"status"`
	Prop   struct {
		ResourceType struct {
			Collection *struct{} `xml:"collection"`
		} `xml:"resourcetype"`
		Size     string `xml:"getcontentlength"`
		ETag     string `xml:"getetag"`
		Modified string `xml:"getlastmodified"`
	} `xml:"prop"`
}

func sourceHTTPClient(item networkSourcePrivate) *http.Client {
	copy := *networkHTTP
	copy.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if err := networkHTTP.CheckRedirect(req, via); err != nil {
			return err
		}
		if item.Username != "" && len(via) > 0 && !sameOrigin(via[0].URL, req.URL) {
			return errors.New("认证请求不能跨站跳转")
		}
		return nil
	}
	return &copy
}

func sameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Host, b.Host)
}

func sourceRequest(ctx context.Context, item networkSourcePrivate, method, target, rangeHeader string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept-Encoding", "identity")
	if method == "PROPFIND" {
		req.Header.Set("Depth", "1")
		req.Header.Set("Content-Type", "application/xml")
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	if item.Username != "" {
		req.SetBasicAuth(item.Username, item.Password)
	}
	return sourceHTTPClient(item).Do(req)
}

func listWebDAV(ctx context.Context, item networkSourcePrivate) ([]remoteEntry, error) {
	root, _ := url.Parse(item.URL)
	rootPath := strings.TrimSuffix(path.Clean(root.EscapedPath()), "/") + "/"
	queue := []string{item.URL}
	visited := map[string]bool{}
	entries := []remoteEntry{}
	for len(queue) > 0 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(visited) > maxSourceEntries {
			return nil, errors.New("WebDAV 文件夹数量超过限制")
		}
		current := queue[0]
		queue = queue[1:]
		if visited[current] {
			continue
		}
		visited[current] = true
		response, err := sourceRequest(ctx, item, "PROPFIND", current, "", bytes.NewBufferString(`<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/></d:prop></d:propfind>`))
		if err != nil {
			return nil, err
		}
		if response.StatusCode != http.StatusMultiStatus {
			response.Body.Close()
			return nil, fmt.Errorf("WebDAV 返回状态 %d", response.StatusCode)
		}
		var listing davMultistatus
		err = xml.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&listing)
		response.Body.Close()
		if err != nil {
			return nil, err
		}
		base, _ := url.Parse(current)
		for _, row := range listing.Responses {
			href, parseErr := url.Parse(row.Href)
			if parseErr != nil {
				return nil, parseErr
			}
			u := base.ResolveReference(href)
			if !sameOrigin(root, u) || u.RawQuery != "" || u.Fragment != "" {
				return nil, errors.New("WebDAV 返回了目录外地址")
			}
			filePath := path.Clean(u.EscapedPath())
			if filePath != strings.TrimSuffix(rootPath, "/") && !strings.HasPrefix(filePath+"/", rootPath) {
				return nil, errors.New("WebDAV 返回了目录外路径")
			}
			if strings.TrimSuffix(filePath, "/") == strings.TrimSuffix(path.Clean(base.EscapedPath()), "/") {
				continue
			}
			var good *davPropstat
			for i := range row.Props {
				if strings.Contains(row.Props[i].Status, " 200 ") {
					good = &row.Props[i]
					break
				}
			}
			if good == nil {
				continue
			}
			if good.Prop.ResourceType.Collection != nil {
				if !strings.HasSuffix(u.Path, "/") {
					u.Path += "/"
				}
				queue = append(queue, u.String())
				continue
			}
			if !audioTypes[strings.ToLower(path.Ext(u.Path))] {
				continue
			}
			size, _ := strconv.ParseInt(good.Prop.Size, 10, 64)
			if size > maxNetworkAudioSize {
				continue
			}
			entries = append(entries, remoteEntry{Key: u.EscapedPath(), URL: u.String(), Size: size, ETag: good.Prop.ETag, LastModified: good.Prop.Modified})
			if len(entries) > maxSourceEntries {
				return nil, errors.New("WebDAV 音频数量超过限制")
			}
		}
	}
	return entries, nil
}

func listHTTPPlaylist(ctx context.Context, item networkSourcePrivate) ([]remoteEntry, error) {
	response, err := sourceRequest(ctx, item, http.MethodGet, item.URL, "", nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP 清单返回状态 %d", response.StatusCode)
	}
	if response.ContentLength > 2<<20 {
		return nil, errors.New("HTTP 清单超过 2 MB")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 2<<20 {
		return nil, errors.New("HTTP 清单超过 2 MB")
	}
	base, _ := url.Parse(item.URL)
	entries := []remoteEntry{}
	seen := map[string]bool{}
	scanner := bufio.NewScanner(bytes.NewReader(bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		link, parseErr := url.Parse(line)
		if parseErr != nil {
			return nil, errors.New("HTTP 清单包含无效地址")
		}
		u := base.ResolveReference(link)
		if !validNetworkURL(u) || !audioTypes[strings.ToLower(path.Ext(u.Path))] {
			return nil, errors.New("HTTP 清单包含不支持的音频地址")
		}
		if !seen[u.String()] {
			entries = append(entries, remoteEntry{Key: u.String(), URL: u.String()})
			seen[u.String()] = true
		}
		if len(entries) > 1000 {
			return nil, errors.New("HTTP 清单超过 1000 首")
		}
	}
	return entries, scanner.Err()
}
