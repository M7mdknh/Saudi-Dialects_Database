# Arabic UX guidelines

## Experience principles

- Make contribution feel quick, valuable, and safe.
- Reveal complexity only when the contributor asks for another word or example.
- Make admin review dense and fast without sacrificing clarity or undoability.
- Write all visible copy in clear Arabic; keep code identifiers in English.

## Public page

Use a single-column layout on mobile and a centered readable form width on desktop. Suggested opening copy:

- Heading: `ساهم بكلمة من لهجتك`
- Supporting text: `ساعدنا في بناء بيانات تفهم تنوّع لهجاتنا العربية.`
- Primary action: `إرسال المساهمة`
- Add word: `إضافة كلمة أخرى`
- Add example: `إضافة مثال`

Each word card should have a visible number and a descriptive heading such as `الكلمة ١`. Keep the required marker consistent and explain it once. Do not hide the first required example behind an add button.

For dialect selection, provide a searchable combobox with suggested canonical/common labels and a free-text path labeled `اكتب اللهجة أو المنطقة`. Store what the contributor actually chooses or writes.

Autosave non-sensitive draft fields locally and announce recovery without blocking the form. Clear the saved draft only after confirmed server success.

Success copy should thank the contributor and explain that submissions are reviewed before entering the dataset. Do not imply automatic publication or approval.

## Admin workspace

Use a compact grid on desktop and a card/detail workflow on small screens. Do not force a wide spreadsheet into an unusable mobile viewport.

Recommended visible Arabic status labels:

| Internal status | Arabic label |
| --------------- | ------------ |
| new             | جديد         |
| pending         | قيد المراجعة |
| approved        | معتمد        |
| rejected        | مرفوض        |
| duplicate       | مكرر         |
| merged          | مدمج         |

Show text/icon status in addition to color. Make unsaved edits obvious. Save inline edits deliberately or with a reliable short debounce, and expose errors at the edited cell.

Use a details drawer for raw values, examples, source history, and duplicate reasoning. Use a full page or large dialog for merge work so the admin can compare sources without cramped columns.

Bulk actions must show the selected count and require confirmation for rejection, merge, or any operation that changes export eligibility. Offer undo when feasible.

## RTL mechanics

- Set `lang="ar"` and `dir="rtl"` at the root.
- Test actual Arabic text, mixed Arabic/Latin strings, numbers, dates, and JSON filenames.
- Use logical CSS properties (`margin-inline-start`, `padding-inline-end`) rather than physical left/right assumptions.
- Keep code, IDs, URLs, and JSON previews in `dir="ltr"` containers when that improves readability.
- Verify icon direction for arrows, pagination, undo/redo, drawers, and disclosure controls.

## Accessibility

- Associate every control with a visible label.
- Move focus to the first invalid field after submit and provide an error summary for long batches.
- Announce async save, submit, and success states appropriately without excessive live-region noise.
- Preserve a logical keyboard order in repeated cards and grids.
- Provide at least 44-by-44 CSS pixel touch targets for primary mobile controls where practical.
- Respect reduced motion and never require animation to understand state.
- Do not use placeholders as labels.

## Visual direction

Use a warm, contemporary Arabic editorial feel: generous whitespace, one restrained accent color, soft surfaces, and clear typography. Avoid generic dashboard clutter, excessive gradients, animated backgrounds, or decorative elements that slow the form.

Admin density may be higher than the public page, but typography, focus treatment, and action hierarchy must remain consistent.
