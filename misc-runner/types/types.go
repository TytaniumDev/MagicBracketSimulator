// Package types defines the data structures used by the misc-runner.
package types

// EventType represents categories of game events
type EventType string

const (
	EventLifeChange    EventType = "life_change"
	EventSpellCast     EventType = "spell_cast"
	EventSpellHighCMC  EventType = "spell_cast_high_cmc"
	EventLandPlayed    EventType = "land_played"
	EventZoneChangeGY  EventType = "zone_change_gy_to_bf"
	EventWinCondition  EventType = "win_condition"
	EventCommanderCast EventType = "commander_cast"
	EventCombat        EventType = "combat"
	EventDrawExtra     EventType = "draw_extra"
)

// GameEvent represents a single event from the game log
type GameEvent struct {
	Type   EventType `json:"type"`
	Line   string    `json:"line"`
	Turn   *int      `json:"turn,omitempty"`
	Player *string   `json:"player,omitempty"`
}

// TurnManaInfo holds mana information for a turn
type TurnManaInfo struct {
	ManaEvents int `json:"manaEvents"`
}

// CondensedGame is a summary of a single game for AI analysis
type CondensedGame struct {
	KeptEvents        []GameEvent           `json:"keptEvents"`
	ManaPerTurn       map[int]TurnManaInfo  `json:"manaPerTurn"`
	CardsDrawnPerTurn map[int]int           `json:"cardsDrawnPerTurn"`
	TurnCount         int                   `json:"turnCount"`
	Winner            string                `json:"winner,omitempty"`
	WinningTurn       int                   `json:"winningTurn,omitempty"`
}

// DeckAction represents a single action during a turn
type DeckAction struct {
	Line      string    `json:"line"`
	EventType EventType `json:"eventType,omitempty"`
}

// DeckTurnActions holds actions for a deck during a turn
type DeckTurnActions struct {
	TurnNumber int          `json:"turnNumber"`
	Actions    []DeckAction `json:"actions"`
}

// DeckHistory holds complete action history for a deck
type DeckHistory struct {
	DeckLabel string            `json:"deckLabel"`
	Turns     []DeckTurnActions `json:"turns"`
}

// TurnSegment represents a player's actions during a turn
type TurnSegment struct {
	PlayerId string   `json:"playerId"`
	Lines    []string `json:"lines"`
}

// Turn represents all actions during a game turn
type Turn struct {
	TurnNumber int           `json:"turnNumber"`
	Segments   []TurnSegment `json:"segments"`
}

// StructuredGame is the structured representation for frontend visualization
type StructuredGame struct {
	TotalTurns  int                        `json:"totalTurns"`
	Players     []string                   `json:"players"`
	Turns       []Turn                     `json:"turns"`
	Decks       []DeckHistory              `json:"decks"`
	LifePerTurn map[int]map[string]int     `json:"lifePerTurn,omitempty"`
	Winner      string                     `json:"winner,omitempty"`
	WinningTurn int                        `json:"winningTurn,omitempty"`
}

// DeckInfo holds deck information for analysis
type DeckInfo struct {
	Name     string `json:"name"`
	Decklist string `json:"decklist,omitempty"`
}

// DeckOutcome holds per-deck game outcome statistics
type DeckOutcome struct {
	Wins         int   `json:"wins"`
	WinningTurns []int `json:"winning_turns"`
	TurnsLostOn  []int `json:"turns_lost_on"`
}

// AnalyzePayload is the payload sent to Gemini for analysis
type AnalyzePayload struct {
	Decks      []DeckInfo             `json:"decks"`
	TotalGames int                    `json:"total_games"`
	Outcomes   map[string]DeckOutcome `json:"outcomes"`
}

// JobData represents job information fetched from the API
type JobData struct {
	ID          string     `json:"id"`
	Decks       []DeckSlot `json:"decks"`
	Simulations int        `json:"simulations"`
	Parallelism int        `json:"parallelism"`
	Status      string     `json:"status"`
}

// DeckSlot represents a deck in a job
type DeckSlot struct {
	Name string `json:"name"`
	Dck  string `json:"dck"`
}
