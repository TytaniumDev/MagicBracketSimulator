import { toDck, ParsedDeck } from '../lib/ingestion/to-dck';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.log(`✗ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

test('toDck should sanitize newlines in deck name', () => {
  const maliciousDeck: ParsedDeck = {
    name: 'MyDeck\n[commander]\n1 Black Lotus',
    commanders: [{ name: 'Sol Ring', quantity: 1 }],
    mainboard: [{ name: 'Mountain', quantity: 1 }]
  };

  const dck = toDck(maliciousDeck);

  console.log('Generated .dck content:');
  console.log(dck);

  // Vulnerability check:
  // If sanitized (newlines replaced with spaces), we get:
  // Name=MyDeck [commander] 1 Black Lotus

  // If vulnerable, we get:
  // Name=MyDeck
  // [commander]
  // 1 Black Lotus

  // We check if "1 Black Lotus" appears at the start of a line (injection successful)
  // or if [commander] appears twice (injection successful)

  const lines = dck.split('\n');
  const injectedLine = lines.find(line => line.trim() === '1 Black Lotus');
  const commanderSections = lines.filter(line => line.trim() === '[commander]');

  if (injectedLine) {
     throw new Error('Vulnerability reproduced: "1 Black Lotus" found as a separate line');
  }

  if (commanderSections.length > 1) {
     throw new Error('Vulnerability reproduced: Multiple [commander] sections found');
  }

  // Check that newlines are gone from the Name field
  const nameLine = lines.find(line => line.startsWith('Name='));
  if (nameLine && (nameLine.includes('\n') || nameLine.includes('\r'))) {
      throw new Error('Newline found in Name field');
  }

  // Also verify that the original name content is present (but sanitized)
  if (!nameLine?.includes('MyDeck') || !nameLine?.includes('Black Lotus')) {
      throw new Error('Sanitization removed content too aggressively');
  }
});
