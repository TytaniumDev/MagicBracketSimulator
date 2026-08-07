## 2024-04-03 - Descriptive aria-labels for repeated links
**Learning:** Adding descriptive `aria-label` attributes to repetitive UI links like "Decklist" in lists (such as the DeckShowcase) provides screen readers context to know *which* item the link belongs to, instead of reading "Decklist, link" repetitively.
**Action:** When a UI lists identical links/buttons ("Edit", "Delete", "View"), ensure each has a unique `aria-label` referencing its related item.
## 2024-08-07 - Wrap Disabled Buttons to Enable Tooltips
**Learning:** In standard HTML, disabled buttons often swallow pointer events (e.g., hover), preventing native `title` tooltips from rendering in many browsers. To provide accessible context for *why* a button is disabled, the button itself must be wrapped in another block-level element (like a `span` with `display: block` or `div`) that holds the tooltip.
**Action:** Always wrap disabled buttons in a container element if they need a tooltip to explain their disabled state to the user. Ensure the wrapper inherits layout properties (like `w-full` or `block`) so it doesn't break the parent layout.
