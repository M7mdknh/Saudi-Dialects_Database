-- Starter canonical dialect taxonomy. Admins can add/edit further dialects
-- and aliases from the admin area; this seed only bootstraps common labels.
insert into dialects (name_ar, slug) values
  ('حجازي', 'hijazi'),
  ('نجدي', 'najdi'),
  ('خليجي', 'khaleeji'),
  ('شامي', 'shami'),
  ('مصري', 'masri'),
  ('مغربي', 'maghribi'),
  ('عراقي', 'iraqi'),
  ('يمني', 'yamani'),
  ('سوداني', 'sudani'),
  ('ليبي', 'libi')
on conflict (slug) do nothing;
