# Progress polish — w74

Mark requested stronger orange expression and more distinctive Overview/Trends/Records, plus removal of orange glow spilling onto the dark background anywhere in the app. This preserves the existing interface, data definitions and workflow.

- Main Progress tabs use distinct decorative chart/trend/trophy SVG icons and a solid orange selected surface. Labels and aria-selected remain intact; focus remains explicit.
- Overview numbers, selected period/range controls, trend results and larger record values carry the existing theme-aware amber. Neutral surfaces keep the accent contained and readable.
- Twenty blurred amber shadows/filters were removed at their source, including Today/Train heroes, CTA buttons, chart lines, active nav icons, week marks and record effects. Solid focus/status outlines and the existing orange fills remain.
- Both Progress suites passed: long ranges, charts/tables/sources, keyboard selection, real profile switching, sparse/empty states, both themes at 320/390/768, larger text and bounded 1,000-workout histories. Measured render times remain below 100 ms on this machine.
- 356 domain tests, 5,541 broad contrast samples and responsive four-screen/nine-overlay checks passed. A radius-scale violation was corrected to the existing 20px scale value; the final layout check passes.
- Root inspected populated dark/light Overview, Trends and Records plus an installed-plan Today hero: its surrounding background stays clean. The local synthetic Today harness also passed offline/metric checks and magnified layout.

QA evidence: ignored `artifacts/design-qa/surfaces/progress-polish/`, plus refreshed existing Progress suite screenshots. No live customer data used or altered. Actual release state and independent review are recorded in the Operations receipt after verification. Physical Android acceptance remains unverified.

Independent Claude review found no correctness/regression issue. Its low-severity concern that selected metric/range chips were too faint was accepted: selected sub-controls now have a crisp inset amber outline as well as the text/fill change. Main tabs use aria-selected; sub-controls use aria-pressed. The outline has no blur and cannot spill onto the page.
