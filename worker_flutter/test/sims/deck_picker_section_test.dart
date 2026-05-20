import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worker_flutter/sims/deck_picker_section.dart';

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('renders title with count', (tester) async {
    await tester.pumpWidget(
      _wrap(
        DeckPickerSection(
          title: 'Your decks',
          count: 3,
          expanded: true,
          onExpansionChanged: (_) {},
          emptyText: 'none',
          children: const [Text('A'), Text('B'), Text('C')],
        ),
      ),
    );

    expect(find.text('Your decks (3)'), findsOneWidget);
    expect(find.text('A'), findsOneWidget);
    expect(find.text('B'), findsOneWidget);
    expect(find.text('C'), findsOneWidget);
  });

  testWidgets('shows emptyText when count is 0', (tester) async {
    await tester.pumpWidget(
      _wrap(
        DeckPickerSection(
          title: 'Precons',
          count: 0,
          expanded: true,
          onExpansionChanged: (_) {},
          emptyText: 'No precons match.',
          children: const [],
        ),
      ),
    );

    expect(find.text('Precons (0)'), findsOneWidget);
    expect(find.text('No precons match.'), findsOneWidget);
  });

  testWidgets('onExpansionChanged fires when header tapped', (tester) async {
    bool? captured;
    await tester.pumpWidget(
      _wrap(
        DeckPickerSection(
          title: 'X',
          count: 1,
          expanded: false,
          onExpansionChanged: (v) => captured = v,
          emptyText: '',
          children: const [Text('item')],
        ),
      ),
    );

    await tester.tap(find.text('X (1)'));
    await tester.pumpAndSettle();
    expect(captured, true);
  });

  testWidgets('externally-driven expanded prop is honored on rebuild', (
    tester,
  ) async {
    Widget build(bool expanded) => _wrap(
      DeckPickerSection(
        title: 'X',
        count: 1,
        expanded: expanded,
        onExpansionChanged: (_) {},
        emptyText: '',
        children: const [Text('hidden-or-shown')],
      ),
    );

    await tester.pumpWidget(build(false));
    expect(find.text('hidden-or-shown'), findsNothing);

    await tester.pumpWidget(build(true));
    await tester.pumpAndSettle();
    expect(find.text('hidden-or-shown'), findsOneWidget);

    await tester.pumpWidget(build(false));
    await tester.pumpAndSettle();
    expect(find.text('hidden-or-shown'), findsNothing);
  });
}
