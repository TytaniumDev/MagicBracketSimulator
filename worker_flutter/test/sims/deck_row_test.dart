import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/sims/deck_row.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders name and subtitle; tap fires onTap', (tester) async {
    var tapped = 0;
    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'Edgar Markov',
          colorIdentity: const ['W', 'B', 'R'],
          subtitle: 'Edgar Markov',
          isPrecon: false,
          pickIndex: null,
          canDelete: true,
          onTap: () => tapped += 1,
          onDelete: () {},
        ),
      ),
    );

    expect(find.text('Edgar Markov'), findsWidgets);
    await tester.tap(find.text('Edgar Markov').first);
    expect(tapped, 1);
  });

  testWidgets('renders pick index when selected', (tester) async {
    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'Atraxa',
          colorIdentity: const [],
          subtitle: null,
          isPrecon: false,
          pickIndex: 2,
          canDelete: true,
          onTap: () {},
          onDelete: () {},
        ),
      ),
    );

    expect(find.text('2'), findsOneWidget);
  });

  testWidgets('delete icon only when canDelete && pickIndex == null', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'P',
          colorIdentity: const [],
          subtitle: null,
          isPrecon: true,
          pickIndex: null,
          canDelete: false,
          onTap: () {},
          onDelete: () {},
        ),
      ),
    );
    expect(find.byIcon(Icons.delete_outline), findsNothing);

    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'C',
          colorIdentity: const [],
          subtitle: null,
          isPrecon: false,
          pickIndex: 1,
          canDelete: true,
          onTap: () {},
          onDelete: () {},
        ),
      ),
    );
    expect(find.byIcon(Icons.delete_outline), findsNothing);

    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'D',
          colorIdentity: const [],
          subtitle: null,
          isPrecon: false,
          pickIndex: null,
          canDelete: true,
          onTap: () {},
          onDelete: () {},
        ),
      ),
    );
    expect(find.byIcon(Icons.delete_outline), findsOneWidget);

    // onDelete null hides the icon even when canDelete is true.
    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'E',
          colorIdentity: const [],
          subtitle: null,
          isPrecon: false,
          pickIndex: null,
          canDelete: true,
          onTap: () {},
          onDelete: null,
        ),
      ),
    );
    expect(find.byIcon(Icons.delete_outline), findsNothing);
  });

  testWidgets('delete icon tap fires onDelete, not onTap', (tester) async {
    var taps = 0;
    var deletes = 0;
    await tester.pumpWidget(
      _wrap(
        DeckRow(
          name: 'Combo',
          colorIdentity: const [],
          subtitle: null,
          isPrecon: false,
          pickIndex: null,
          canDelete: true,
          onTap: () => taps += 1,
          onDelete: () => deletes += 1,
        ),
      ),
    );

    await tester.tap(find.byIcon(Icons.delete_outline));
    expect(taps, 0);
    expect(deletes, 1);
  });
}
