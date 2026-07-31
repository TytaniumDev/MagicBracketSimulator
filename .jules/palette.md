## 2024-04-03 - Descriptive aria-labels for repeated links
**Learning:** Adding descriptive `aria-label` attributes to repetitive UI links like "Decklist" in lists (such as the DeckShowcase) provides screen readers context to know *which* item the link belongs to, instead of reading "Decklist, link" repetitively.
**Action:** When a UI lists identical links/buttons ("Edit", "Delete", "View"), ensure each has a unique `aria-label` referencing its related item.

## 2024-05-18 - Loading spinners for destructive actions
**Learning:** Destructive actions like "Delete deck" taking more than a few milliseconds without a loading indicator can cause users to click multiple times, leading to confusing errors or unintended behavior. Replacing generic text like '...' with a recognizable spinner component provides immediate, clear visual feedback that the system is processing the request.
**Action:** When implementing destructive or async actions, especially in lists, always use a dedicated loading spinner component rather than relying on text changes for feedback.
