// Package condenser provides log condensing functionality ported from TypeScript
package condenser

import "regexp"

// Ignore patterns - lines matching these should be filtered out
var (
	// "Player passes priority" - noise
	IgnorePriorityPass = regexp.MustCompile(`(?i)player\s+passes\s+priority`)
	
	// "Untap step" - phase marker, not an action
	IgnoreUntapStep = regexp.MustCompile(`(?i)untap\s+step`)
	
	// "Draw step" - normal draw happens every turn
	IgnoreDrawStep = regexp.MustCompile(`(?i)draw\s+step`)
	
	// "Turn N:" with nothing else
	IgnoreBareTurn = regexp.MustCompile(`(?i)^Turn\s+\d+:\s*$`)
)

// All ignore patterns for iteration
var IgnorePatterns = []*regexp.Regexp{
	IgnorePriorityPass,
	IgnoreUntapStep,
	IgnoreDrawStep,
	IgnoreBareTurn,
}

// Keep patterns - lines matching these are significant events
var (
	// Extra card draw (beyond normal draw step)
	KeepExtraDraw = regexp.MustCompile(`(?i)draw(s)?\s+(an?\s+)?(additional|extra|\d+)\s+card|draw\s+\d+\s+card`)
	
	// Life total changes
	KeepLifeChange = regexp.MustCompile(`(?i)life\s+(total\s+)?(change|loss|gain|to)|(\d+)\s+life|loses?\s+\d+\s+life|gains?\s+\d+\s+life`)
	
	// High CMC spell cast (CMC >= 5)
	KeepSpellHighCMC = regexp.MustCompile(`(?i)cast(s|ing)?\s+.*?(?:\(?\s*CMC\s*([5-9]|\d{2,})|\(([5-9]|\d{2,})\s*\))|CMC\s*([5-9]|\d{2,})`)
	
	// Any spell cast
	KeepSpellCast = regexp.MustCompile(`(?i)\bcasts?\s+`)
	
	// Graveyard to battlefield zone change
	KeepZoneChangeGYBF = regexp.MustCompile(`(?i)graveyard\s*->\s*battlefield|graveyard\s+to\s+battlefield|put.*from.*graveyard.*onto.*battlefield`)
	
	// Win condition / game over
	KeepWinCondition = regexp.MustCompile(`(?i)wins?\s+the\s+game|game\s+over|winner|wins\s+the\s+match|loses\s+the\s+game`)
	
	// Commander cast
	KeepCommanderCast = regexp.MustCompile(`(?i)casts?\s+(their\s+)?commander|from\s+command\s+zone`)
	
	// Combat actions
	KeepCombat = regexp.MustCompile(`(?i)attacks?\s+with|declares?\s+attack|combat\s+damage|assigned\s+.*\s+to\s+attack`)
	
	// Land played
	KeepLandPlayed = regexp.MustCompile(`(?i)^Land:`)
)

// Extraction patterns - used to extract metadata
var (
	// Turn line with player (old format)
	ExtractTurnLine = regexp.MustCompile(`(?im)^Turn\s+(\d+)(?::\s*(.+?)\s*)?$`)
	
	// Turn number (both formats)
	ExtractTurnNumber = regexp.MustCompile(`(?im)^Turn:?\s*Turn\s+(\d+)`)
	
	// Turn marker new format: "Turn: Turn N (PlayerName)"
	ExtractTurnMarkerNew = regexp.MustCompile(`(?i)^Turn:\s*Turn\s+(\d+)\s*\((.+)\)\s*$`)
	
	// Turn marker old format: "Turn N: PlayerName"
	ExtractTurnMarkerOld = regexp.MustCompile(`(?i)^Turn\s+(\d+):\s*(.+?)\s*$`)
	
	// Mana production/usage
	ExtractManaProduced = regexp.MustCompile(`(?i)(?:adds?|produces?|tap(s|ped)?\s+for)\s+[\w\s{}\d]*mana|(\d+)\s+mana\s+produced`)
	
	// Tap for mana
	ExtractTapFor = regexp.MustCompile(`(?i)tap(s|ped)?\s+.*?\s+for`)
	
	// Draw multiple cards
	ExtractDrawMultiple = regexp.MustCompile(`(?i)draws?\s+(\d+)\s+cards?`)
	
	// Draw single card
	ExtractDrawSingle = regexp.MustCompile(`(?i)draws?\s+(?:a\s+)?card(?!s)`)
	
	// CMC extraction
	ExtractCMC = regexp.MustCompile(`(?i)\((?:CMC\s*)?(\d+)\)`)
	
	// Winner extraction pattern (note: use ExtractWinnerRegex in condenser.go for function use)
	ExtractWinnerPattern = regexp.MustCompile(`(?i)(.+?)\s+(?:wins\s+the\s+game|has\s+won!?)(?:\s|$|!|\.)`)
	
	// Game result line for splitting concatenated games
	GameResultPattern = regexp.MustCompile(`(?i)^Game Result: Game (\d+) ended`)
)
