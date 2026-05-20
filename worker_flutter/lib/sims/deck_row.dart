import 'package:flutter/material.dart';

import 'color_pips.dart';

/// Selectable deck row used in both Custom and Precons sections of
/// the Simulate screen.
///
/// Props are kept narrow — `DeckRow` doesn't know about `DeckRecord`
/// so the parent decides how to map fields.
class DeckRow extends StatelessWidget {
  const DeckRow({
    super.key,
    required this.name,
    required this.colorIdentity,
    required this.subtitle,
    required this.isPrecon,
    required this.pickIndex,
    required this.canDelete,
    required this.onTap,
    required this.onDelete,
  });

  final String name;
  final List<String> colorIdentity;
  final String? subtitle;
  final bool isPrecon;

  /// 1..4 when picked (rendered as a numbered badge); null when unpicked.
  final int? pickIndex;

  /// Whether the trailing delete icon is allowed. Even when true, the
  /// icon is hidden while the row is picked to avoid accidental
  /// destruction during selection. Also gated on [onDelete] being
  /// non-null.
  final bool canDelete;

  final VoidCallback onTap;

  /// Null disables the delete icon outright. Required when [canDelete]
  /// is true.
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final picked = pickIndex != null;
    final showDelete = canDelete && !picked && onDelete != null;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: picked ? const Color(0xFF1E3A8A) : const Color(0xFF111827),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: picked ? const Color(0xFF60A5FA) : const Color(0xFF374151),
          ),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 28,
              child: picked
                  ? CircleAvatar(
                      radius: 10,
                      backgroundColor: const Color(0xFF60A5FA),
                      child: Text(
                        '$pickIndex',
                        style: const TextStyle(
                          fontSize: 11,
                          color: Colors.white,
                        ),
                      ),
                    )
                  : const Icon(
                      Icons.radio_button_unchecked,
                      size: 18,
                      color: Colors.white54,
                    ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      if (isPrecon)
                        const Padding(
                          padding: EdgeInsets.only(right: 6),
                          child: Icon(
                            Icons.inventory_2_outlined,
                            size: 14,
                            color: Color(0xFF9CA3AF),
                          ),
                        ),
                      Expanded(
                        child: Text(
                          name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (colorIdentity.isNotEmpty)
                        ColorPips(colors: colorIdentity),
                    ],
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: const TextStyle(
                        color: Color(0xFF9CA3AF),
                        fontSize: 11,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (showDelete)
              IconButton(
                tooltip: 'Delete',
                icon: const Icon(
                  Icons.delete_outline,
                  color: Color(0xFFF87171),
                  size: 18,
                ),
                onPressed: onDelete!,
              ),
          ],
        ),
      ),
    );
  }
}
