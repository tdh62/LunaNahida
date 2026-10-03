package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestExplicitCancellationBeforeAndDuringRestore(t *testing.T) {
	for _, early := range []bool{true, false} {
		t.Run(map[bool]string{true: "early", false: "running"}[early], func(t *testing.T) {
			t.Setenv("LUNANAHIDA_TEST_MODULE", "wait")
			s := testStore(t)
			s.converter.cancel()
			executable, _ := os.Executable()
			s.converter = newConverter(executable)
			source, encrypted, _ := qmcFixture(t, t.TempDir(), "cancel")
			api := NewAPI(s, Dialogs{})
			server := httptest.NewServer(api.Handler())
			defer server.Close()
			id := "cancel-request-123"
			stop := func() {
				payload, _ := json.Marshal(map[string]string{"requestId": id})
				r, e := http.Post(server.URL+"/api/conversion/cancel", "application/json", bytes.NewReader(payload))
				if e != nil {
					t.Fatal(e)
				}
				r.Body.Close()
				if r.StatusCode != 200 {
					t.Fatal(r.StatusCode)
				}
			}
			if early {
				stop()
			}
			done := make(chan ConversionResult, 1)
			go func() {
				payload, _ := json.Marshal(map[string]any{"path": source, "requestId": id, "addToLibrary": true})
				response, e := http.Post(server.URL+"/api/conversion", "application/json", bytes.NewReader(payload))
				if e != nil {
					done <- ConversionResult{Error: e.Error()}
					return
				}
				defer response.Body.Close()
				var result ConversionResult
				json.NewDecoder(response.Body).Decode(&result)
				done <- result
			}()
			if !early {
				deadline := time.Now().Add(3 * time.Second)
				for {
					api.conversionRequests.mu.Lock()
					running := len(api.conversionRequests.running) > 0
					api.conversionRequests.mu.Unlock()
					if running {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("request did not register")
					}
					time.Sleep(10 * time.Millisecond)
				}
				stop()
			}
			select {
			case result := <-done:
				if result.Status != "cancelled" {
					t.Fatalf("%+v", result)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("cancel failed")
			}
			got, _ := os.ReadFile(source)
			if !bytes.Equal(got, encrypted) {
				t.Fatal("cancel changed source")
			}
			jobs, e := s.ConversionJobs(context.Background(), nil)
			if e != nil || len(jobs) != 0 {
				t.Fatalf("jobs=%+v %v", jobs, e)
			}
			if !s.ConversionAvailable() {
				t.Fatal("cancellation disabled module")
			}
		})
	}
}

func TestCancellationRegistryRejectsDuplicateAndInvalidIDs(t *testing.T) {
	var m conversionRequests
	ctx, done, err := m.start(context.Background(), "request-1234")
	if err != nil {
		t.Fatal(err)
	}
	defer done()
	if _, _, err = m.start(context.Background(), "request-1234"); err == nil {
		t.Fatal("duplicate request accepted")
	}
	if err = m.stop("../bad"); err == nil {
		t.Fatal("bad ID accepted")
	}
	if err = m.stop("request-1234"); err != nil || ctx.Err() == nil {
		t.Fatal("request not cancelled")
	}
}
