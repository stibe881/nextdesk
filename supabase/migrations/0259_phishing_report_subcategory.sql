-- Phishing reports can also set a subcategory on the security ticket.
alter table public.phishing_report_settings
  add column if not exists subcategory_id uuid
    references public.ticket_categories(id) on delete set null;
