-- X lead tasks publish public replies. Earlier link generation mislabeled these
-- campaigns as direct messages, which made channel reporting inaccurate.
update public.marketing_links
set channel = 'public_reply',
    updated_at = now()
where channel = 'direct_message'
  and campaign like 'x\_%' escape '\';
