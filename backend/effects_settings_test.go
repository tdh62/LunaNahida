package backend

import (
	"strings"
	"testing"
)

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
