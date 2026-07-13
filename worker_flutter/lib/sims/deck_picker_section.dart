import 'package:flutter/material.dart';

/// Collapsible section header used by [SimulateScreen]. Wraps
/// [ExpansionTile] with externally-controlled expansion so the parent
/// can force-expand during an active search.
class DeckPickerSection extends StatefulWidget {
  const DeckPickerSection({
    super.key,
    required this.title,
    required this.count,
    required this.expanded,
    required this.onExpansionChanged,
    required this.emptyText,
    required this.children,
  });

  final String title;

  /// Shown in the header as "$title ($count)". When 0, the body
  /// renders [emptyText] instead of [children].
  final int count;

  /// Externally-controlled expansion state. When this prop changes,
  /// the underlying [ExpansionTile] is told to expand/collapse to
  /// match. User-initiated toggles still call [onExpansionChanged] but
  /// the visible state is reconciled back to this prop on the next
  /// rebuild — so user clicks during search are effectively ignored
  /// until the search clears.
  final bool expanded;

  final ValueChanged<bool> onExpansionChanged;

  /// Text shown in the body when [count] is 0.
  final String emptyText;

  final List<Widget> children;

  @override
  State<DeckPickerSection> createState() => _DeckPickerSectionState();
}

class _DeckPickerSectionState extends State<DeckPickerSection> {
  late final ExpansibleController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = ExpansibleController();
  }

  @override
  void didUpdateWidget(covariant DeckPickerSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.expanded != widget.expanded) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (widget.expanded) {
          _ctrl.expand();
        } else {
          _ctrl.collapse();
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        controller: _ctrl,
        initiallyExpanded: widget.expanded,
        onExpansionChanged: widget.onExpansionChanged,
        iconColor: Colors.white70,
        collapsedIconColor: Colors.white70,
        title: Text(
          '${widget.title} (${widget.count})',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: 14,
          ),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        children: widget.count == 0
            ? [
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    widget.emptyText,
                    style: const TextStyle(color: Colors.white54),
                  ),
                ),
              ]
            : widget.children,
      ),
    );
  }
}
