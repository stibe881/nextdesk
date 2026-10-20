-- Sanitised test fixture derived from the completed Solutions.xml import.
-- It contains category labels, slugs and the category distribution only. Article
-- titles, bodies, people, links and all other source content are deliberately absent.
with categories(sequence, name, slug) as (
  values
  (1, 'ICT intern / Abacus', 'legacy-folder-ec62d645d5cde6bc'),
  (2, 'ICT intern / Adaxes', 'legacy-folder-f8c54d97e493a6f9'),
  (3, 'ICT intern / ClickShare', 'legacy-folder-7a77297d67e42616'),
  (4, 'ICT intern / Exchange', 'legacy-folder-e4aee1ec00aef365'),
  (5, 'ICT intern / Firewall', 'legacy-folder-06f169bd43225c30'),
  (6, 'ICT intern / FreshService', 'legacy-folder-8cbde1f9fad17102'),
  (7, 'ICT intern / Hyper-V', 'legacy-folder-7e63bf19fbb43cd8'),
  (8, 'ICT intern / Konzepte', 'legacy-folder-367fcdd58f369606'),
  (9, 'ICT intern / Microsoft Intune', 'legacy-folder-de1150b260191d07'),
  (10, 'ICT intern / PowerShell Skripts', 'legacy-folder-aecb84bd474a5e55'),
  (11, 'ICT intern / SCCM', 'legacy-folder-1c65c5156575ff9e'),
  (12, 'ICT intern / Secure Wipe', 'legacy-folder-07c2ae6e78bd95db'),
  (13, 'ICT intern / Skripte', 'legacy-folder-7e913f6a712b40d1'),
  (14, 'ICT intern / Solution - Major Incident Problem Behebung', 'legacy-folder-d54365c3749dd2aa'),
  (15, 'ICT intern / Sunet', 'legacy-folder-0e63258142922789'),
  (16, 'ICT intern / Tape', 'legacy-folder-95a07ca9e583cb4f'),
  (17, 'ICT intern / Windows Generell', 'legacy-folder-69612b05cceebb4e'),
  (18, 'ICT öffentlich / Abacus', 'legacy-folder-778159ff2c93f832'),
  (19, 'ICT öffentlich / Benutzer', 'legacy-folder-432cd6444777fcb0'),
  (20, 'ICT öffentlich / ClickShare', 'legacy-folder-afd7033bbba8ca88'),
  (21, 'ICT öffentlich / Drucker', 'legacy-folder-3288f7ed5a0e8e48'),
  (22, 'ICT öffentlich / MS Teams', 'legacy-folder-52f732f83fc65604'),
  (23, 'ICT öffentlich / Outlook', 'legacy-folder-2a3adb7853078fa5'),
  (24, 'ICT öffentlich / Sharepoint', 'legacy-folder-de67bc8b2554383d'),
  (25, 'ICT öffentlich / Tonies Box', 'legacy-folder-447ac3a8c6aedf40'),
  (26, 'ICT öffentlich / Unternehmensportal', 'legacy-folder-84d68c475834423e'),
  (27, 'ICT öffentlich / W-LAN', 'legacy-folder-d3f3b475d55eb2cc')
)
insert into public.knowledge_collections (id, tenant_id, name, slug)
select
  ('f9020000-0000-4000-8000-' || lpad(categories.sequence::text, 12, '0'))::uuid,
  'f9010000-0000-4000-8000-000000000001',
  categories.name,
  categories.slug
from categories;

insert into public.knowledge_articles (
  id, tenant_id, title, slug, visibility, status, current_revision
)
select
  ('f9030000-0000-4000-8000-' || lpad(article.number::text, 12, '0'))::uuid,
  'f9010000-0000-4000-8000-000000000001',
  'Sanitised legacy article ' || lpad(article.number::text, 2, '0'),
  'sanitised-legacy-article-' || lpad(article.number::text, 2, '0'),
  'internal',
  'draft',
  1
from generate_series(1, 64) as article(number);

with article_assignments(article_number, collection_slug) as (
  values
  (1, 'legacy-folder-8cbde1f9fad17102'),
  (2, 'legacy-folder-8cbde1f9fad17102'),
  (3, 'legacy-folder-8cbde1f9fad17102'),
  (4, 'legacy-folder-8cbde1f9fad17102'),
  (5, 'legacy-folder-8cbde1f9fad17102'),
  (6, 'legacy-folder-367fcdd58f369606'),
  (7, 'legacy-folder-367fcdd58f369606'),
  (8, 'legacy-folder-1c65c5156575ff9e'),
  (9, 'legacy-folder-1c65c5156575ff9e'),
  (10, 'legacy-folder-1c65c5156575ff9e'),
  (11, 'legacy-folder-1c65c5156575ff9e'),
  (12, 'legacy-folder-1c65c5156575ff9e'),
  (13, 'legacy-folder-1c65c5156575ff9e'),
  (14, 'legacy-folder-1c65c5156575ff9e'),
  (15, 'legacy-folder-1c65c5156575ff9e'),
  (16, 'legacy-folder-0e63258142922789'),
  (17, 'legacy-folder-95a07ca9e583cb4f'),
  (18, 'legacy-folder-06f169bd43225c30'),
  (19, 'legacy-folder-69612b05cceebb4e'),
  (20, 'legacy-folder-de1150b260191d07'),
  (21, 'legacy-folder-de1150b260191d07'),
  (22, 'legacy-folder-de1150b260191d07'),
  (23, 'legacy-folder-f8c54d97e493a6f9'),
  (24, 'legacy-folder-07c2ae6e78bd95db'),
  (25, 'legacy-folder-aecb84bd474a5e55'),
  (26, 'legacy-folder-ec62d645d5cde6bc'),
  (27, 'legacy-folder-ec62d645d5cde6bc'),
  (28, 'legacy-folder-e4aee1ec00aef365'),
  (29, 'legacy-folder-d54365c3749dd2aa'),
  (30, 'legacy-folder-7e63bf19fbb43cd8'),
  (31, 'legacy-folder-7e913f6a712b40d1'),
  (32, 'legacy-folder-7e913f6a712b40d1'),
  (33, 'legacy-folder-432cd6444777fcb0'),
  (34, 'legacy-folder-432cd6444777fcb0'),
  (35, 'legacy-folder-3288f7ed5a0e8e48'),
  (36, 'legacy-folder-3288f7ed5a0e8e48'),
  (37, 'legacy-folder-3288f7ed5a0e8e48'),
  (38, 'legacy-folder-3288f7ed5a0e8e48'),
  (39, 'legacy-folder-3288f7ed5a0e8e48'),
  (40, 'legacy-folder-3288f7ed5a0e8e48'),
  (41, 'legacy-folder-3288f7ed5a0e8e48'),
  (42, 'legacy-folder-3288f7ed5a0e8e48'),
  (43, 'legacy-folder-3288f7ed5a0e8e48'),
  (44, 'legacy-folder-2a3adb7853078fa5'),
  (45, 'legacy-folder-2a3adb7853078fa5'),
  (46, 'legacy-folder-2a3adb7853078fa5'),
  (47, 'legacy-folder-2a3adb7853078fa5'),
  (48, 'legacy-folder-2a3adb7853078fa5'),
  (49, 'legacy-folder-2a3adb7853078fa5'),
  (50, 'legacy-folder-2a3adb7853078fa5'),
  (51, 'legacy-folder-2a3adb7853078fa5'),
  (52, 'legacy-folder-2a3adb7853078fa5'),
  (53, 'legacy-folder-52f732f83fc65604'),
  (54, 'legacy-folder-52f732f83fc65604'),
  (55, 'legacy-folder-52f732f83fc65604'),
  (56, 'legacy-folder-d3f3b475d55eb2cc'),
  (57, 'legacy-folder-d3f3b475d55eb2cc'),
  (58, 'legacy-folder-d3f3b475d55eb2cc'),
  (59, 'legacy-folder-d3f3b475d55eb2cc'),
  (60, 'legacy-folder-d3f3b475d55eb2cc'),
  (61, 'legacy-folder-d3f3b475d55eb2cc'),
  (62, 'legacy-folder-778159ff2c93f832'),
  (63, 'legacy-folder-84d68c475834423e'),
  (64, 'legacy-folder-447ac3a8c6aedf40')
)
insert into public.knowledge_article_collections (tenant_id, article_id, collection_id)
select
  'f9010000-0000-4000-8000-000000000001',
  ('f9030000-0000-4000-8000-' || lpad(article_assignments.article_number::text, 12, '0'))::uuid,
  collection.id
from article_assignments
join public.knowledge_collections as collection
  on collection.tenant_id = 'f9010000-0000-4000-8000-000000000001'
 and collection.slug = article_assignments.collection_slug;
