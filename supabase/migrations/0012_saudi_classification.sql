-- Saudi-only main classification. Five stable, public leaderboard groups.
-- The contributor's submitted/local label (raw_word_submissions.submitted_dialect)
-- is never touched by this; main_group_code lives on the admin-controlled
-- `dialects` taxonomy row a canonical entry is classified under, so
-- reclassifying a dialect (or moving a canonical entry to a different
-- dialect row) is exactly how an admin changes a word's main classification
-- — and public counts (0013) read it live, so the change is immediate.

alter table dialects
  add column if not exists main_group_code text
    check (main_group_code in ('hijazi', 'najdi', 'eastern', 'northern', 'southern'));

create index if not exists dialects_main_group_code_idx on dialects (main_group_code);

-- The V0 seed (0005) targeted a generic pan-Arab set that doesn't fit a
-- Saudi-only product. Deactivate rather than delete — any canonical entry
-- already classified under one of these rows must keep working, and an
-- admin can always reactivate or reorganize instead.
update dialects
set is_active = false
where slug in ('khaleeji', 'shami', 'masri', 'maghribi', 'iraqi', 'yamani', 'sudani', 'libi');

-- The five main groups themselves, plus a starting set of local dialects
-- nested under them (parent_id) so the admin has something to work with on
-- day one. This is a helpful default, not a restriction: admins can add,
-- rename, reparent, or reclassify (change main_group_code) any dialect at
-- any time via create_dialect()/upsert_canonical_entry() — see
-- data-model.md "do not enforce uniqueness on word spelling alone" and the
-- product spec's classification rules.
insert into dialects (name_ar, slug, main_group_code) values
  ('حجازي', 'hijazi-main', 'hijazi'),
  ('نجدي', 'najdi-main', 'najdi'),
  ('شرقاوي', 'eastern-main', 'eastern'),
  ('شمالي', 'northern-main', 'northern'),
  ('جنوبي', 'southern-main', 'southern')
on conflict (slug) do update set main_group_code = excluded.main_group_code;

-- The pre-existing non-Saudi 'hijazi'/'najdi' slugs from 0005 are distinct
-- rows from '*-main' above; deactivate them too since they're superseded.
update dialects set is_active = false where slug in ('hijazi', 'najdi');

with main as (
  select id, slug from dialects where slug in
    ('hijazi-main', 'najdi-main', 'eastern-main', 'northern-main', 'southern-main')
),
locals (name_ar, slug, parent_slug, code) as (
  values
    ('جداوي', 'jeddawi', 'hijazi-main', 'hijazi'),
    ('مكي', 'makki', 'hijazi-main', 'hijazi'),
    ('مديني', 'madani', 'hijazi-main', 'hijazi'),
    ('طائفي', 'taifi', 'hijazi-main', 'hijazi'),
    ('قصيمي', 'qassimi', 'najdi-main', 'najdi'),
    ('عارضي', 'aridi', 'najdi-main', 'najdi'),
    ('سديري', 'sudairi', 'najdi-main', 'najdi'),
    ('حساوي', 'hasawi', 'eastern-main', 'eastern'),
    ('قطيفي', 'qatifi', 'eastern-main', 'eastern'),
    ('دمامي', 'dammami', 'eastern-main', 'eastern'),
    ('حائلي', 'haili', 'northern-main', 'northern'),
    ('جوفي', 'jawfi', 'northern-main', 'northern'),
    ('تبوكي', 'tabuki', 'northern-main', 'northern'),
    ('عسيري', 'asiri', 'southern-main', 'southern'),
    ('جازاني', 'jazani', 'southern-main', 'southern'),
    ('باحي', 'bahi', 'southern-main', 'southern'),
    ('نجراني', 'najrani', 'southern-main', 'southern')
)
insert into dialects (name_ar, slug, parent_id, main_group_code)
select l.name_ar, l.slug, m.id, l.code
from locals l
join main m on m.slug = l.parent_slug
on conflict (slug) do update set parent_id = excluded.parent_id, main_group_code = excluded.main_group_code;
