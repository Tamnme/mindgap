---
name: mindgap
description: A local tutor that finds what you do not understand and teaches into the gaps. The course page is a surveyed sheet.
colors:
  sheet-ground: "#f7f8f6"
  ink: "#1c2321"
  ink-2: "#47514d"
  muted: "#5a6460"
  panel: "#ffffff"
  grid-blue: "#2b6cb0"
  grid-hairline: "rgba(43, 108, 176, 0.28)"
  border: "rgba(28, 35, 33, 0.22)"
  disabled: "#eceeeb"
  survey-magenta: "#c0176b"
  survey-magenta-ink: "#9e1258"
  survey-green: "#4f9a52"
  contour-orange: "#c2652a"
  untested-grey: "#8a948f"
  danger: "#a3123f"
  danger-bg: "#fbe8ee"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  quote:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
  wordmark:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    letterSpacing: "-0.02em"
  lede:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  note:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  square-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  none: "0px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.survey-magenta}"
    textColor: "{colors.panel}"
    rounded: "{rounded.none}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.survey-magenta-ink}"
    textColor: "{colors.panel}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  button-disabled:
    backgroundColor: "{colors.disabled}"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
  tab:
    textColor: "{colors.ink-2}"
    padding: "6px 14px"
  tab-current:
    textColor: "{colors.ink}"
  sheet-square:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "5px 5px 6px"
    height: "84px"
  sheet-square-solid:
    backgroundColor: "{colors.survey-green}"
    textColor: "{colors.ink}"
  sheet-square-gap:
    backgroundColor: "{colors.survey-magenta}"
    textColor: "{colors.panel}"
  evidence:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
  status-mark-lg:
    size: "56px"
    rounded: "{rounded.none}"
---

# Design System: mindgap

## Overview

**Creative North Star: "The Survey Sheet"**

A course is a surveyed sheet. The page borrows from an Ordnance Survey topographic map only its type discipline, its palette and one signature move: every topic is a square with a grid reference on a grid-referenced sheet, the layer codes in the left margin and column numbers along the top edge. Nothing else of the map comes along. There are no contour textures, terrain or paper grain; the ground is cool white, not cream.

Density is high and calm. All 33 topics of the networking course fit one 1440x900 viewport beside the next step. Marks are 1px hairlines, corners are square, and every number is set in tabular figures. One colour does two jobs on purpose: magenta marks a gap and also the primary action, so the button that starts the next lesson is the same colour as the gaps it teaches into.

Scope today: this system applies to the course page only (`public/course.html`, scoped by `body.sheet` with its tokens on `:root:has(body.sheet)`). The lesson, chapter and course-list pages still use the older global tokens at the top of `public/app.css` until a later slice migrates them. The system is light only; dark is a later slice, and the sheet sets `color-scheme: light`.

**Key Characteristics:**
- Grid-referenced sheet: layer codes in the margin, two-digit column numbers on top, a grid ref such as `L3·04` on every square.
- A closed vocabulary of four status marks (solid, shaky, gap, untested), with one mark form drawn at three scales.
- Square corners and 1px rules throughout; ink rules frame things and blue hairlines divide them.
- Tabular figures for every count and reference.
- The margin always counts what remains ("N of M untested").

## Colors

A cool-white ground with ink type. The survey palette carries all of the colour: grid blue for structure, then green, orange and magenta for status, with magenta also used for action.

### Primary
- **Survey Magenta** (`survey-magenta`): the primary action (Start lesson, Start with your goal, Start practice) and the gap status fill. Also the "Next step" lead-in on the meta line. Hover deepens to **Survey Magenta Ink** (`survey-magenta-ink`).

### Secondary
- **National-Grid Blue** (`grid-blue`): the structure colour. Use it for layer codes, column numbers, the rules under the column header and the last row, the current-tab underline, links (`--accent` resolves to it on the sheet), the focus outline, the prerequisite-route outline, the spinner and the text-selection tint.
- **Grid Hairline** (`grid-hairline`): the faint blue rule between sheet rows, alternates, More-menu items and key-box borders.

### Tertiary (status)
- **Survey Green** (`survey-green`): solid. Fills the square, with ink text on top.
- **Contour Orange** (`contour-orange`): shaky. Applied as 135° hatching (1.5px stroke) on white, never as a flat fill.
- **Untested Grey** (`untested-grey`): untested. Used only as a dashed hairline around an empty square.

### Neutral
- **Sheet Ground** (`sheet-ground`): the page canvas.
- **Panel White** (`panel`): squares, the sheet frame, the evidence figure, the top bar, the side panel and menus. It is also the text colour on magenta.
- **Ink** (`ink`): body text, and the 1px frame rule on the sheet, the side panel, the More menu and the bottom of the top bar.
- **Ink 2** (`ink-2`): secondary copy such as the course title, inactive tabs, meta lines and the tutor's note.
- **Muted** (`muted`): grid refs inside squares, hints and source footers.
- **Border** (`border`): the resting 1px edge of buttons, squares and the evidence figure. Hover turns it to ink.
- **Disabled** (`disabled`) with a dashed border for disabled buttons. **Danger** / **Danger bg** are for the error notice.

### Named Rules
**The Shared Magenta Rule.** Magenta means "gap" and "act on it" and nothing else. Do not use it for decoration, headings or links.

**The Status Is the Fill Rule.** A square's state is shown by its whole surface: a green fill, orange hatching, a magenta fill, or blank with a dashed edge. A sheet must read without the key; the key only confirms it.

## Typography

**Display Font:** none distinct; the platform sans (`system-ui, -apple-system, "Segoe UI", sans-serif`)
**Body Font:** the same platform sans
**Label/Mono Font:** the same sans with `font-variant-numeric: tabular-nums` (`.num`) for every figure

**Character:** one plain sans at tight sizes, with hierarchy carried by weight and negative tracking rather than by a second face. The platform sans is a deliberate zero-dependency choice for now. Whether to self-host a face is an open question for the user, so treat this as provisional, not a rule.

### Hierarchy
- **Headline** (700, 28px, 1.15, -0.02em, `text-wrap: balance`; 24px below 900px): the next-step topic title or the first-run question.
- **Quote** (600, 19px, 1.35, -0.01em): the learner's own words, quoted, in the evidence figure.
- **Title** (700, 20px): the topic title in the side panel.
- **Wordmark** (800, 17px, -0.02em): "mindgap", in lowercase, linking to the course list.
- **Lede** (16px, max 46ch, ink-2): the reason line when there is no quote.
- **Body** (15px, 1.55): the root size on the sheet.
- **Note** (14px, 1.5, ink-2): the tutor's note under the quote, the sheet margin note and Resume.
- **Meta** (13px, ink-2): the meta line, the grid ref beside the large mark, the "Or" alternates heading and side-panel summaries.
- **Square title** (500, 12px, 1.3, clamped to 3 lines with hyphenation): topic titles inside squares.
- **Label** (11–12px, tabular): grid refs, column numbers, key counts and hints. Nothing functional goes below 11px.

### Named Rules
**The Tabular Figures Rule.** Every count, grid ref, column number and elapsed time is set with `tabular-nums`, so the numbers line up like a survey index.

## Layout

The page is a top bar over a single `#view` capped at 1600px, with 24px padding (16px below 900px). Home is a two-column grid at 1240px and above: a 300–400px next-step column and the sheet taking the rest, with a 32px gap. Below 1240px everything stacks into one column with the next step first. The Map tab follows the same breakpoint: the sheet plus a 340px sticky side panel at 1240px and above, stacked below it. The breakpoint is shared by CSS and JS (`WIDE` in `course.js`). This replaces the brief's 900px stacking point; the build wins.

The sheet itself is a CSS grid: a 34px layer-code margin, then up to 10 equal columns of at least 92px each. Longer layers wrap within their row, and the grid scrolls sideways rather than squeezing. Rhythm comes from 4 / 8 / 12 / 16 / 24 / 32px steps. Squares sit at 3px inset with a minimum height of 84px (76px on Home).

## Elevation & Depth

The system is flat: depth comes from rules, not shadows. Frames are 1px ink, divisions are 1px blue hairlines and the canvas is one step darker than the panels. The one shadow belongs to the More menu, a floating layer over content.

### Shadow Vocabulary
- **Menu lift** (`box-shadow: 0 6px 18px rgba(28, 35, 33, 0.14)`): the open More menu only.

### Named Rules
**The Ruled Not Raised Rule.** Separate things with a 1px rule. Use the ink rule for a frame and a blue hairline for a division. A shadow appears only on a layer that floats over content.

## Shapes

Every corner is square (0px): buttons, inputs, summaries, notices, squares, frames and menus. The status mark is a single square drawn at three scales: 10px inside a sheet square, 12px in the key and alternates, and 56px beside the next-step title. Solid is a green fill. Gap is a magenta fill struck by a 2px white diagonal on the mark. Shaky is 135° orange hatching. Untested is a dashed grey edge with nothing inside. The More chevron is drawn with CSS borders, not a glyph.

### Named Rules
**The One Mark Rule.** A topic's status is always this same square mark, scaled as needed. Do not use dots, chips, rings or percentages for status on the sheet.

## Components

### Buttons
- **Shape:** square corners (0px).
- **Primary:** magenta fill, white 600-weight text, 9px 16px in the next-step actions. Hover deepens to magenta ink. Use one per block.
- **Secondary:** a white panel with a 1px border and ink text. Hover turns the border to ink. Link-buttons such as "Read chapter" and "Add sources first" share this style.
- **Disabled:** a light grey fill with a dashed border and muted text.
- **Focus:** a 2px grid-blue outline at a 2px offset everywhere on the sheet.

### Navigation
- **Top bar:** white with a 1px ink bottom rule. It holds the wordmark, the course title in ink-2 (500, 15px), then the Home / Map / Sources tabs. The current tab is ink, weight 600, with a 2px grid-blue underline that sits on the bar's rule. "More" is a square `details` button whose menu holds New goal and Debug drill.

### Sheet (signature component)
- A white frame with a 1px ink border. The head row holds the margin note ("**33** of 33 untested", with the first figure in 18px bold ink) and the key box: a blue-hairline box listing the four marks with tabular counts.
- Column numbers (`01`…) are 11px grid blue over a blue rule. Layer codes (L1, L2, OV…) are 12px bold grid blue in the left margin, with a blue rule on their right.
- **Square:** a button holding fixed furniture: grid ref at top left, a small mark at top right, and the title below. Ink outlines a selected square. Grid blue outlines the selected square's prerequisite route; other squares dim to 0.32. Off-goal squares sit at 0.45. On shaky squares the ref and title sit on white chips so the text stays legible over the hatching.
- Keyboard: roving tabindex, with arrow keys to move and Enter to open.

### Evidence figure
- A white figure with a 1px border. It shows the learner's quote first (Quote style, in curly quotes), then the tutor's note (Note style, ink-2), then a 12px muted source line. With no evidence, a Lede line takes its place.

### Next step
- The 56px status mark sits beside its grid ref, followed by the headline title and the meta line ("**Next step** · gap · layer"). The evidence follows, then the actions (Start lesson in magenta, plus Read chapter or Write chapter). After those come up to two alternates in a list with blue-hairline rules: a mark, the ref and title, a clamped reason and a secondary verb button. A Resume link closes the block.

### Side panel (Map)
- A white panel with a 1px ink frame, sticky at 1240px and above. It shows the title, the evidence, the actions, then collapsed `details` sections divided by blue hairlines.

### Busy bar
- A full-width strip under the top bar with a grid-blue spinner, tabular elapsed time and Cancel.

## Do's and Don'ts

### Do:
- **Do** show status by filling the whole square: green fill, 135° orange hatching, magenta fill, or blank with a dashed edge.
- **Do** put the fixed furniture on every square: grid ref, mark and title, with the title clamped to 3 lines.
- **Do** set every number in tabular figures and keep the "N of M untested" count in the sheet margin.
- **Do** use 1px ink rules for frames, 1px grid-blue hairlines for divisions and square corners for everything.
- **Do** quote the learner's own words as the reason for the next step, with the tutor's note beneath.
- **Do** keep functional text at 11px or larger and keep text on status fills at WCAG AA (ink on green, white on magenta).

### Don't:
- **Don't** use magenta for anything except gap and the primary action.
- **Don't** add progress rings, mastery percentages or a card per unit; the sheet is the progress view.
- **Don't** dress the sheet as a map: no contour textures, terrain or paper grain. The hatching on shaky squares is a status mark, not decoration.
- **Don't** round corners or put shadows on resting surfaces; the More menu is the only floating layer.
- **Don't** apply these tokens to the lesson, chapter or course-list pages until their migration slice, and don't add a dark variant outside the dark slice.
