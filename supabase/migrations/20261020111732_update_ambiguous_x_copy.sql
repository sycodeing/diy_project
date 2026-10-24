update public.x_leads
set
  consent_copy = replace(
    consent_copy,
    'Happy birthday to your little star!',
    'Your pet is absolutely adorable—this photo really made me smile!'
  ),
  public_copy =
    'Your pet is absolutely adorable—this photo really made me smile! '
    || 'I made a custom pet pillow preview from it. View it, change the photo, or order yours: '
    || substring(public_copy from '(https://[^[:space:]]+)$'),
  direct_message_copy = replace(
    replace(
      direct_message_copy,
      'Happy birthday to your little star!',
      'Your pet is absolutely adorable—this photo really made me smile!'
    ),
    'the birthday keepsake',
    'the custom keepsake'
  )
where occasion = 'pet_birthday'
  and coalesce(occasion_confidence, 0) < 70
  and public_copy like 'Happy birthday to your little star!%';

update public.x_manual_posts as task
set post_text =
  'Your pet is absolutely adorable—this photo really made me smile! '
  || 'I made a custom pet pillow preview from it. View it, change the photo, or order yours: '
  || substring(task.post_text from '(https://[^[:space:]]+)$')
from public.x_leads as lead
where task.x_lead_id = lead.id
  and task.status = 'draft'
  and lead.occasion = 'pet_birthday'
  and coalesce(lead.occasion_confidence, 0) < 70
  and task.post_text like 'Happy birthday to your little star!%';

update public.x_reply_jobs as task
set reply_text =
  'Your pet is absolutely adorable—this photo really made me smile! '
  || 'I made a custom pet pillow preview from it. View it, change the photo, or order yours: '
  || substring(task.reply_text from '(https://[^[:space:]]+)$')
from public.x_leads as lead
where task.x_lead_id = lead.id
  and task.status = 'draft'
  and lead.occasion = 'pet_birthday'
  and coalesce(lead.occasion_confidence, 0) < 70
  and task.reply_text like 'Happy birthday to your little star!%';
