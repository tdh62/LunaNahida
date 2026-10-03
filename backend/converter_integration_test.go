package backend

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/dhowden/tag"
)

// Run explicitly with an executable and fixtures exported by the module repository.
// No decoder imports or private source paths are needed in the player Go module.
func TestRealConverterIntegration(t *testing.T) {
	executable, fixtures := os.Getenv("LUNANAHIDA_TEST_CONVERTER"), os.Getenv("LUNANAHIDA_TEST_FIXTURES")
	if executable == "" && fixtures == "" {
		t.Skip("set LUNANAHIDA_TEST_CONVERTER and LUNANAHIDA_TEST_FIXTURES for real-module integration")
	}
	if !filepath.IsAbs(executable) || !filepath.IsAbs(fixtures) {
		t.Fatal("integration executable and fixture paths must be absolute")
	}
	for _, item := range []struct{ name, extension string }{{"qmc", ".mp3"}, {"ncm-mp3", ".mp3"}, {"ncm-flac", ".flac"}} {
		t.Run(item.name, func(t *testing.T) {
			s := testStore(t)
			s.converter.cancel()
			s.converter = newConverter(executable)
			if !s.ConversionAvailable() {
				t.Fatal("real converter is incompatible or unavailable")
			}
			suffix := ".ncm"
			if item.name == "qmc" {
				suffix = ".qmc0"
			}
			input, err := os.ReadFile(filepath.Join(fixtures, item.name+suffix))
			if err != nil {
				t.Fatal(err)
			}
			source := filepath.Join(t.TempDir(), "歌曲 空格"+suffix)
			if err = os.WriteFile(source, input, 0600); err != nil {
				t.Fatal(err)
			}
			result := s.Convert(context.Background(), source, true, true)
			if result.Status != "converted" || result.Error != "" || result.Track == nil || filepath.Ext(result.Output) != item.extension {
				t.Fatalf("real module conversion: %+v", result)
			}
			backup, err := os.ReadFile(result.Backup)
			if err != nil || !bytes.Equal(backup, input) {
				t.Fatalf("backup differs: %v", err)
			}
			if _, err = os.Stat(source); !os.IsNotExist(err) {
				t.Fatal("player did not retire source after successful conversion")
			}
			actual, err := os.ReadFile(result.Output)
			if err != nil {
				t.Fatal(err)
			}
			if suffix == ".qmc0" {
				want, err := os.ReadFile(filepath.Join(fixtures, "qmc.mp3"))
				if err != nil || !bytes.Equal(actual, want) {
					t.Fatalf("QMC restored bytes differ: %v", err)
				}
			} else {
				track := result.Track
				if track.Title != "Local title" || track.Artist != "Local artist" || !track.EmbeddedCover || track.ProviderID != "123456" {
					t.Fatalf("player metadata: %+v", track)
				}
				file, err := os.Open(result.Output)
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
				metadata, err := tag.ReadFrom(file)
				if err != nil || metadata.Title() != "Local title" || metadata.Picture() == nil {
					t.Fatalf("restored tags: %v", err)
				}
			}
			// The same executable must also preserve input in standalone mode and reject collisions.
			if err = os.WriteFile(source, input, 0600); err != nil {
				t.Fatal(err)
			}
			output := t.TempDir()
			args := []string{"restore", source, "--output-dir", output}
			if data, err := exec.Command(executable, args...).CombinedOutput(); err != nil {
				t.Fatalf("standalone: %v %s", err, data)
			}
			after, _ := os.ReadFile(source)
			if !bytes.Equal(after, input) {
				t.Fatal("standalone changed source")
			}
			if err = exec.Command(executable, args...).Run(); err == nil {
				t.Fatal("standalone overwrote existing output")
			}
		})
	}
}
