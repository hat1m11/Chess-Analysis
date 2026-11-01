# my-chess-sigma

A browser app that finds a Chess.com player and reviews their last 5 games with Stockfish.
No build step. `npm start` serves `public/`, `src/` and `node_modules/` (as `/vendor/`). `npm test` runs `tests/`.

## Design rules

Adapted from Anthropic's `frontend-design` skill (Apache-2.0):
https://github.com/anthropics/skills/tree/main/skills/frontend-design

- **The brief wins.** The owner asked for very minimal, modern and intuitive, so that overrides the guidance below wherever they conflict. The audience is a club player, and the job is to show where a game turned.
- **Make choices, not defaults.** Before building, write a small plan for colour, type, layout and principles. Revise anything that would fit any similar page, then build.
- **Spend boldness in one place.** One element is memorable and the rest stays quiet. Before finishing, remove one accessory.
- **Structure is information.** Borders, numbers and labels must say something about the content. Don't add them as decoration.
- **Type carries the personality.** Use a deliberate type scale and keep lines under 80 characters.
- **Motion answers actions.** No entrance animations or hover effects on every element.
- **Quality floor.** Responsive to phone width, visible keyboard focus, reduced motion respected, accessible contrast, and never colour alone.
- **Check the result.** Take screenshots and critique them in light theme, dark theme and at phone width.

### Avoid unless the brief asks

- Cream backgrounds with a serif and terracotta accent, or near-black with one acid accent
- Identical rounded cards with the same soft shadow, and decorative gradients
- All-caps labels, eyebrows above every heading, and one accented word in a headline
- Middle-dot meta strings, arrows appended to link text, and monospace data labels
- Big-number stat tiles as a default

### Writing

Use plain, active, sentence-case words from the user's point of view. A button says what it does. Errors say what happened and how to fix it. Empty states say what to do next.

## This project's design

- **Colour:** white or near-black surfaces, one neutral grey for secondary text, and ink as the only accent. Other colours appear only to show move quality or results, always with a word or annotation beside them.
- **Type:** Geist Sans only, with size and weight setting the hierarchy. Moves use figurine notation, such as ♞f3.
- **Layout:** the landing page is one centred search box. The player page is a single narrow column ending in game rows, where the whole row opens the review. The review screen fits the viewport on desktop: board, slim evaluation graph and controls on the left, with players, verdict and tabs on the right.
- **Interaction:** one primary action per screen. Next key moment is the main way through a review, and arrow keys and browser Back must always work. Secondary detail goes behind a tab or disclosure.
- **Chess conventions:** annotations are !, ?!, ? and ??, always shown as text and not by colour alone.
