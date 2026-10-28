-- Occasion detection remains useful for lead discovery, but outbound copy must
-- only praise the pet's cuteness. Preserve historical sent copy as an audit log.
update public.x_leads
set consent_copy = 'Your pet is absolutely adorable—this photo really made me smile! Would you be comfortable if I turned this photo into a private custom pet-pillow preview? No reposting or purchase required.',
    public_copy = 'Your pet is absolutely adorable—this photo really made me smile! I made a custom pet-pillow preview from this photo as a personal keepsake. You can view it with no pressure: {link}',
    direct_message_copy = 'Hi! Your pet is absolutely adorable—this photo really made me smile! I made a custom pet pillow preview so you can see the custom keepsake before deciding. Preview, edit, or order yours here: {link}. No pressure—reply stop anytime.'
where selection_status not in ('contacted', 'suppressed', 'rejected')
  and concat_ws(' ', consent_copy, public_copy, direct_message_copy) ~* '(birthday|barkday|adopt|new family member|welcome.home)';

with affected as (
  select id, (regexp_match(post_text, '(https://[^[:space:]]+)$'))[1] as link
  from public.x_manual_posts
  where status = 'draft'
    and post_text ~* '(birthday|barkday|adopt|new family member|welcome.home)'
)
update public.x_manual_posts as task
set post_text = case
  when affected.link is null then 'Your pet is absolutely adorable—this photo really made me smile! I made a custom pet-pillow preview from this photo as a personal keepsake.'
  else left('Your pet is absolutely adorable—this photo really made me smile! I made a custom pet-pillow preview from this photo as a personal keepsake. You can view it with no pressure:', 269 - length(affected.link)) || ' ' || affected.link
end
from affected
where task.id = affected.id;

with affected as (
  select id, (regexp_match(reply_text, '(https://[^[:space:]]+)$'))[1] as link
  from public.x_reply_jobs
  where status = 'draft'
    and reply_text ~* '(birthday|barkday|adopt|new family member|welcome.home)'
)
update public.x_reply_jobs as task
set reply_text = case
  when affected.link is null then 'Your pet is absolutely adorable—this photo really made me smile! I made a custom pet-pillow preview from this photo as a personal keepsake.'
  else left('Your pet is absolutely adorable—this photo really made me smile! I made a custom pet-pillow preview from this photo as a personal keepsake. You can view it with no pressure:', 269 - length(affected.link)) || ' ' || affected.link
end
from affected
where task.id = affected.id;
