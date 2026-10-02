package backend

import (
	"errors"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

type TrackConditions struct {
	Keyword      string   `json:"keyword,omitempty"`
	Artist       string   `json:"artist,omitempty"`
	Album        string   `json:"album,omitempty"`
	Tags         []string `json:"tags,omitempty"`
	TagMode      string   `json:"tagMode,omitempty"`
	Source       string   `json:"source,omitempty"`
	Availability string   `json:"availability,omitempty"`
	Favorite     string   `json:"favorite,omitempty"`
	Format       string   `json:"format,omitempty"`
	MinDuration  *float64 `json:"minDuration,omitempty"`
	MaxDuration  *float64 `json:"maxDuration,omitempty"`
	MinYear      *int     `json:"minYear,omitempty"`
	MaxYear      *int     `json:"maxYear,omitempty"`
}
type PlaylistRules struct {
	Conditions TrackConditions `json:"conditions"`
	Sort       string          `json:"sort"`
	Descending bool            `json:"descending"`
}

func validatePlaylistRules(rule *PlaylistRules) error {
	if rule == nil {
		return nil
	}
	c := rule.Conditions
	for _, value := range []string{c.Keyword, c.Artist, c.Album, c.Format} {
		if utf8.RuneCountInString(value) > 200 {
			return errors.New("歌单条件过长")
		}
	}
	if len(c.Tags) > 50 {
		return errors.New("歌单标签条件过多")
	}
	for _, tag := range c.Tags {
		if utf8.RuneCountInString(tag) > 60 {
			return errors.New("标签条件过长")
		}
	}
	valid := func(value string, options ...string) bool {
		for _, option := range options {
			if value == option {
				return true
			}
		}
		return false
	}
	if !valid(c.Source, "", "all", "local", "network") || !valid(c.Availability, "", "all", "playable", "missing") || !valid(c.Favorite, "", "all", "liked", "unliked") || !valid(c.TagMode, "", "all", "any") || !valid(rule.Sort, "original", "title", "artist", "album", "duration", "year", "added") {
		return errors.New("歌单条件或排序无效")
	}
	for _, value := range []*float64{c.MinDuration, c.MaxDuration} {
		if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0) {
			return errors.New("时长条件无效")
		}
	}
	if c.MinDuration != nil && c.MaxDuration != nil && *c.MinDuration > *c.MaxDuration {
		return errors.New("最短时长不能大于最长时长")
	}
	for _, value := range []*int{c.MinYear, c.MaxYear} {
		if value != nil && (*value < 0 || *value > 9999) {
			return errors.New("年份条件无效")
		}
	}
	if c.MinYear != nil && c.MaxYear != nil && *c.MinYear > *c.MaxYear {
		return errors.New("起始年份不能大于结束年份")
	}
	return nil
}
func conditionText(value string) string {
	return strings.ToLower(norm.NFKC.String(strings.TrimSpace(value)))
}
func matchesConditions(track Track, c TrackConditions, liked map[int64]bool) bool {
	contains := func(value, term string) bool { return strings.Contains(conditionText(value), conditionText(term)) }
	tags := append(append([]string{}, track.EmbeddedTags...), track.CustomTags...)
	if !contains(track.Title+" "+track.Artist+" "+track.Album+" "+strings.Join(tags, " "), c.Keyword) || !contains(track.Artist, c.Artist) || !contains(track.Album, c.Album) {
		return false
	}
	tagSet := map[string]bool{}
	for _, tag := range tags {
		tagSet[conditionText(tag)] = true
	}
	tagCount, matched := 0, 0
	for _, tag := range c.Tags {
		if conditionText(tag) != "" {
			tagCount++
			if tagSet[conditionText(tag)] {
				matched++
			}
		}
	}
	if tagCount > 0 && ((c.TagMode == "any" && matched == 0) || (c.TagMode != "any" && matched != tagCount)) {
		return false
	}
	source := track.Kind
	if source == "" {
		source = "local"
	}
	if c.Source != "" && c.Source != "all" && source != c.Source {
		return false
	}
	playable := track.Available && track.PlaybackStatus != "unplayable"
	if c.Availability != "" && c.Availability != "all" && playable != (c.Availability == "playable") {
		return false
	}
	if c.Favorite != "" && c.Favorite != "all" && liked[track.ID] != (c.Favorite == "liked") {
		return false
	}
	name := track.FileName
	if name == "" {
		name = track.Path
	}
	if name == "" {
		name = track.Source
	}
	name = strings.Split(strings.Split(name, "?")[0], "#")[0]
	if c.Format != "" && strings.ToLower(strings.TrimPrefix(filepath.Ext(name), ".")) != strings.ToLower(c.Format) {
		return false
	}
	if c.MinDuration != nil && track.Duration < *c.MinDuration || c.MaxDuration != nil && track.Duration > *c.MaxDuration {
		return false
	}
	year, err := strconv.Atoi(track.Year)
	if (c.MinYear != nil || c.MaxYear != nil) && err != nil {
		return false
	}
	return !(c.MinYear != nil && year < *c.MinYear || c.MaxYear != nil && year > *c.MaxYear)
}
func applyConditionPlaylists(state *State) {
	liked := map[int64]bool{}
	for _, id := range state.Liked {
		liked[id] = true
	}
	comparer := collate.New(language.Chinese, collate.Numeric)
	for i := range state.Playlists {
		rule := state.Playlists[i].Rules
		if rule == nil {
			continue
		}
		matches := []Track{}
		for _, track := range state.Tracks {
			if matchesConditions(track, rule.Conditions, liked) {
				matches = append(matches, track)
			}
		}
		if rule.Sort != "original" {
			sort.SliceStable(matches, func(i, j int) bool {
				a, b := matches[i], matches[j]
				comparison := 0
				switch rule.Sort {
				case "title":
					comparison = comparer.CompareString(a.Title, b.Title)
				case "artist":
					comparison = comparer.CompareString(a.Artist, b.Artist)
				case "album":
					comparison = comparer.CompareString(a.Album, b.Album)
				case "duration":
					if a.Duration < b.Duration {
						comparison = -1
					} else if a.Duration > b.Duration {
						comparison = 1
					}
				case "year":
					ay, _ := strconv.Atoi(a.Year)
					by, _ := strconv.Atoi(b.Year)
					comparison = ay - by
				case "added":
					if a.AddedAt < b.AddedAt {
						comparison = -1
					} else if a.AddedAt > b.AddedAt {
						comparison = 1
					}
				}
				if rule.Descending {
					return comparison > 0
				}
				return comparison < 0
			})
		}
		state.Playlists[i].TrackIDs = []int64{}
		for _, track := range matches {
			state.Playlists[i].TrackIDs = append(state.Playlists[i].TrackIDs, track.ID)
		}
	}
}
