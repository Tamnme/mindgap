---
name: mindgap
description: A local tutor that finds what you do not understand and teaches into the gaps. Every page is a surveyed sheet.
colors:
  sheet-ground: "#f7f8f6"
  ink: "#1c2321"
  ink-2: "#47514d"
  muted: "#5a6460"
  panel: "#ffffff"
  grid-blue: "#2b6cb0"
  grid-hairline: "rgba(43, 108, 176, 0.28)"
  grid-tint: "rgba(43, 108, 176, 0.07)"
  border: "rgba(28, 35, 33, 0.22)"
  disabled: "#eceeeb"
  survey-magenta: "#c0176b"
  survey-magenta-ink: "#9e1258"
  survey-magenta-text: "#c0176b"
  survey-green: "#4f9a52"
  on-solid: "#101512"
  contour-orange: "#c2652a"
  untested-grey: "#8a948f"
  busy-bg: "#eef3f9"
  danger: "#a3123f"
  danger-bg: "#fbe8ee"
  ok-bg: "#e6f2e6"
  ok-fg: "#1f5a23"
  slab: "#1c2321"
  slab-2: "#151b19"
  slab-rule: "rgba(227, 232, 229, 0.16)"
  slab-fg: "#e3e8e5"
  slab-muted: "#919c97"
  slab-grid: "#6ea8e6"
typography:
  chapter-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(28px, 5vw, 40px)"
    fontWeight: 800
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  chapter-section:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 750
    lineHeight: 1.25
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
  reading:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
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
  frame-title:
    fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 700
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
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
  lab-code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13.5px"
    lineHeight: 1.7
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
  button-slab:
    textColor: "{colors.slab-fg}"
    rounded: "{rounded.none}"
    padding: "6px 14px"
  tab:
    textColor: "{colors.ink-2}"
    padding: "6px 14px"
  tab-current:
    textColor: "{colors.ink}"
  theme-select:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "6px 28px 6px 10px"
  sheet-square:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "5px 5px 6px"
    height: "84px"
  sheet-square-solid:
    backgroundColor: "{colors.survey-green}"
    textColor: "{colors.on-solid}"
  sheet-square-gap:
    backgroundColor: "{colors.survey-magenta}"
    textColor: "{colors.panel}"
  evidence:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
  course-row:
    textColor: "{colors.ink}"
    padding: "18px 0"
  checkpoint:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "20px 18px 16px"
  widget:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  lab-card:
    backgroundColor: "{colors.slab}"
    textColor: "{colors.slab-fg}"
    rounded: "{rounded.none}"
    padding: "16px 20px"
  tutor-button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 18px"
  status-mark-lg:
    size: "56px"
    rounded: "{rounded.none}"
---

# Design System: mindgap

## Overview

**Creative North Star: "The Survey Sheet"**

A course is a surveyed sheet. The page borrows from an Ordnance Survey topographic map only its type discipline, its palette and one signature move: every topic is a square with a grid reference on a grid-referenced sheet, the layer codes in the left margin and column numbers along the top edge. Nothing else of the map comes along. There are no contour textures, terrain or paper grain; the ground is cool white, not cream.

Density is high and calm. All 33 topics of the networking course fit one 1440x900 viewport beside the next step. Marks are 1px hairlines, corners are square, and every number is set in tabular figures. One colour does two jobs on purpose: magenta marks a gap and also the primary action, so the button that starts the next lesson is the same colour as the gaps it teaches into.

Scope: every page (course list, course, lesson, chapter) uses this system. The tokens sit once on `:root` at the top of `public/app.css`, each written as `light-dark(light, dark)` under `color-scheme: light dark`. The theme control (System / Light / Dark, stored in `localStorage` as `mindgap-theme`) sets `data-theme` on the root, which forces `color-scheme`; an inline script in each page's head applies it before paint, and `chrome.js` keeps it in sync across tabs and back-forward restores. The hex values in the front matter are the light ones; the dark ones are listed under Colors. One surface ignores the theme: the slab, which holds code blocks and the lab card.

**Key Characteristics:**
- Grid-referenced sheet: layer codes in the margin, two-digit column numbers on top, a grid ref such as `L3·04` on every square.
- A closed vocabulary of four status marks (solid, shaky, gap, untested), with one mark form drawn at three scales.
- Square corners and 1px rules throughout; ink rules frame things and blue hairlines divide them.
- Tabular figures for every count and reference.
- The margin always counts what remains ("N of M untested").

## Colors

A cool-white ground with ink type, or a green-black ground with pale ink in dark. The survey palette carries all of the colour: grid blue for structure, then green, orange and magenta for status, with magenta also used for action.

### Primary
- **Survey Magenta** (`survey-magenta`): the primary action (Start lesson, Start with your goal, Start practice, Create course) and the gap status fill. Hover deepens to **Survey Magenta Ink** (`survey-magenta-ink`). Text on magenta is always white.
- **Survey Magenta Text** (`survey-magenta-text`, `--primary-text`): magenta used as text, such as the "Next step" lead-in on the meta line. It equals Survey Magenta in light; in dark it lifts to pass AA on the ground. It does not widen what magenta may mean.

### Secondary
- **National-Grid Blue** (`grid-blue`): the structure colour. Use it for layer codes, column numbers, the rules under the column header and the last row, the rule above the course list, the current-tab underline, links (`--accent` resolves to it), the focus outline, the prerequisite-route outline, the checkpoint frame and its title, widget titles, section numbers, the chapter-list heading and current number, the learner's turn rule, the Tutor badge, the spinner and the text-selection tint.
- **Grid Hairline** (`grid-hairline`): the faint blue rule between sheet rows, course rows, thread turns, checkpoint options, alternates, More-menu items and key-box borders.
- **Grid Tint** (`grid-tint`): a 7% blue wash for hover on checkpoint options and for important callouts. It marks hover and emphasis, never a chosen state.

### Tertiary (status)
- **Survey Green** (`survey-green`): solid. Fills the square, with **On Solid** (`on-solid`) text on top. Both are the same in both themes.
- **Contour Orange** (`contour-orange`): shaky. Applied as 135° hatching (1.5px stroke) on the panel, never as a flat fill.
- **Untested Grey** (`untested-grey`): untested. Used only as a dashed hairline around an empty square.

### Neutral
- **Sheet Ground** (`sheet-ground`): the page canvas and the Tutor drawer.
- **Panel White** (`panel`): squares, frames, the evidence figure, the top bar, side panels, the chapter list, menus, checkpoints and widgets.
- **Ink** (`ink`): body text, and the 1px frame rule on the sheet, side panels, widgets, the More menu, the Tutor button and the bottom of the top bar.
- **Ink 2** (`ink-2`): secondary copy such as the course title in the bar, inactive tabs, meta lines, the theme label and the tutor's note.
- **Muted** (`muted`): grid refs inside squares, hints, speaker labels, TOC numbers and source footers.
- **Border** (`border`): the resting 1px edge of buttons, inputs, squares, answer options and the evidence figure. Hover turns it to ink.
- **Disabled** (`disabled`) with a dashed border for disabled buttons. **Busy bg** is the busy strip. **Danger** / **Danger bg** are for the error notice, **Ok bg** / **Ok fg** for the done banner.

### Dark values
Each token above except Survey Green and On Solid carries a dark pair in `app.css`: ground `#121614`, ink `#e3e8e5`, ink 2 `#b4bdb8`, muted `#919c97`, panel `#1a1f1d`, grid blue `#6ea8e6`, hairline `rgba(110, 168, 230, 0.3)`, tint `rgba(110, 168, 230, 0.1)`, border `rgba(227, 232, 229, 0.22)`, disabled `#232926`, magenta `#c8277a`, magenta ink `#a81b63`, magenta text `#e8559a`, orange `#e0874b`, untested `#6f7974`, busy `#18211d`, danger `#ff8fa8` on `#3a1420`, ok `#a8dcaa` on `#17301a`. The panel stays one step lighter than the ground, so frames still read as sheets laid on a desk.

### The slab
- **Slab** (`slab`, `slab-2`, `slab-rule`, `slab-fg`, `slab-muted`, `slab-grid`): an always-dark surface on the sheet's green-grey axis, for code blocks and the lab card. Slab is ink-dark in light (`#1c2321`) and drops to `#0c100e` in dark so it still sits below the ground; slab 2 (`#070a09` in dark) is the output well under a lab command. Rules on it are 16% pale ink, text is pale ink, flags and comments are slab muted, and commands are slab grid blue.

### Named Rules
**The Shared Magenta Rule.** Magenta means "gap" and "act on it" and nothing else. Do not use it for decoration, headings or links.

**The Status Is the Fill Rule.** A square's state is shown by its whole surface: a green fill, orange hatching, a magenta fill, or blank with a dashed edge. A sheet must read without the key; the key only confirms it.

**The One Slab Rule.** The slab is the only surface that ignores the theme. Everything else reads its colour from a `light-dark()` token.

## Typography

**Display Font:** none distinct; the platform sans (`system-ui, -apple-system, "Segoe UI", sans-serif`)
**Body Font:** the same platform sans
**Label/Mono Font:** the same sans with `font-variant-numeric: tabular-nums` (`.num`) for every figure; `ui-monospace` for code and lab commands only

**Character:** one plain sans at tight sizes, with hierarchy carried by weight and negative tracking rather than by a second face. The platform sans is a deliberate zero-dependency choice for now. Whether to self-host a face is an open question for the user, so treat this as provisional, not a rule.

### Hierarchy
- **Chapter title** (800, clamp 28–40px, -0.02em): the chapter page's title.
- **Headline** (700, 28px, 1.15, -0.02em, `text-wrap: balance`; 24px below 900px): the next-step topic title, the lesson title, and the first-run question on an empty course list.
- **Chapter section** (750, 23px): chapter section headings, led by a 13px bold grid-blue section number.
- **Quote** (600, 19px, 1.35, -0.01em): the learner's own words, quoted, in the evidence figure.
- **Title** (700, 20px): the topic title in the side panel and a course title in the course list (-0.01em there).
- **Wordmark** (800, 17px, -0.02em): "mindgap", in lowercase, linking to the course list.
- **Lede** (16px, max 46ch, ink-2; 18px on the chapter page): the reason line when there is no quote, the chapter lede, the empty-list intro.
- **Reading** (16px, 1.7): chapter prose in a 760px column.
- **Body** (15px, 1.55): the root size everywhere else.
- **Note** (14px, 1.5, ink-2): the tutor's note under the quote, the sheet margin note, Resume, the course-list counts sentence and the theme control.
- **Meta** (13px, ink-2, tabular): the meta line, the grid ref beside the large mark, the "Or" alternates heading and side-panel summaries.
- **Frame title** (700, 13px, grid blue): the title set in the top edge of a checkpoint or widget frame, and the chapter-list heading.
- **Square title** (500, 12px, 1.3, clamped to 3 lines with hyphenation): topic titles inside squares.
- **Label** (11–12px, tabular): grid refs, column numbers, key counts, TOC numbers, speaker labels and hints. Nothing functional goes below 11px.

### Named Rules
**The Tabular Figures Rule.** Every count, grid ref, column number and elapsed time is set with `tabular-nums`, so the numbers line up like a survey index.

## Layout

Every page opens with the same top bar: 10px 24px padding (16px below 900px), a 1px ink bottom rule, and page content that starts on the same 24px edge (16px on phones).

**Course list.** One column of ruled course rows under a grid-blue rule, capped at 1600px with 32px 24px 64px padding. With courses, the new-course form sits beside the list as a 360px framed panel at 1100px and above, with a 40px gap; below that it stacks after the list. With no courses, the form is the whole page, capped at 640px, and its first label becomes the headline.

**Course page.** A top bar over a single `#view` capped at 1600px, with 24px padding. Home is a two-column grid at 1240px and above: a 300–400px next-step column and the sheet taking the rest, with a 32px gap. Below 1240px everything stacks into one column with the next step first. The Map tab follows the same breakpoint: the sheet plus a 340px sticky side panel at 1240px and above, stacked below it. The breakpoint is shared by CSS and JS (`WIDE` in `course.js`).

The sheet itself is a CSS grid: a 34px layer-code margin, then up to 10 equal columns of at least 92px each. Longer layers wrap within their row, and the grid scrolls sideways rather than squeezing. Squares sit at 3px inset with a minimum height of 84px (76px on Home).

**Lesson.** One 900px reading column under the course top bar: the headline title, the meta line, then the thread of turns. Questions cap at 72ch.

**Chapter.** At 960px and above, a 270px sticky chapter list on the panel, ruled from the content by a 1px border, beside a 760px reading column (32px top padding, 120px bottom for the Tutor button). Below 960px the list folds into a `details` above the column. At 600px and below the Tutor button becomes a full-width bottom bar and the page reserves 72px of scroll room for it.

Rhythm comes from 4 / 8 / 12 / 16 / 24 / 32px steps throughout.

## Elevation & Depth

The system is flat: depth comes from rules, not shadows. Frames are 1px ink, divisions are 1px blue hairlines and the canvas is one step darker than the panels in both themes. Shadows belong only to layers that float over content.

### Shadow Vocabulary
- **Menu lift** (`box-shadow: 0 6px 18px rgba(28, 35, 33, 0.14)`): the open More menu.
- **Tutor lift** (`box-shadow: 0 6px 18px rgba(28, 35, 33, 0.18)`): the floating Tutor button on the chapter page. It drops the shadow when it docks as a bottom bar on phones.
- **Focus overlay** (`box-shadow: 0 20px 60px rgba(28, 35, 33, 0.45)`, over a `rgba(28, 35, 33, 0.55)` scrim): a widget opened with Focus, fixed at 4vh / 4vw from the edges.

### Named Rules
**The Ruled Not Raised Rule.** Separate things with a 1px rule. Use the ink rule for a frame and a blue hairline for a division. A shadow appears only on a layer that floats over content.

## Shapes

Every corner is square (0px): buttons, inputs, selects, summaries, notices, squares, frames, menus, the Tutor button and the lab card. The only round thing is the spinner. The status mark is a single square drawn at three scales: 10px inside a sheet square, a course strip, a TOC row or a receipt; 12px in the key, alternates and meta lines; and 56px beside the next-step title. Solid is a green fill. Gap is a magenta fill struck by a 2px white diagonal on the mark. Shaky is 135° orange hatching. Untested is a dashed grey edge with nothing inside. The More and theme chevrons are drawn with CSS borders, not glyphs.

### Named Rules
**The One Mark Rule.** A topic's status is always this same square mark, scaled as needed. Do not use dots, chips, rings or percentages for status on the sheet.

**The Outline Selects Rule.** A chosen thing is outlined in ink: the selected square, the chosen answer, the current chapter. A tint marks hover or emphasis, never selection.

## Components

### Buttons
- **Shape:** square corners (0px).
- **Primary:** magenta fill, white 600-weight text, 9px 16px in the next-step actions and the new-course form. Hover deepens to magenta ink. Use one per block.
- **Secondary:** a panel with a 1px border and ink text. Hover turns the border to ink. Link-buttons such as "Read chapter", "Resume: …" and "Add sources first" share this style.
- **Disabled:** a light grey fill with a dashed border and muted text.
- **On the slab:** transparent with a slab-rule border and pale 600-weight text; hover turns the border pale. Approve borders in survey green.
- **Text tools:** Focus and Reset on widgets, and "linkish" actions in checkpoints, are muted words with no border.
- **Focus:** a 2px grid-blue outline at a 2px offset everywhere.

### Navigation
- **Top bar:** panel-coloured with a 1px ink bottom rule, on every page. The course page and the lesson and chapter pages show the wordmark, the course title in ink-2 (500, 15px; a link back to the course on lesson and chapter pages), then the Home / Map / Sources tabs. The current tab is ink, weight 600, with a 2px grid-blue underline that sits on the bar's rule. The course list shows only the wordmark and the theme control.
- **Theme control:** a visible "Theme" label in ink-2 beside a square select (System / Light / Dark) with the More menu's CSS chevron. It sits at the end of the top bar on the course list, lesson and chapter pages. On the course page it lives inside More, as the last row under New goal and Debug drill, because in the bar it wraps the course bar to three lines on phones.

### Sheet (signature component)
- A panel frame with a 1px ink border. The head row holds the margin note ("**33** of 33 untested", with the first figure in 18px bold ink) and the key box: a blue-hairline box listing the four marks with tabular counts.
- Column numbers (`01`…) are 11px grid blue over a blue rule. Layer codes (L1, L2, OV…) are 12px bold grid blue in the left margin, with a blue rule on their right.
- **Square:** a button holding fixed furniture: grid ref at top left, a small mark at top right, and the title below. Ink outlines a selected square. Grid blue outlines the selected square's prerequisite route; other squares dim to 0.32. Off-goal squares sit at 0.45. On shaky squares the ref and title sit on panel chips so the text stays legible over the hatching.
- Keyboard: roving tabindex, with arrow keys to move and Enter to open.

### Course list
- Ruled rows divided by blue hairlines under a grid-blue top rule. Each row holds the course title (Title style, underlined on hover), a secondary Resume button at the end ("Resume: <lesson>", or "Open"; truncated at 340px), a strip of 10px marks, one per topic, ordered solid, shaky, gap, untested, and a counts sentence ("**N** of M untested · solid · shaky · gap", with N in 16px ink). On phones the Resume button drops under the title.
- **New course:** a framed panel (1px ink, 16px padding, 16px heading) beside the list, or the whole page when there are no courses.

### Evidence figure
- A panel figure with a 1px border. It shows the learner's quote first (Quote style, in curly quotes), then the tutor's note (Note style, ink-2), then a 12px muted source line. With no evidence, a Lede line takes its place.

### Next step
- The 56px status mark sits beside its grid ref, followed by the headline title and the meta line ("**Next step** · gap · layer"). The evidence follows, then the actions (Start lesson in magenta, plus Read chapter or Write chapter). After those come up to two alternates in a list with blue-hairline rules: a mark, the ref and title, a clamped reason and a secondary verb button. A Resume link closes the block.

### Meta line (lesson and chapter)
- Under the title: the topic's mark, then the grid ref, status, mode (lesson) or chapter number (chapter), and layer, joined by ` · ` in Meta style with tabular figures.

### Lesson thread
- Turns are divided by blue hairlines with a muted 11px speaker label. Learner turns are indented 24px and carry a 1px grid-blue left rule. Answer options are bordered rows; the chosen one gets an ink border and a 1px inner ink outline. After submitting, unchosen options fade to 0.55 and the submitted answer stays at full ink.

### Checkpoint
- A panel frame with a 1px grid-blue border. Its title ("Checkpoint · predict first") is set in the frame's top edge, 13px bold grid blue on a panel knock-out, like a sheet's frame title. Options are hairline-ruled rows; hover takes the grid tint and the chosen option a 2px ink outline. Content after an open checkpoint is blurred (5px) and faded to 0.45 until it is answered.
- **Receipt:** an answered checkpoint folds to one bordered button: the 10px status mark (solid for right, gap for wrong, untested for skipped) then a one-line result. The border follows the mark: green, magenta, or dashed.

### Widget
- A panel frame with a 1px ink border. The widget title sits in the frame's top edge like the checkpoint's, with an ink-2 "explored" badge once used. A hairline divides the head (hint and the Focus and Reset text tools) from the body; a bordered takeaway closes it. Focus lifts it into the focus overlay.

### Lab card
- A slab block: commands in 13.5px mono with slab-grid commands and slab-muted flags, a slab-rule divided bar holding Run, then output on slab 2 (stderr in danger pink). Approval requests sit in the same well.

### Tutor button and drawer
- **Button:** a square panel button with a 1px ink frame and 600 text, floating at the bottom right with the Tutor lift; on phones a full-width bottom bar with a top rule and no shadow. Unread turns show a square grid-blue outlined count.
- **Drawer:** slides in from the right (0.2s, none under reduced motion), up to 420px, on the ground with a 1px border on its left edge.

### Chapter list
- Rows of number (11px muted, grid blue and bold when current), title and 10px mark. The current chapter is outlined in 1px ink. Its sections nest under a 1px grid-blue rule.

### Busy bar
- A full-width strip under the top bar on the busy tint, with a grid-blue spinner, tabular elapsed time and Cancel.

## Do's and Don'ts

### Do:
- **Do** show status by filling the whole square: green fill, 135° orange hatching, magenta fill, or blank with a dashed edge.
- **Do** put the fixed furniture on every square: grid ref, mark and title, with the title clamped to 3 lines.
- **Do** set every number in tabular figures and keep the "N of M untested" count in the sheet margin and on each course row.
- **Do** use 1px ink rules for frames, 1px grid-blue hairlines for divisions and square corners for everything.
- **Do** quote the learner's own words as the reason for the next step, with the tutor's note beneath.
- **Do** keep functional text at 11px or larger and keep text on status fills at WCAG AA (dark ink on green, white on magenta).
- **Do** outline a chosen thing in ink; keep the tint for hover and emphasis.
- **Do** put a frame's title in its top edge, in grid blue.

### Don't:
- **Don't** use magenta for anything except gap and the primary action; use `--primary-text` when it is text.
- **Don't** add progress rings, mastery percentages or a card per unit; the sheet is the progress view.
- **Don't** dress the sheet as a map: no contour textures, terrain or paper grain. The hatching on shaky squares is a status mark, not decoration.
- **Don't** round corners or put shadows on resting surfaces; only the More menu, the Tutor button and the focused widget float.
- **Don't** hard-code a colour that has to read in both themes; add a token with `light-dark()`. The slab is the one surface that stays dark in both.
- **Don't** use glyph icons (arrows, ticks, crosses); status is the mark, controls are words, chevrons are CSS borders.
