import * as fs from 'fs';
import * as path from 'path';

export interface SavedDeck {
  id: string;
  name: string;
  filename: string;
}

function getDecksDir(): string {
  const forgeEnginePath = process.env.FORGE_ENGINE_PATH || '../forge-simulation-engine';
  return path.resolve(forgeEnginePath, 'decks');
}

/**
 * Parse deck name from .dck file content.
 * Looks for Name=... in the [metadata] section.
 */
function parseDeckName(content: string, fallbackName: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith('name=')) {
      return trimmed.substring(5).trim();
    }
  }
  return fallbackName;
}

/**
 * Create a slug from a deck name for use as filename.
 * e.g. "Doran Big Butts" -> "doran-big-butts"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100); // Limit length
}

/**
 * Validate that a filename is safe (no path traversal, only .dck files).
 */
function isValidDeckFilename(filename: string): boolean {
  // Must end with .dck
  if (!filename.endsWith('.dck')) {
    return false;
  }
  // No path separators or ..
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return false;
  }
  // Must have some content before .dck
  if (filename === '.dck') {
    return false;
  }
  return true;
}

/**
 * List all saved decks from the decks directory.
 */
export function listSavedDecks(): SavedDeck[] {
  const decksDir = getDecksDir();
  
  try {
    if (!fs.existsSync(decksDir)) {
      return [];
    }
    
    const files = fs.readdirSync(decksDir);
    const decks: SavedDeck[] = [];
    
    for (const file of files) {
      if (!file.endsWith('.dck')) {
        continue;
      }
      
      const filePath = path.join(decksDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const fallbackName = file.replace(/\.dck$/, '');
        const name = parseDeckName(content, fallbackName);
        
        decks.push({
          id: file, // Use filename as ID
          name,
          filename: file,
        });
      } catch (err) {
        console.error(`Failed to read deck file ${file}:`, err);
        // Skip this file
      }
    }
    
    // Sort by name
    decks.sort((a, b) => a.name.localeCompare(b.name));
    
    return decks;
  } catch (error) {
    console.error('Failed to list saved decks:', error);
    return [];
  }
}

/**
 * Get a saved deck by its ID (filename).
 */
export function getSavedDeck(id: string): SavedDeck | undefined {
  const decks = listSavedDecks();
  return decks.find(d => d.id === id);
}

/**
 * Read the content of a saved deck file.
 */
export function readSavedDeckContent(filename: string): { name: string; dck: string } | null {
  if (!isValidDeckFilename(filename)) {
    return null;
  }
  
  const decksDir = getDecksDir();
  const filePath = path.join(decksDir, filename);
  
  // Verify the resolved path is still inside decksDir
  const resolvedPath = path.resolve(filePath);
  const resolvedDecksDir = path.resolve(decksDir);
  if (!resolvedPath.startsWith(resolvedDecksDir + path.sep)) {
    return null;
  }
  
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const fallbackName = filename.replace(/\.dck$/, '');
    const name = parseDeckName(content, fallbackName);
    return { name, dck: content };
  } catch {
    return null;
  }
}

/**
 * Save a deck to the decks directory.
 * Returns the saved deck info on success.
 */
export function saveDeck(name: string, dckContent: string): SavedDeck {
  const decksDir = getDecksDir();
  
  // Ensure decks directory exists
  if (!fs.existsSync(decksDir)) {
    fs.mkdirSync(decksDir, { recursive: true });
  }
  
  // Generate filename from name
  let baseFilename = slugify(name);
  if (!baseFilename) {
    baseFilename = 'deck';
  }
  
  let filename = `${baseFilename}.dck`;
  let counter = 1;
  
  // Handle collisions by appending a number
  while (fs.existsSync(path.join(decksDir, filename))) {
    filename = `${baseFilename}-${counter}.dck`;
    counter++;
    if (counter > 1000) {
      throw new Error('Too many deck files with similar names');
    }
  }
  
  const filePath = path.join(decksDir, filename);
  fs.writeFileSync(filePath, dckContent, 'utf-8');
  
  return {
    id: filename,
    name,
    filename,
  };
}

/**
 * Delete a saved deck by filename.
 * Returns true if deleted, false if not found.
 * Throws on invalid filename (security check).
 */
export function deleteSavedDeck(filename: string): boolean {
  if (!isValidDeckFilename(filename)) {
    throw new Error('Invalid deck filename');
  }
  
  const decksDir = getDecksDir();
  const filePath = path.join(decksDir, filename);
  
  // Verify the resolved path is still inside decksDir
  const resolvedPath = path.resolve(filePath);
  const resolvedDecksDir = path.resolve(decksDir);
  if (!resolvedPath.startsWith(resolvedDecksDir + path.sep)) {
    throw new Error('Invalid deck filename');
  }
  
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error(`Failed to delete deck ${filename}:`, err);
    throw new Error('Failed to delete deck');
  }
}
