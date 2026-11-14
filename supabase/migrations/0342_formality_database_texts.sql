-- formality-ok-file: enthält bewusst beide Fassungen (du und Sie) der Texte, die die Datenbank erzeugt.
set local search_path = pg_catalog, public;

-- Texte, die die Datenbank selbst erzeugt, folgen der Anrede des Mandanten
-- (Einstellungen → Design → Anrede): standardmässig du, auf Wunsch Sie.

create or replace function public.tenant_formality(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (select settings.formality from public.tenant_settings settings
      where settings.tenant_id = p_tenant_id),
    'du'
  );
$$;
revoke all on function public.tenant_formality(uuid) from public, anon, authenticated;
grant execute on function public.tenant_formality(uuid) to service_role;

do $$
declare
  v_def text;
  v_new text;
begin
  -- Wissensartikel im Ticket: Standardtext per du.
  select pg_get_functiondef('public.knowledge_article_requester_comment(text,text)'::regprocedure) into v_def;
  v_new := replace(v_def, 'mit allen Bildern finden ''', 'mit allen Bildern findest ''');
  v_new := replace(v_new, '|| ''Sie im Portal in diesem Ticket', '|| ''du im Portal in diesem Ticket');
  if v_new = v_def or position('findest ' in v_new) = 0 or position('''du im Portal' in v_new) = 0 then
    raise exception 'knowledge_article_requester_comment: Muster nicht gefunden';
  end if;
  execute v_new;

  -- ... und für Mandanten mit «Sie» in der Sie-Fassung.
  select pg_get_functiondef('public.ticket_knowledge_mutate(text,uuid,uuid,uuid,text,text,text)'::regprocedure) into v_def;
  v_new := replace(
    v_def,
    'comment_body := public.knowledge_article_requester_comment(article.title, revision.body);',
    'comment_body := public.knowledge_article_requester_comment(article.title, revision.body);' || E'\n' ||
    '  if public.tenant_formality(p_tenant_id) = ''sie'' then' || E'\n' ||
    '    comment_body := replace(comment_body, ''findest du im Portal'', ''finden Sie im Portal'');' || E'\n' ||
    '  end if;'
  );
  if v_new = v_def then
    raise exception 'ticket_knowledge_mutate: Muster nicht gefunden';
  end if;
  execute v_new;

  -- Automatische Erinnerung an wartende Anfragende.
  select pg_get_functiondef('public.ticket_lifecycle_run()'::regprocedure) into v_def;
  v_new := replace(
    v_def,
    '''Guten Tag'' || E''\n\n'' ||' || E'\n' ||
    '        ''Wir warten noch auf Ihre Rückmeldung zu Ticket '' || v_ticket.ticket_number ||' || E'\n' ||
    '        ''. Bitte antworten Sie direkt auf diese Nachricht, damit wir weiterarbeiten können.'' ||',
    'case when public.tenant_formality(v_ticket.tenant_id) = ''sie'' then ''Guten Tag'' else ''Hallo'' end || E''\n\n'' ||' || E'\n' ||
    '        case when public.tenant_formality(v_ticket.tenant_id) = ''sie''' || E'\n' ||
    '          then ''Wir warten noch auf Ihre Rückmeldung zu Ticket '' || v_ticket.ticket_number ||' || E'\n' ||
    '            ''. Bitte antworten Sie direkt auf diese Nachricht, damit wir weiterarbeiten können.''' || E'\n' ||
    '          else ''Wir warten noch auf deine Rückmeldung zu Ticket '' || v_ticket.ticket_number ||' || E'\n' ||
    '            ''. Bitte antworte direkt auf diese Nachricht, damit wir weiterarbeiten können.''' || E'\n' ||
    '        end ||'
  );
  if v_new = v_def then
    raise exception 'ticket_lifecycle_run: Muster nicht gefunden';
  end if;
  execute v_new;
end;
$$;

-- Bereits gespeicherte, automatisch erzeugte Texte in Mandanten mit «du» auf
-- die du-Fassung bringen (nur wenn der Text genau dem alten Wortlaut entspricht).
with texts (sie, du) as (
  values
    (E'Wir haben die gemeldete E-Mail geprüft: Sie ist echt und ungefährlich. Sie können sie normal bearbeiten.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.',
     E'Wir haben die gemeldete E-Mail geprüft: Sie ist echt und ungefährlich. Du kannst sie normal bearbeiten.\n\nDanke, dass du aufmerksam warst und sie gemeldet hast.'),
    (E'Wir haben die gemeldete E-Mail geprüft: Es ist Werbung (Spam), aber kein Angriff. Sie können sie löschen.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.',
     E'Wir haben die gemeldete E-Mail geprüft: Es ist Werbung (Spam), aber kein Angriff. Du kannst sie löschen.\n\nDanke, dass du aufmerksam warst und sie gemeldet hast.'),
    (E'Wir haben die gemeldete E-Mail geprüft: Das war Phishing. Die Mail wollte Zugangsdaten oder persönliche Angaben abgreifen. Wir sperren den Absender und entfernen die Mail aus den Postfächern.\n\nSie müssen nichts weiter tun. Falls Sie einen Link geöffnet, einen Anhang geöffnet oder Ihr Passwort eingegeben haben, melden Sie sich bitte sofort beim Support.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.',
     E'Wir haben die gemeldete E-Mail geprüft: Das war Phishing. Die Mail wollte Zugangsdaten oder persönliche Angaben abgreifen. Wir sperren den Absender und entfernen die Mail aus den Postfächern.\n\nDu musst nichts weiter tun. Falls du einen Link geöffnet, einen Anhang geöffnet oder dein Passwort eingegeben hast, melde dich bitte sofort beim Support.\n\nDanke, dass du aufmerksam warst und sie gemeldet hast.'),
    (E'Wir haben die gemeldete E-Mail geprüft: Das war ein gezielter Angriff auf unsere Organisation. Wir sperren den Absender und entfernen die Mail aus den Postfächern.\n\nFalls Sie einen Link geöffnet, einen Anhang geöffnet oder Ihr Passwort eingegeben haben, melden Sie sich bitte sofort beim Support.\n\nDanke, dass Sie aufmerksam waren und sie gemeldet haben.',
     E'Wir haben die gemeldete E-Mail geprüft: Das war ein gezielter Angriff auf unsere Organisation. Wir sperren den Absender und entfernen die Mail aus den Postfächern.\n\nFalls du einen Link geöffnet, einen Anhang geöffnet oder dein Passwort eingegeben hast, melde dich bitte sofort beim Support.\n\nDanke, dass du aufmerksam warst und sie gemeldet hast.')
)
update public.ticket_comments comment
   set body = texts.du
  from texts, public.tickets ticket
 where comment.body = texts.sie
   and ticket.id = comment.ticket_id
   and public.tenant_formality(ticket.tenant_id) = 'du';

update public.ticket_comments comment
   set body = regexp_replace(
         regexp_replace(
           regexp_replace(comment.body, '^Guten Tag(\s)', E'Hallo\\1'),
           'auf Ihre Rückmeldung', 'auf deine Rückmeldung'),
         'Bitte antworten Sie direkt', 'Bitte antworte direkt')
  from public.tickets ticket
 where ticket.id = comment.ticket_id
   and comment.body like E'Guten Tag\n\nWir warten noch auf Ihre Rückmeldung zu Ticket %'
   and public.tenant_formality(ticket.tenant_id) = 'du';
