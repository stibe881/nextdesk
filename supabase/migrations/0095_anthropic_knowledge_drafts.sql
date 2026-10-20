begin;

set local search_path = pg_catalog, public;

-- Anthropic is an explicitly named external provider. Existing metadata for the
-- former no-provider foundation remains valid but cannot authorize Anthropic.
alter table public.tenant_ai_provider_approvals
  add column allow_external_article_content boolean not null default false;
alter table public.tenant_ai_provider_approvals
  drop constraint if exists tenant_ai_provider_approvals_provider_key_check;
alter table public.tenant_ai_provider_approvals
  add constraint tenant_ai_provider_approvals_provider_key_check
  check (provider_key in ('nextdesk-managed', 'anthropic'));

alter table public.ai_draft_requests
  drop constraint if exists ai_draft_requests_provider_key_check;
alter table public.ai_draft_requests
  add constraint ai_draft_requests_provider_key_check
  check (provider_key in ('nextdesk-managed', 'anthropic'));

-- Preserve the metadata-only, service-role-only queue. The caller-provided
-- provider key is still constrained by the matching approval row under lock.
create or replace function public.queue_ai_draft_request(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_provider_key text,
  p_purpose text,
  p_object_type text,
  p_object_id uuid,
  p_input_character_count integer,
  p_max_output_tokens integer,
  p_max_cost_cents integer,
  p_external_article_content boolean
)
returns table (request_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_approval public.tenant_ai_provider_approvals%rowtype;
  v_article_visibility public.knowledge_articles.visibility%type;
  v_request_count integer;
  v_now timestamptz := timezone('utc', now());
begin
  if p_tenant_id is null
    or p_actor_id is null
    or p_provider_key not in ('nextdesk-managed', 'anthropic')
    or p_purpose not in ('general_draft', 'ticket_reply_draft', 'knowledge_article_draft')
    or p_object_type not in ('none', 'ticket', 'knowledge_article')
    or p_input_character_count not between 1 and 1200
    or p_max_output_tokens not between 16 and 1024
    or p_max_cost_cents not between 1 and 50
    or p_external_article_content is null
    or (p_object_type = 'none' and (p_object_id is not null or p_purpose <> 'general_draft'))
    or (p_object_type = 'ticket' and (p_object_id is null or p_purpose <> 'ticket_reply_draft'))
    or (p_object_type = 'knowledge_article' and (p_object_id is null or p_purpose <> 'knowledge_article_draft'))
  then
    raise exception 'Invalid AI draft request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.tenant_memberships membership
    join public.tenants tenant on tenant.id = membership.tenant_id
    where membership.tenant_id = p_tenant_id
      and membership.user_id = p_actor_id
      and membership.status = 'active'
      and tenant.status = 'active'
  ) then
    raise exception 'Tenant membership required' using errcode = '42501';
  end if;

  select * into v_approval
  from public.tenant_ai_provider_approvals approval
  where approval.tenant_id = p_tenant_id
    and approval.provider_key = p_provider_key
  for update;

  if not found
    or not v_approval.enabled
    or v_approval.approved_at > v_now
    or (v_approval.expires_at is not null and v_approval.expires_at <= v_now)
    or not (p_purpose = any(v_approval.allowed_purposes))
    or p_max_output_tokens > v_approval.max_output_tokens
    or p_max_cost_cents > v_approval.max_cost_cents_per_request then
    raise exception 'AI provider approval does not permit this request' using errcode = '42501';
  end if;

  if p_object_type = 'none'
    and p_external_article_content
    and not v_approval.allow_external_article_content then
    raise exception 'External article content is not approved for AI processing' using errcode = 'P0003';
  end if;

  if p_object_type = 'ticket' and not exists (
    select 1 from public.tickets ticket
    where ticket.id = p_object_id and ticket.tenant_id = p_tenant_id
  ) then
    raise exception 'AI object is unavailable' using errcode = 'P0002';
  end if;
  if p_object_type = 'knowledge_article' then
    select article.visibility into v_article_visibility
    from public.knowledge_articles article
    where article.id = p_object_id
      and article.tenant_id = p_tenant_id
      and article.status <> 'archived'
    for share;
    if not found then
      raise exception 'AI object is unavailable' using errcode = 'P0002';
    end if;
    if v_article_visibility = 'external'
      and not v_approval.allow_external_article_content then
      raise exception 'External article content is not approved for AI processing' using errcode = 'P0003';
    end if;
  end if;

  select count(*) into v_request_count
  from public.ai_draft_requests request
  where request.tenant_id = p_tenant_id
    and request.provider_key = p_provider_key
    and request.created_at >= date_trunc('hour', v_now);
  if v_request_count >= v_approval.max_requests_per_hour then
    raise exception 'AI hourly request budget exceeded' using errcode = 'P0001';
  end if;

  insert into public.ai_draft_requests (
    tenant_id, approval_id, actor_id, provider_key, purpose, object_type, object_id,
    input_character_count, max_output_tokens, max_cost_cents, created_at
  ) values (
    p_tenant_id, v_approval.id, p_actor_id, p_provider_key, p_purpose, p_object_type, p_object_id,
    p_input_character_count, p_max_output_tokens, p_max_cost_cents, v_now
  ) returning id into request_id;

  return next;
end;
$$;

drop function if exists public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer);
revoke all on function public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.queue_ai_draft_request(uuid, uuid, text, text, text, uuid, integer, integer, integer, boolean)
  to service_role;

comment on column public.tenant_ai_provider_approvals.allow_external_article_content is
  'Explicit tenant consent to send external-article raw content to the named AI provider.';
comment on table public.ai_draft_requests is
  'Atomic AI request metadata only; it never stores raw input, prompts or generated output.';

commit;
