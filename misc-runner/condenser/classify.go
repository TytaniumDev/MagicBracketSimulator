package condenser

import (
	"strconv"
	"strings"

	"github.com/magic-bracket/misc-runner/types"
)

// ClassifyLine classifies a log line into an event type
// Returns empty string if the line is not significant
func ClassifyLine(line string) types.EventType {
	// Priority 1: Win Condition
	if KeepWinCondition.MatchString(line) {
		return types.EventWinCondition
	}

	// Priority 2: Life Changes
	if KeepLifeChange.MatchString(line) {
		return types.EventLifeChange
	}

	// Priority 3: Zone Changes (Graveyard -> Battlefield)
	if KeepZoneChangeGYBF.MatchString(line) {
		return types.EventZoneChangeGY
	}

	// Priority 4: High CMC Spell Cast
	if KeepSpellHighCMC.MatchString(line) {
		return types.EventSpellHighCMC
	}

	// Also check for CMC in parentheses that the main pattern might miss
	if matches := ExtractCMC.FindStringSubmatch(line); len(matches) > 1 {
		if cmc, err := strconv.Atoi(matches[1]); err == nil && cmc >= 5 {
			return types.EventSpellHighCMC
		}
	}

	// Priority 5: Commander Cast
	if KeepCommanderCast.MatchString(line) {
		return types.EventCommanderCast
	}

	// Priority 6: Extra Card Draw
	if KeepExtraDraw.MatchString(line) {
		return types.EventDrawExtra
	}

	// Priority 7: Combat
	if KeepCombat.MatchString(line) {
		return types.EventCombat
	}

	// Priority 8: Land Played
	if KeepLandPlayed.MatchString(line) {
		return types.EventLandPlayed
	}

	// Priority 9: Generic Spell Cast
	if KeepSpellCast.MatchString(line) {
		return types.EventSpellCast
	}

	// No match
	return ""
}

// CreateEvent creates a GameEvent from a line if it's significant
func CreateEvent(line string, turn *int, player *string) *types.GameEvent {
	eventType := ClassifyLine(line)
	if eventType == "" {
		return nil
	}

	// Truncate line to 200 chars
	truncatedLine := strings.TrimSpace(line)
	if len(truncatedLine) > 200 {
		truncatedLine = truncatedLine[:200]
	}

	event := &types.GameEvent{
		Type: eventType,
		Line: truncatedLine,
	}

	if turn != nil {
		event.Turn = turn
	}
	if player != nil {
		event.Player = player
	}

	return event
}

// ClassifyLines classifies all lines and returns an array of GameEvents
func ClassifyLines(lines []string) []types.GameEvent {
	var events []types.GameEvent
	for _, line := range lines {
		if event := CreateEvent(line, nil, nil); event != nil {
			events = append(events, *event)
		}
	}
	return events
}
