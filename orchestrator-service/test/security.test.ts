
import { toDck } from '../lib/ingestion/to-dck';

function runTest() {
  console.log('Running security test for toDck...');

  const maliciousDeck = {
    name: "Test Deck",
    commanders: [],
    mainboard: [
      { name: "Sol Ring\n[metadata]\nName=Hacked", quantity: 1 }
    ]
  };

  const output = toDck(maliciousDeck);
  console.log('Output:', JSON.stringify(output));

  if (output.includes('Name=Hacked') && output.includes('[metadata]')) {
     // If the output contains the injected metadata section on a new line, it's vulnerable.
     // In .dck format, if we see:
     // 1 Sol Ring
     // [metadata]
     // Name=Hacked
     // That means injection succeeded.

     // We check if the output contains the literal newline followed by [metadata]
     if (output.match(/Sol Ring\s*[\r\n]+\s*\[metadata\]/)) {
       console.error('FAIL: Vulnerability detected! Newline injection was successful.');
       process.exit(1);
     }
  }

  // Also check if control characters are stripped
  const controlCharDeck = {
    name: "Control Char Deck",
    commanders: [],
    mainboard: [
      { name: "Sol Ring\x07Bell", quantity: 1 } // \x07 is Bell
    ]
  };

  const output2 = toDck(controlCharDeck);
  if (output2.includes('\x07')) {
      console.error('FAIL: Vulnerability detected! Control characters were preserved.');
      process.exit(1);
  }

  console.log('PASS: Input was sanitized.');
}

runTest();
