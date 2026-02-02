package condenser

import (
	"strings"
)

// ShouldIgnoreLine determines if a log line should be filtered out
func ShouldIgnoreLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return true // Ignore empty lines
	}

	// Check against ignore patterns
	for _, pattern := range IgnorePatterns {
		if pattern.MatchString(trimmed) {
			// Special case: Draw step with extra card draw should be kept
			if pattern == IgnoreDrawStep || strings.Contains(pattern.String(), "draw") {
				if KeepExtraDraw.MatchString(trimmed) {
					return false // Keep this line - it has extra draw info
				}
			}
			return true // Ignore this line
		}
	}

	return false // Line didn't match any ignore pattern - keep it
}

// FilterLines filters an array of lines, removing noise
func FilterLines(lines []string) []string {
	var result []string
	for _, line := range lines {
		if !ShouldIgnoreLine(line) {
			result = append(result, line)
		}
	}
	return result
}

// SplitAndFilter splits raw log text into lines and filters out noise
func SplitAndFilter(rawLog string) []string {
	// Split on newlines (handles both \n and \r\n)
	lines := strings.Split(strings.ReplaceAll(rawLog, "\r\n", "\n"), "\n")
	return FilterLines(lines)
}

// SplitConcatenatedGames splits a log that contains multiple games
func SplitConcatenatedGames(rawLog string) []string {
	lines := strings.Split(strings.ReplaceAll(rawLog, "\r\n", "\n"), "\n")
	
	var games []string
	var currentGame strings.Builder
	
	for _, line := range lines {
		if GameResultPattern.MatchString(line) {
			// End of a game - save current game and start new one
			currentGame.WriteString(line)
			currentGame.WriteString("\n")
			games = append(games, currentGame.String())
			currentGame.Reset()
		} else {
			currentGame.WriteString(line)
			currentGame.WriteString("\n")
		}
	}
	
	// Don't forget the last game if it doesn't end with Game Result
	if currentGame.Len() > 0 {
		remaining := strings.TrimSpace(currentGame.String())
		if remaining != "" {
			games = append(games, remaining)
		}
	}
	
	// If no games were split, return the original as a single game
	if len(games) == 0 {
		return []string{rawLog}
	}
	
	return games
}
