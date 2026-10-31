import { useEffect, useState } from 'react';
import { fetchWithAuth, getApiBase } from '../api';
import { reportHandledError } from '../errorReporting';

interface AddDeckFormProps {
  /** Called with the new deck's id once it's saved. */
  onAdded: (deckId: string) => void;
}

const INPUT_CLASS =
  'w-full min-w-0 px-3 py-2 bg-surface-raised border border-line-strong rounded-md text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-accent';
const BUTTON_CLASS =
  'shrink-0 px-4 py-2 rounded-md text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-strong disabled:bg-surface-raised disabled:text-fg-muted disabled:cursor-not-allowed';

function isMoxfieldDeckUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'moxfield.com' && parsed.hostname !== 'www.moxfield.com') return false;
    return /^\/decks\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Import a deck from Moxfield, Archidekt or ManaBox by URL. When Moxfield's
 * API isn't available, asks for the exported deck list instead.
 */
export function AddDeckForm({ onAdded }: AddDeckFormProps) {
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // null = loading, true = direct fetch works, false = manual paste required
  const [moxfieldEnabled, setMoxfieldEnabled] = useState<boolean | null>(null);

  const apiBase = getApiBase();
  const isMoxfieldUrl = isMoxfieldDeckUrl(deckUrl);
  const showManualPaste = isMoxfieldUrl && moxfieldEnabled === false;

  useEffect(() => {
    fetchWithAuth(`${apiBase}/api/moxfield-status`)
      .then((res) => res.json())
      .then((data) => setMoxfieldEnabled(data.enabled))
      .catch((err) => {
        reportHandledError(err, { action: 'checkMoxfieldStatus' });
        setMoxfieldEnabled(false);
      });
  }, [apiBase]);

  const handleSave = async () => {
    setSaveError(null);
    setSaveMessage(null);
    setIsSaving(true);

    try {
      let body: Record<string, string>;
      const tryingMoxfieldUrl = isMoxfieldUrl && !!deckUrl.trim() && !showManualPaste;

      if (showManualPaste && deckText.trim()) {
        body = { deckText: deckText.trim(), deckLink: deckUrl.trim() };
        if (deckName.trim()) body.deckName = deckName.trim();
      } else if (deckUrl.trim()) {
        body = { deckUrl: deckUrl.trim() };
      } else {
        throw new Error(showManualPaste ? 'Please paste your deck list from Moxfield' : 'Please enter a deck URL');
      }

      const doPost = async () => {
        const res = await fetchWithAuth(`${apiBase}/api/decks/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        return { response: res, data };
      };

      let result = await doPost();

      if (tryingMoxfieldUrl && !result.response.ok) {
        result = await doPost();
        if (!result.response.ok) {
          reportHandledError(new Error(result.data.error || 'Moxfield import failed'), { action: 'saveDeck', source: 'moxfield' });
          setMoxfieldEnabled(false);
          setSaveError(
            "Couldn't import from Moxfield automatically. Please paste your deck list below (Export → MTGO on Moxfield).",
          );
          return;
        }
      }

      if (!result.response.ok) {
        throw new Error(result.data.error || 'Failed to save deck');
      }

      setSaveMessage(`Added "${result.data.name}" and selected it.`);
      setDeckUrl('');
      setDeckText('');
      setDeckName('');
      onAdded(result.data.id);
    } catch (err) {
      reportHandledError(err, { action: 'saveDeck' });
      setSaveError(err instanceof Error ? err.message : 'Failed to save deck');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">Import a deck from Moxfield, Archidekt or ManaBox.</p>

      <div className="flex gap-2">
        <input
          type="url"
          value={deckUrl}
          onChange={(e) => setDeckUrl(e.target.value)}
          onKeyDown={(e) => {
            // The form lives inside the simulation form; Enter adds the deck instead of submitting it.
            if (e.key === 'Enter') {
              e.preventDefault();
              if (deckUrl.trim() && !isSaving) handleSave();
            }
          }}
          placeholder="https://archidekt.com/decks/..."
          aria-label="Deck URL"
          className={INPUT_CLASS}
        />
        {!showManualPaste && (
          <button type="button" onClick={handleSave} disabled={isSaving || !deckUrl.trim()} className={BUTTON_CLASS}>
            {isSaving ? 'Adding...' : 'Add'}
          </button>
        )}
      </div>

      {showManualPaste && (
        <>
          <div className="rounded-md border border-amber-600 bg-amber-900/30 p-3">
            <p className="mb-2 text-sm text-amber-200">
              <strong>Moxfield requires manual export.</strong> Follow these steps:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-amber-100/80">
              <li>Open your deck on Moxfield (link above)</li>
              <li>Click the <span className="font-medium text-amber-100">Export</span> button (top right)</li>
              <li>Select <span className="font-medium text-amber-100">MTGO</span> format</li>
              <li>Click <span className="font-medium text-amber-100">Copy to Clipboard</span></li>
              <li>Paste below</li>
            </ol>
          </div>
          <input
            type="text"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            placeholder="Deck name (optional)"
            aria-label="Deck name (optional)"
            className={INPUT_CLASS}
          />
          <textarea
            value={deckText}
            onChange={(e) => setDeckText(e.target.value)}
            placeholder={`Paste your deck list here...\n\nExample:\n1 Sol Ring\n1 Command Tower\n1 Arcane Signet`}
            aria-label="Deck list text"
            rows={8}
            className={`${INPUT_CLASS} resize-y font-mono`}
          />
          <button type="button" onClick={handleSave} disabled={isSaving || !deckText.trim()} className={BUTTON_CLASS}>
            {isSaving ? 'Adding...' : 'Add deck'}
          </button>
        </>
      )}

      {saveMessage && (
        <div className="rounded-md border border-green-500 bg-green-900/50 px-3 py-2 text-sm text-green-200">{saveMessage}</div>
      )}
      {saveError && (
        <div className="rounded-md border border-red-500 bg-red-900/50 px-3 py-2 text-sm text-red-200">{saveError}</div>
      )}
    </div>
  );
}
