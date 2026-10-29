# Course home: Survey Sheet (design brief)

Date: 2026-10-28. Status: confirmed by the user (impeccable shape). Product truth: `PRODUCT.md`.
Visual direction chosen on the impeccable decision page: **Survey Sheet** (seed:8ed1d894dbaa4e56). Reference sketch: `.impeccable/mocks/decision/assigned.html` (untracked; composition reference only, its 8–9px cell text is a known defect).

## 1. Job and audience
A stranger who cloned mindgap opens a course, either for a long study session or a ten-minute review. Their question is "what now?"; the home answers it first. Operate mode: standard controls, precision over decoration.

## 2. Outcome
- One next step with its evidence note as the reason, started in one click.
- The state of every topic, readable at a glance; 33 topics fit one 1440x900 viewport.
- Product-specific truth: the reason shown is the learner's own wrong prediction, quoted, not a generic recommendation.

## 3. Direction
- World: Ordnance Survey topographic sheet, lending only type, palette, density and one signature move.
- Palette: cool-white ground (not cream), ink, national-grid blue hairlines (grid, tabs, links), survey green = solid, contour orange hatching = shaky, magenta = gap and the primary action, untested = blank square with a dashed hairline.
- Signature move: the status grid is a grid-referenced sheet. Layer rows labelled in the left margin (L1, L2, L3, L4, OV, SV; generated courses derive short codes from their layers), column numbers along the top edge, each topic a square with a grid ref (`L3·04`), its title and a status mark as the fill. Map key box in the sheet corner with counts. Margin note: "N of M untested".
- Raises: tabular figures for every number; fixed furniture on every square (grid ref, mark, title); a closed vocabulary of status marks at 1px hairlines, no rounded corners; one topic mark at three scales (next-step mark, grid square, thumbnail sheet on the course list); the margin always counts what remains.
- Shell: top bar with wordmark (to course list), course title, tabs Home / Map / Sources, and a More menu holding New goal and Debug drill. Left column: next step (large status mark, title, layer, evidence quote, Start lesson and Read chapter), two alternates (one shaky review, one ready gap, each with mark, grid ref and one-line reason), Resume link to the last lesson. Right: the sheet.

## 4. Scope
- In: course home (replaces the map page as the course landing) and the Map tab (the sheet at full size plus the topic detail panel; replaces the mind-map SVG).
- Out: server and `CONTRACTS.md` (presentation only; calibration stats wait for a later slice), lesson and chapter pages except their link back to the course home, the course list (later slice).
- Anti-goals: map costume (contour textures, terrain decoration); a grid that needs the key to be read; anything that hides the next step below the fold.

## 5. States and ranges
- First run, no goal: the goal question is the home and starts the probe inline. Networking: sheet below, all squares blank. Generated course with no map: no sheet.
- Plan pending: the plan reply box (keep `replyQuestion()` behaviour).
- Busy (AI turn running): elapsed time and Cancel; the sheet stays readable and selectable.
- All solid: next step becomes review or New goal.
- Off-goal topics (`in_scope: false`): dimmed, hidden behind the existing toggle.
- Error: plain language with a way forward; never an HTTP code.
- Range: 1 to about 60 topics, 1 to 8 layers. Long layers wrap within their row; titles clamp to 3 lines.

## 6. Interaction and layout
- Selecting a square shows its prerequisites as a highlighted route; no lines drawn by default.
- Keyboard: arrows move across the grid, Enter opens, `n` starts the next step, `/` focuses topic search.
- Next-step pick: current `pickNext()` (prerequisite order) for the main suggestion; alternates are the first shaky topic and the first gap whose prerequisites are all solid, excluding the main pick.
- Below 1240px the sheet stacks below the next step (changed from 900px at build: between 900 and 1240 the sheet clipped to 4 of 9 columns).

## 7. Constraints and decisions
- Zero npm dependencies, plain ES modules, WCAG AA contrast, functional text at least 11px (the sketch's in-square text is not).
- Status wording stays `untested` / `gap` / `shaky` / `solid` everywhere, matching evidence notes and the tutor.
- Magenta is shared by gap and the primary action.
- Light theme first; dark is a separate later slice.
