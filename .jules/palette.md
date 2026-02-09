## 2024-05-22 - Interactive Divs Pattern
**Learning:** The application frequently uses `div` elements with `onClick` handlers for selection lists (like deck selection), making them inaccessible to keyboard and screen reader users.
**Action:** When implementing selection grids, always wrap items in `<button>` or use `role="checkbox"/"radio"` with full keyboard support (`tabIndex`, `onKeyDown`, `aria-checked`).
