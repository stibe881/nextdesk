-- Sicherheitsfälle: die gemeldete E-Mail so, wie sie beim Empfänger ankam
-- (alle Kopfzeilen, HTML- und Textfassung, Anhangsliste). Die Darstellung im
-- Web geschieht in einem abgeschotteten Rahmen ohne Skripte, mit entschärften
-- Links und ohne externe Bilder. Nur über die Edge Function lesbar.
alter table public.phishing_reports
  add column if not exists original_mail jsonb;
