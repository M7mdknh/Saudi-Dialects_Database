# Product specification

## V1 goal

Collect useful Arabic dialect words with minimal contributor effort, then give one admin a fast, safe way to normalize, merge, approve, and export them for model training.

## Public journey

1. Display a short Arabic project explanation and contribution prompt.
2. Show one word card immediately.
3. Require dialect word, submitted dialect/region, MSA synonym, and one example sentence.
4. Allow an optional meaning/usage explanation and unlimited additional examples.
5. Allow adding, removing, and reordering word cards, with a client payload cap of 50 cards.
6. Autosave the unfinished batch in local storage without storing consent as pre-checked.
7. Require explicit dataset-use consent.
8. Validate inline, focus the first invalid field, and preserve all valid input.
9. Submit the batch atomically with an idempotency key and anti-spam token.
10. Show an Arabic success state with options to start another contribution or share the project.

Contributors do not create accounts and do not provide names or emails in V1.

## Public field contract

| Arabic label            | Internal concept      | Required | Notes                                      |
| ----------------------- | --------------------- | -------: | ------------------------------------------ |
| الكلمة باللهجة          | submitted word        |      Yes | Preserve exact submitted text              |
| اللهجة أو المنطقة       | submitted dialect     |      Yes | Search suggestions plus free-text fallback |
| مرادفها بالعربية الفصحى | submitted MSA synonym |      Yes | A contributor may enter a short phrase     |
| المعنى ومتى تُستخدم     | submitted explanation |       No | Multi-line text                            |
| مثال في جملة            | raw example           |      Yes | At least one non-empty example             |
| مثال إضافي              | raw example           |       No | Add/remove multiple examples               |

Choose generous but finite server-side character limits and show the same limits in the client schema. Store limits as shared constants rather than scattering numbers through components.

## Admin journey

### Sign in

- Authenticate through Supabase Auth.
- Authorize against an explicit admin allowlist.
- Redirect non-admin authenticated users to a clear access-denied page.

### Triage dashboard

Show counts for unseen, pending, approved, rejected, duplicate, and merged submissions, plus the latest export timestamp. The unseen count must be based on stored admin state, not browser memory.

### Review grid

Provide:

- One submitted word per row
- Inline editing of canonical/editorial fields only
- Search, sorting, filters, column resizing, and pagination or virtualization
- Multi-select and safe bulk classification/approval/rejection
- Clear unsaved, saving, saved, and stale-edit states
- Keyboard navigation without trapping focus
- A details drawer or page for examples, raw values, history, and duplicate candidates

Opening a row marks it seen for that admin. It remains pending until an explicit review action.

### Classification

Keep the contributor's dialect separate from the canonical taxonomy. Let the admin:

- Select an existing canonical dialect
- Create or edit a canonical dialect
- Map a recurring submitted label as an alias suggestion
- Apply a canonical dialect to multiple selected records

Alias mappings recommend classifications for future records but never approve them automatically.

### Duplicate review and merge

Flag candidates using derived search keys and contextual similarity. Show why records matched. In a side-by-side workspace, allow the admin to:

- Choose or edit the canonical word, dialect, MSA synonym(s), and meaning
- Copy individual unique examples from any candidate
- Link every contributing raw record as a source
- Complete the merge in one transaction
- Undo the editorial action without deleting raw sources

The same spelling may legitimately represent different meanings or dialects. Never enforce uniqueness on word spelling alone.

### Export

Allow JSON and JSONL downloads of approved canonical entries only. Support filters for canonical dialect and approval/update date. Before download, show record count, export schema version, and active filters.

Create an export log containing timestamp, admin, filters, schema version, record count, deterministic checksum, and completion status. Generated export files are artifacts, not the live data store.

The external training JSON field mapping remains provisional until the earlier Lahajat AI schema is supplied or reconfirmed.

## Out of scope for V1

- Contributor accounts or submission editing links
- Public searchable dictionary
- Public voting or moderation
- Audio recording
- Automated AI classification or approval
- Multiple admin roles
- Email or push notifications
- Automatic Google Drive synchronization

## V1 acceptance journeys

1. A mobile visitor submits two words with a total of three examples and receives confirmation.
2. A contributor reloads before submission and recovers the unfinished form.
3. The admin sees a new badge, opens the record, edits canonical fields, and approves it.
4. The admin classifies `جداوي` and `مديني` under `حجازي` without changing either raw label.
5. The admin merges two `سبهللة` submissions, keeps useful examples from both, and can inspect both sources afterward.
6. An export excludes all pending/rejected records and produces stable JSON and JSONL from approved entries.
