## 2024-04-03 - Descriptive aria-labels for repeated links
**Learning:** Adding descriptive `aria-label` attributes to repetitive UI links like "Decklist" in lists (such as the DeckShowcase) provides screen readers context to know *which* item the link belongs to, instead of reading "Decklist, link" repetitively.
**Action:** When a UI lists identical links/buttons ("Edit", "Delete", "View"), ensure each has a unique `aria-label` referencing its related item.
## 2024-07-10 - Contextual aria-labels for standalone destructive actions
**Learning:** Adding descriptive `aria-label` attributes to standalone destructive action buttons (like "Delete Job") ensures screen reader users understand exactly what is being deleted without relying on surrounding visual context, improving overall clarity and safety of the interface.
**Action:** When adding destructive action buttons, even if not part of a list, ensure they have a clear `aria-label` describing what is being targeted.
