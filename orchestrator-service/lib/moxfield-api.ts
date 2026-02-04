import { Firestore, Timestamp } from '@google-cloud/firestore';

const MOXFIELD_API_BASE = 'https://api2.moxfield.com/v3';

// Initialize Firestore
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'magic-bracket-simulator',
});

interface MoxfieldCard {
  quantity: number;
  card: {
    name: string;
  };
}

interface MoxfieldDeckResponse {
  name: string;
  mainboard: Record<string, MoxfieldCard>;
  commanders: Record<string, MoxfieldCard>;
}

export interface MoxfieldDeck {
  name: string;
  commanders: { name: string; quantity: number }[];
  mainboard: { name: string; quantity: number }[];
}

export class MoxfieldApi {
  /**
   * Checks if the Moxfield API is configured (User Agent is present).
   */
  static isConfigured(): boolean {
    return !!process.env.MOXFIELD_USER_AGENT;
  }

  /**
   * Fetches a deck from Moxfield using the configured User Agent and global rate limiting.
   */
  static async fetchDeck(deckId: string): Promise<MoxfieldDeck> {
    const userAgent = process.env.MOXFIELD_USER_AGENT;

    if (!userAgent) {
      throw new Error('Moxfield API is not configured (missing MOXFIELD_USER_AGENT).');
    }

    // Enforce rate limit
    await this.enforceRateLimit();

    const url = `${MOXFIELD_API_BASE}/decks/${deckId}`;
    console.log(`[MoxfieldApi] Fetching deck ${deckId}...`);

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Deck not found: ${deckId}`);
      }
      throw new Error(`Failed to fetch Moxfield deck: ${response.status} ${response.statusText}`);
    }

    const data: MoxfieldDeckResponse = await response.json();

    const commanders = Object.values(data.commanders || {}).map(entry => ({
      name: entry.card.name,
      quantity: entry.quantity,
    }));

    const mainboard = Object.values(data.mainboard || {}).map(entry => ({
      name: entry.card.name,
      quantity: entry.quantity,
    }));

    return {
      name: data.name,
      commanders,
      mainboard,
    };
  }

  /**
   * Enforces a global rate limit of 1 request per second using Firestore.
   */
  private static async enforceRateLimit(): Promise<void> {
    const docRef = firestore.collection('system').doc('moxfield_rate_limit');

    // We calculate the delay required inside a transaction to ensure
    // multiple instances respect the global sequence.
    const waitTimeMs = await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      const now = Date.now();
      let lastRequestTime = 0;

      if (doc.exists) {
        const data = doc.data();
        if (data && data.lastRequestTime) {
          lastRequestTime = data.lastRequestTime;
        }
      }

      // If the last request was essentially "in the future" (due to other processes booking slots),
      // we must wait until after that.
      // Otherwise, we can go now (or 1s after the last one).

      // Ideally: next_slot = max(now, last_slot + 1000)
      const nextSlot = Math.max(now, lastRequestTime + 1000);

      transaction.set(docRef, { lastRequestTime: nextSlot });

      return Math.max(0, nextSlot - now);
    });

    if (waitTimeMs > 0) {
      console.log(`[MoxfieldApi] Rate limiting: waiting ${waitTimeMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
    }
  }
}
