package restoreprotocol

import (
	"encoding/json"
	"lunanahida/internal/restoreformats"
	"os"
	"reflect"
	"testing"
)

// Check the public wire examples, limits and classifications rather than importing the other repository.
func TestPublicContract(t *testing.T) {
	data, err := os.ReadFile("../../docs/music-restore-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		Module                                                 string
		Protocol, ClassificationRevision, MaxMessage, MaxCover int
		Suffixes                                               []string
		Description, Request, Response                         json.RawMessage
	}
	if err = json.Unmarshal(data, &contract); err != nil {
		t.Fatal(err)
	}
	if contract.Module != Module || contract.Protocol != Version || contract.ClassificationRevision != ClassificationRevision || contract.MaxMessage != MaxMessage || contract.MaxCover != MaxCover {
		t.Fatal("protocol differs from the public contract")
	}
	if !reflect.DeepEqual(contract.Suffixes, restoreformats.Suffixes) {
		t.Fatal("classification differs from the public contract")
	}
	for name, item := range map[string]struct {
		data  json.RawMessage
		value any
	}{
		"description": {contract.Description, &Description{}},
		"request":     {contract.Request, &Request{}},
		"response":    {contract.Response, &Response{}},
	} {
		if err := json.Unmarshal(item.data, item.value); err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(item.value)
		if err != nil {
			t.Fatal(err)
		}
		var original, roundtrip any
		json.Unmarshal(item.data, &original)
		json.Unmarshal(encoded, &roundtrip)
		if !reflect.DeepEqual(original, roundtrip) {
			t.Fatalf("%s wire fields changed", name)
		}
	}
}
