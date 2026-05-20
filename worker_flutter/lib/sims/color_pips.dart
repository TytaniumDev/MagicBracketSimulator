import 'package:flutter/material.dart';

/// WUBRG color-identity dots rendered as a horizontal row of small
/// circles. Used by deck rows in the Simulate screen.
class ColorPips extends StatelessWidget {
  const ColorPips({super.key, required this.colors});

  /// Single-letter codes: W, U, B, R, G. Unknown codes render gray.
  final List<String> colors;

  @override
  Widget build(BuildContext context) {
    // Magic's "B" (black) is a dark color, but our card backgrounds
    // are dark too; a lighter outline keeps the pip visible against
    // both `0xFF111827` (unpicked card) and `0xFF1E3A8A` (picked).
    const map = {
      'W': Color(0xFFFEF3C7),
      'U': Color(0xFF60A5FA),
      'B': Color(0xFF374151),
      'R': Color(0xFFF87171),
      'G': Color(0xFF34D399),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final c in colors)
          Padding(
            padding: const EdgeInsets.only(left: 3),
            child: Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: map[c] ?? Colors.grey,
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFF6B7280)),
              ),
            ),
          ),
      ],
    );
  }
}
