with aliases as (
  select
    id,
    translate(
      encode(substring(decode(token_hash, 'hex') from 1 for 9), 'base64'),
      '+/',
      '-_'
    ) as short_alias
  from public.marketing_links
  where short_token_hash is null
)
update public.marketing_links as link
set short_token_hash = encode(extensions.digest(alias.short_alias, 'sha256'), 'hex')
from aliases as alias
where link.id = alias.id;

with aliases as (
  select
    id,
    translate(
      encode(substring(decode(token_hash, 'hex') from 1 for 9), 'base64'),
      '+/',
      '-_'
    ) as short_alias
  from public.marketing_links
)
update public.x_leads as lead
set
  consent_copy = regexp_replace(lead.consent_copy, '/go/[A-Za-z0-9_-]{43,64}', '/g/' || alias.short_alias, 'g'),
  public_copy = regexp_replace(lead.public_copy, '/go/[A-Za-z0-9_-]{43,64}', '/g/' || alias.short_alias, 'g'),
  direct_message_copy = regexp_replace(lead.direct_message_copy, '/go/[A-Za-z0-9_-]{43,64}', '/g/' || alias.short_alias, 'g')
from aliases as alias
where lead.marketing_link_id = alias.id;

with aliases as (
  select
    id,
    translate(
      encode(substring(decode(token_hash, 'hex') from 1 for 9), 'base64'),
      '+/',
      '-_'
    ) as short_alias
  from public.marketing_links
)
update public.x_reply_jobs as job
set reply_text = regexp_replace(job.reply_text, '/go/[A-Za-z0-9_-]{43,64}', '/g/' || alias.short_alias, 'g')
from public.x_leads as lead, aliases as alias
where job.x_lead_id = lead.id
  and lead.marketing_link_id = alias.id
  and job.status in ('draft', 'queued');

with aliases as (
  select
    id,
    translate(
      encode(substring(decode(token_hash, 'hex') from 1 for 9), 'base64'),
      '+/',
      '-_'
    ) as short_alias
  from public.marketing_links
)
update public.x_manual_posts as post
set post_text = regexp_replace(post.post_text, '/go/[A-Za-z0-9_-]{43,64}', '/g/' || alias.short_alias, 'g')
from public.x_leads as lead, aliases as alias
where post.x_lead_id = lead.id
  and lead.marketing_link_id = alias.id
  and post.status = 'draft';
