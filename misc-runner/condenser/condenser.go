package condenser

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/magic-bracket/misc-runner/types"
)

// TurnRange represents a turn segment in the log
type TurnRange struct {
	TurnNumber int
	Player     string
	StartIndex int
	EndIndex   int
}

// ExtractTurnRanges finds all turn boundaries in the log
func ExtractTurnRanges(rawLog string) []TurnRange {
	lines := strings.Split(strings.ReplaceAll(rawLog, "\r\n", "\n"), "\n")
	var ranges []TurnRange

	for i, line := range lines {
		// Try new format first: "Turn: Turn N (PlayerName)"
		if matches := ExtractTurnMarkerNew.FindStringSubmatch(line); len(matches) > 2 {
			turn, _ := strconv.Atoi(matches[1])
			ranges = append(ranges, TurnRange{
				TurnNumber: turn,
				Player:     matches[2],
				StartIndex: i,
			})
			continue
		}

		// Try old format: "Turn N: PlayerName"
		if matches := ExtractTurnMarkerOld.FindStringSubmatch(line); len(matches) > 1 {
			turn, _ := strconv.Atoi(matches[1])
			player := ""
			if len(matches) > 2 {
				player = matches[2]
			}
			ranges = append(ranges, TurnRange{
				TurnNumber: turn,
				Player:     player,
				StartIndex: i,
			})
		}
	}

	// Set end indices
	for i := range ranges {
		if i < len(ranges)-1 {
			ranges[i].EndIndex = ranges[i+1].StartIndex - 1
		} else {
			ranges[i].EndIndex = len(lines) - 1
		}
	}

	return ranges
}

// GetNumPlayers returns the number of players in the game
func GetNumPlayers(turnRanges []TurnRange) int {
	if len(turnRanges) == 0 {
		return 4 // Default for Commander
	}

	// Count unique players in turn 1
	players := make(map[string]bool)
	for _, tr := range turnRanges {
		if tr.TurnNumber == 1 && tr.Player != "" {
			players[tr.Player] = true
		}
	}

	if len(players) > 0 {
		return len(players)
	}

	return 4 // Default for Commander
}

// GetMaxRound returns the maximum round number (turn count)
func GetMaxRound(turnRanges []TurnRange, numPlayers int) int {
	if len(turnRanges) == 0 || numPlayers == 0 {
		return 0
	}

	maxTurn := 0
	for _, tr := range turnRanges {
		if tr.TurnNumber > maxTurn {
			maxTurn = tr.TurnNumber
		}
	}

	// Convert to round (full rotation)
	return (maxTurn + numPlayers - 1) / numPlayers
}

// CalculateManaPerTurn calculates mana events per round
func CalculateManaPerTurn(rawLog string, numPlayers int) map[int]types.TurnManaInfo {
	if numPlayers == 0 {
		numPlayers = 4
	}

	turnRanges := ExtractTurnRanges(rawLog)
	lines := strings.Split(strings.ReplaceAll(rawLog, "\r\n", "\n"), "\n")
	result := make(map[int]types.TurnManaInfo)

	for _, tr := range turnRanges {
		round := (tr.TurnNumber + numPlayers - 1) / numPlayers
		manaEvents := 0

		for i := tr.StartIndex; i <= tr.EndIndex && i < len(lines); i++ {
			if ExtractManaProduced.MatchString(lines[i]) || ExtractTapFor.MatchString(lines[i]) {
				manaEvents++
			}
		}

		if existing, ok := result[round]; ok {
			result[round] = types.TurnManaInfo{ManaEvents: existing.ManaEvents + manaEvents}
		} else {
			result[round] = types.TurnManaInfo{ManaEvents: manaEvents}
		}
	}

	return result
}

// CalculateCardsDrawnPerTurn calculates cards drawn per round
func CalculateCardsDrawnPerTurn(rawLog string, numPlayers int) map[int]int {
	if numPlayers == 0 {
		numPlayers = 4
	}

	turnRanges := ExtractTurnRanges(rawLog)
	lines := strings.Split(strings.ReplaceAll(rawLog, "\r\n", "\n"), "\n")
	result := make(map[int]int)

	for _, tr := range turnRanges {
		round := (tr.TurnNumber + numPlayers - 1) / numPlayers
		cardsDrawn := 0

		for i := tr.StartIndex; i <= tr.EndIndex && i < len(lines); i++ {
			line := lines[i]
			// Check for multiple draws: "draws N cards"
			if matches := ExtractDrawMultiple.FindStringSubmatch(line); len(matches) > 1 {
				if n, err := strconv.Atoi(matches[1]); err == nil {
					cardsDrawn += n
				}
			} else if ExtractDrawSingle.MatchString(line) {
				cardsDrawn++
			}
		}

		result[round] += cardsDrawn
	}

	return result
}

// ExtractWinner finds who won the game
func ExtractWinner(rawLog string) string {
	if matches := ExtractWinnerRegex.FindStringSubmatch(rawLog); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

var ExtractWinnerRegex = regexp.MustCompile(`(?i)(.+?)\s+(?:wins\s+the\s+game|has\s+won!?)`)

// ExtractWinningTurn finds which turn the game ended on
func ExtractWinningTurn(rawLog string) int {
	lines := strings.Split(strings.ReplaceAll(rawLog, "\r\n", "\n"), "\n")
	turnRanges := ExtractTurnRanges(rawLog)
	numPlayers := GetNumPlayers(turnRanges)

	// Find the line with the win condition and determine its turn
	for i, line := range lines {
		if KeepWinCondition.MatchString(line) {
			// Find which turn range this line belongs to
			for _, tr := range turnRanges {
				if i >= tr.StartIndex && i <= tr.EndIndex {
					// Convert to round
					return (tr.TurnNumber + numPlayers - 1) / numPlayers
				}
			}
		}
	}

	// If we can't find the win line in a turn, return the last round
	if len(turnRanges) > 0 {
		return GetMaxRound(turnRanges, numPlayers)
	}

	return 0
}

// CondenseGame condenses a single raw game log into a structured summary
func CondenseGame(rawLog string) types.CondensedGame {
	// Step 1: Filter
	filteredLines := SplitAndFilter(rawLog)

	// Step 2: Classify
	keptEvents := ClassifyLines(filteredLines)

	// Step 3: Extract metrics
	turnRanges := ExtractTurnRanges(rawLog)
	numPlayers := GetNumPlayers(turnRanges)
	turnCount := GetMaxRound(turnRanges, numPlayers)
	manaPerTurn := CalculateManaPerTurn(rawLog, numPlayers)
	cardsDrawnPerTurn := CalculateCardsDrawnPerTurn(rawLog, numPlayers)

	// Step 4: Detect winner
	winner := ExtractWinner(rawLog)
	winningTurn := ExtractWinningTurn(rawLog)

	// Step 5: Build output
	condensed := types.CondensedGame{
		KeptEvents:        keptEvents,
		ManaPerTurn:       manaPerTurn,
		CardsDrawnPerTurn: cardsDrawnPerTurn,
		TurnCount:         turnCount,
	}

	if winner != "" {
		condensed.Winner = winner
	}
	if winningTurn > 0 {
		condensed.WinningTurn = winningTurn
	}

	return condensed
}

// CondenseGames condenses multiple game logs
func CondenseGames(rawLogs []string) []types.CondensedGame {
	result := make([]types.CondensedGame, len(rawLogs))
	for i, log := range rawLogs {
		result[i] = CondenseGame(log)
	}
	return result
}

// BuildAnalyzePayload builds the payload for Gemini analysis
func BuildAnalyzePayload(condensed []types.CondensedGame, deckNames []string, deckLists []string) types.AnalyzePayload {
	// Build deck info
	decks := make([]types.DeckInfo, len(deckNames))
	for i, name := range deckNames {
		decklist := ""
		if i < len(deckLists) {
			decklist = deckLists[i]
		}
		decks[i] = types.DeckInfo{
			Name:     name,
			Decklist: decklist,
		}
	}

	// Build outcomes from condensed games
	outcomes := make(map[string]types.DeckOutcome)
	for _, name := range deckNames {
		outcomes[name] = types.DeckOutcome{
			Wins:         0,
			WinningTurns: []int{},
			TurnsLostOn:  []int{},
		}
	}

	for _, game := range condensed {
		winningTurn := game.WinningTurn
		if winningTurn == 0 {
			winningTurn = game.TurnCount
		}

		for _, name := range deckNames {
			outcome := outcomes[name]
			if game.Winner != "" && strings.Contains(game.Winner, name) {
				outcome.Wins++
				outcome.WinningTurns = append(outcome.WinningTurns, winningTurn)
			} else if game.Winner != "" {
				outcome.TurnsLostOn = append(outcome.TurnsLostOn, winningTurn)
			}
			outcomes[name] = outcome
		}
	}

	return types.AnalyzePayload{
		Decks:      decks,
		TotalGames: len(condensed),
		Outcomes:   outcomes,
	}
}
