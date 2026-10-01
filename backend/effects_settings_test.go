package backend

import (
	"math"
	"strings"
	"testing"
)

func TestProfessionalAudioCurveSettingsRoundTrip(t *testing.T) {
	store := testStore(t)
	settings := DefaultSettings()
	if settings.ProfessionalAudio {
		t.Fatal("professional tuning must default off")
	}
	settings.ProfessionalAudio = true
	filter := CustomFilter{FIRSize: 8192, FrequencyBands: []FrequencyBand{{Expression: "0"}}, Time: "0", DurationMs: 400, GainMin: floatPointer(-60), GainMax: floatPointer(60), GainCurve: []GainSegment{{Points: []GainPoint{{Hz: 100, DB: 36}, {Hz: 1000, DB: -40, Slope: floatPointer(0)}}}}}
	settings.CustomEffects = []SavedEffect{{ID: "custom:drawn", Name: "绘制", Filter: filter}}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	restored, err := store.Settings()
	if err != nil || !restored.ProfessionalAudio || restored.CustomEffects[0].Filter.GainCurve[0].Points[0].DB != 36 {
		t.Fatalf("curve lost: %+v, %v", restored, err)
	}
	settings.ProfessionalAudio = false
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("turning professional mode off must preserve saved curves: %v", err)
	}
	for _, invalid := range []float64{61, math.NaN(), math.Inf(1)} {
		settings.CustomEffects[0].Filter.GainCurve[0].Points[0].DB = invalid
		if err := store.SaveSettings(settings); err == nil {
			t.Fatal("invalid curve gain accepted")
		}
	}
}

func TestCustomEffectsPersistWithFrequencyBandsAndFIRSize(t *testing.T) {
	store := testStore(t)
	settings := DefaultSettings()
	settings.CustomEffects = []SavedEffect{
		{ID: "custom:first", Name: "低频曲线", Filter: CustomFilter{FIRSize: 4096, FrequencyBands: []FrequencyBand{{Expression: "3", StartHz: 0, EndHz: floatPointer(1000), TransitionHz: 100}}, Time: "0", DurationMs: 400}},
		{ID: "custom:second", Name: "短回响", Filter: CustomFilter{FIRSize: 8192, FrequencyBands: []FrequencyBand{{Expression: "0", StartHz: 0, TransitionHz: 80}}, Time: "0", DurationMs: 400, Delays: []FilterDelay{{Ms: 190, Gain: 0.45}}}},
	}
	settings.Effect = "custom:second"
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	reloaded, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Effect != settings.Effect || len(reloaded.CustomEffects) != 2 || reloaded.CustomEffects[1].Filter.Delays[0].Ms != 190 || reloaded.CustomEffects[0].Filter.FIRSize != 4096 || reloaded.CustomEffects[0].Filter.FrequencyBands[0].Expression != "3" {
		t.Fatalf("custom effects changed after reload: %+v", reloaded)
	}
	settings.CustomEffects[0].Name = strings.Repeat("音", 25)
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("valid Chinese effect name rejected: %v", err)
	}
	settings.CustomEffects[1].ID = settings.CustomEffects[0].ID
	if err := store.SaveSettings(settings); err == nil {
		t.Fatal("duplicate custom effect ids should fail")
	}
}

func floatPointer(value float64) *float64 { return &value }

func TestCustomEffectFrequencySettingsValidation(t *testing.T) {
	store := testStore(t)
	settings := DefaultSettings()
	settings.CustomEffects = []SavedEffect{{ID: "custom:one", Name: "测试", Filter: CustomFilter{FIRSize: 8192, FrequencyBands: []FrequencyBand{{Expression: "2", StartHz: 0, EndHz: floatPointer(1000), TransitionHz: 80}}, Time: "0", DurationMs: 400}}}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	settings.CustomEffects[0].Filter.FIRSize = 3000
	if err := store.SaveSettings(settings); err == nil {
		t.Fatal("unsupported FIR size should fail")
	}
	settings.CustomEffects[0].Filter.FIRSize = 8192
	settings.CustomEffects[0].Filter.FrequencyBands[0].StartHz = 1200
	if err := store.SaveSettings(settings); err == nil {
		t.Fatal("reversed frequency range should fail")
	}
}
