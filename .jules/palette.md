## 2024-05-22 - Interactive Divs Pattern
**Learning:** The application frequently uses `div` elements with `onClick` handlers for selection lists (like deck selection), making them inaccessible to keyboard and screen reader users.
**Action:** When implementing selection grids, always wrap items in `<button>` or use `role="checkbox"/"radio"` with full keyboard support (`tabIndex`, `onKeyDown`, `aria-checked`).

## 2025-01-26 - Destructive Action Feedback
**Learning:** Text-based buttons for destructive actions (like "X") are often ambiguous and lack visual weight. Users expect standard iconography (trash can) and clear loading states (spinner) for confirmation.
**Action:** Standardize all delete actions to use the `TrashIcon` component and a loading spinner, replacing text-based indicators.
