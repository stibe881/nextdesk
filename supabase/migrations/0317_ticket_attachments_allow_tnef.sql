-- Eingehende E-Mails mit dem Outlook-Anhang «winmail.dat» (application/ms-tnef),
-- z. B. gemeldete Nachrichten aus Outlook («Melden»), werden am Ticket abgelegt.
-- Nur Download, die Datei wird nie ausgeführt oder dargestellt.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/ms-tnef'
]::text[]
where id = 'ticket-attachments';
