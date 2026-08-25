-- Renames the Hijazi local dialect label from "مكي" to "مكاوي" (both mean
-- "of Mecca"; "مكاوي" is the requested canonical spelling). Data-only: the
-- row was seeded by 0012_saudi_classification.sql and is already applied in
-- both local and production databases, so it must be corrected with an
-- UPDATE rather than by editing that historical migration. slug/parent/
-- main_group_code are left untouched — nothing outside this label depends
-- on the Arabic spelling.
update dialects
set name_ar = 'مكاوي'
where slug = 'makki' and name_ar = 'مكي';
