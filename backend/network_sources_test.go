package backend

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestWebDAVSourceScanPlaybackAndOutage(t *testing.T) {
	store := testStore(t)
	var offline atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "listener" || password != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if offline.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.Method == "PROPFIND" {
			if r.Header.Get("Depth") != "1" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusMultiStatus)
			if r.URL.Path == "/dav/music/" {
				_, _ = w.Write([]byte(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/music/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/music/album/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`))
			} else {
				_, _ = w.Write([]byte(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/music/album/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/music/album/song.wav</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype/><d:getcontentlength>8</d:getcontentlength><d:getetag>"first"</d:getetag></d:prop></d:propstat></d:response></d:multistatus>`))
			}
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("Content-Length", "8")
		_, _ = w.Write([]byte("RIFFdata"))
	}))
	defer server.Close()
	source, scan, err := store.AddNetworkSource(context.Background(), "webdav", server.URL+"/dav/music", "listener", "secret")
	if err != nil || scan.Added != 1 {
		t.Fatalf("add WebDAV: %+v, %+v, %v", source, scan, err)
	}
	state, err := store.State()
	if err != nil || len(state.NetworkSources) != 1 || len(state.Tracks) != 1 || state.Tracks[0].Deletable || state.Tracks[0].Kind != "network" {
		t.Fatalf("state: %+v, %v", state.NetworkSources, err)
	}
	if strings.Contains(fmt.Sprint(state), "secret") {
		t.Fatal("secret leaked into state")
	}
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, state.Tracks[0].Source, nil))
	if response.Code != http.StatusOK || response.Body.String() != "RIFFdata" {
		t.Fatalf("WebDAV playback: %d %q", response.Code, response.Body.String())
	}
	offline.Store(true)
	result, err := store.Scan(context.Background())
	if err != nil || len(result.Errors) != 1 {
		t.Fatalf("offline scan: %+v, %v", result, err)
	}
	track, err := store.GetTrack(state.Tracks[0].ID)
	if err != nil || !track.Available {
		t.Fatalf("offline track: %+v, %v", track, err)
	}
	if err = store.RemoveNetworkSource(source.ID); err != nil {
		t.Fatal(err)
	}
	state, err = store.State()
	if err != nil || len(state.NetworkSources) != 0 || len(state.Tracks) != 0 {
		t.Fatalf("removed source: %+v, %v", state.NetworkSources, err)
	}
}

func TestHTTPPlaylistSource(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/list/music.m3u" {
			_, _ = w.Write([]byte("#EXTM3U\n../songs/first.mp3\n../songs/second.wav\n"))
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write([]byte("RIFFdata"))
	}))
	defer server.Close()
	source, scan, err := store.AddNetworkSource(context.Background(), "playlist", server.URL+"/list/music.m3u?token=private", "", "")
	if err != nil || scan.Added != 2 {
		t.Fatalf("playlist: %+v, %+v, %v", source, scan, err)
	}
	if strings.Contains(source.URL, "private") {
		t.Fatal("playlist token leaked")
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 2 || strings.Contains(fmt.Sprint(state.NetworkSources), "private") {
		t.Fatalf("playlist state: %+v, %v", state.NetworkSources, err)
	}
}

func TestFTPRange(t *testing.T) {
	for _, tc := range []struct {
		request    string
		start, end int64
	}{{"", 0, 99}, {"bytes=10-19", 10, 19}, {"bytes=95-", 95, 99}, {"bytes=-5", 95, 99}} {
		start, end, err := parseFTPRange(tc.request, 100)
		if err != nil || start != tc.start || end != tc.end {
			t.Fatalf("range %q: %d-%d, %v", tc.request, start, end, err)
		}
	}
	for _, request := range []string{"bytes=101-", "bytes=5-4", "bytes=0-1,4-5", "other"} {
		if _, _, err := parseFTPRange(request, 100); err == nil {
			t.Fatalf("accepted %q", request)
		}
	}
}

func TestFTPSourceScanAndSeek(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, _ = fmt.Fprint(conn, "220 Ready\r\n")
				scanner := bufio.NewScanner(conn)
				var data net.Listener
				var offset int
				for scanner.Scan() {
					line := scanner.Text()
					command, argument, _ := strings.Cut(line, " ")
					switch command {
					case "USER":
						_, _ = fmt.Fprint(conn, "331 Password\r\n")
					case "PASS":
						_, _ = fmt.Fprint(conn, "230 Logged in\r\n")
					case "FEAT":
						_, _ = fmt.Fprint(conn, "500 No features\r\n")
					case "TYPE", "OPTS":
						_, _ = fmt.Fprint(conn, "200 OK\r\n")
					case "EPSV":
						data, _ = net.Listen("tcp", "127.0.0.1:0")
						port := data.Addr().(*net.TCPAddr).Port
						_, _ = fmt.Fprintf(conn, "229 Entering Extended Passive Mode (|||%d|)\r\n", port)
					case "REST":
						offset, _ = strconv.Atoi(argument)
						_, _ = fmt.Fprint(conn, "350 Restarting\r\n")
					case "LIST":
						_, _ = fmt.Fprint(conn, "150 Opening data\r\n")
						stream, acceptErr := data.Accept()
						if acceptErr == nil {
							if argument == "/music" {
								_, _ = fmt.Fprint(stream, "drwxr-xr-x 1 owner group 0 Sep 29 12:00 album\r\n")
							} else {
								_, _ = fmt.Fprint(stream, "-rw-r--r-- 1 owner group 8 Sep 29 12:00 song.wav\r\n")
							}
							_ = stream.Close()
						}
						_ = data.Close()
						_, _ = fmt.Fprint(conn, "226 Complete\r\n")
					case "RETR":
						_, _ = fmt.Fprint(conn, "150 Opening data\r\n")
						stream, acceptErr := data.Accept()
						if acceptErr == nil {
							_, _ = fmt.Fprint(stream, "RIFFdata"[offset:])
							_ = stream.Close()
						}
						_ = data.Close()
						_, _ = fmt.Fprint(conn, "226 Complete\r\n")
					case "QUIT":
						_, _ = fmt.Fprint(conn, "221 Bye\r\n")
						return
					default:
						_, _ = fmt.Fprint(conn, "500 Unknown\r\n")
					}
				}
			}()
		}
	}()
	store := testStore(t)
	source, scan, err := store.AddNetworkSource(context.Background(), "ftp", "ftp://"+listener.Addr().String()+"/music", "listener", "secret")
	if err != nil || scan.Added != 1 {
		t.Fatalf("FTP scan: %+v, %v", scan, err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 1 {
		t.Fatalf("FTP state: %d, %v", len(state.Tracks), err)
	}
	request := httptest.NewRequest(http.MethodGet, state.Tracks[0].Source, nil)
	request.Header.Set("Range", "bytes=4-7")
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "data" || response.Header().Get("Content-Range") != "bytes 4-7/8" {
		t.Fatalf("FTP seek: %d %q %q", response.Code, response.Body.String(), response.Header().Get("Content-Range"))
	}
	if err = store.RecordPlay(state.Tracks[0].ID); err != nil {
		t.Fatal(err)
	}
	waitForNetworkCache(t, store, state.Tracks[0].ID)
	if err = store.RemoveNetworkSource(source.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(store.networkCachePath(state.Tracks[0].ID)); !os.IsNotExist(err) {
		t.Fatalf("source cache remained: %v", err)
	}
}
