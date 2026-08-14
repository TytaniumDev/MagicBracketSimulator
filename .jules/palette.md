## 2024-04-03 - Descriptive aria-labels for repeated links
**Learning:** Adding descriptive `aria-label` attributes to repetitive UI links like "Decklist" in lists (such as the DeckShowcase) provides screen readers context to know *which* item the link belongs to, instead of reading "Decklist, link" repetitively.
**Action:** When a UI lists identical links/buttons ("Edit", "Delete", "View"), ensure each has a unique `aria-label` referencing its related item.

## 2024-05-18 - Tooltips on disabled buttons
**Learning:** Disabled buttons often swallow pointer events, which prevents native `title` tooltips from appearing on hover.
**Action:** Wrap disabled buttons in an inline-flex element (e.g. `span`) and attach the `title` attribute to the wrapper instead, so the tooltip is accessible even when the button is disabled.
