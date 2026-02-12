## 2024-05-23 - Standardizing Delete Actions
**Learning:** Users respond better to consistent iconography for destructive actions. Inline SVGs and text replacements like "X" or "..." create visual noise and inconsistent experiences. Centralizing icons in `Icons.tsx` allows for uniform size and style across the application.
**Action:** When adding new action buttons, check `frontend/src/components/Icons.tsx` first. If the icon doesn't exist, add it there instead of inlining SVG. Always pair delete actions with a loading spinner for immediate feedback.
