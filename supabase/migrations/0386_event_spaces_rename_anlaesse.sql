begin;

-- «Raumplanung» heisst neu «Anlässe» (Modulname und Berechtigungstexte).
update public.feature_catalog
   set name = 'Anlässe',
       description = 'Anlässe planen: Räume reservieren, Einrichtung und Technik an die zuständigen Abteilungen geben.'
 where key = 'event.spaces';

update public.permissions
   set description = 'Anlässe und Veranstaltungsräume verwalten'
 where code = 'event.spaces.manage';

update public.permissions
   set description = 'Anlässe anfragen'
 where code = 'event.spaces.request';

commit;
