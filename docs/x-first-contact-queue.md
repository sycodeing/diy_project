# Text-only first-contact automatic queue

New automatic lead tasks prepare `first_contact_v1`, with job-scoped
`content_mode=first_contact_text` and `copy_variant`. The text describes a custom
pet-photo pillow cover, $19.99 shipped to the US, approximately 15-day delivery,
no insert, and asks whether the recipient wants to see a sample. No claim that a
preview has already been made; no short link or image attachment.

## State and compatibility

- Preparing first contact does not call the marketing-link/preview generator.
- Existing ready/approved tasks retain their content and legacy attachment mode.
- Only unapproved, unattempted drafts may be regenerated into new copy, using the
  per-task button. Sent, uncertain, claimed, queued and rejected jobs are not rewritten.
- The existing explicit Start/approval, account verification, daily gates, limits,
  observe/send switch and no automatic uncertain retry remain in force.
- Worker 4.8.0 advertises `first_contact_text_v1`; older workers do not claim text jobs.
- The worker requires an explicit text mode; missing images on legacy jobs remain
  errors. Text jobs never download/attach stale previews, even if a lead has one.
- The sample/preview generator and manual image workflow remain available. Reply
  monitoring and automatic second-message follow-up are NOT part of this change.
- First-contact success is confirmed reply publication; no landing/CTR is expected
  from a message without a link. Measure actual replies and expressed interest next.

## Rollout

1. Apply `20261113061456_x_reply_first_contact_text_mode.sql` (additive, legacy default).
2. Deploy the web code and upgrade the sending worker to 4.8.0+ without changing its
   current observe/send authorization. Do not start sending as part of deployment.
3. Inspect a newly prepared draft or explicitly regenerate an unsent legacy draft.
4. Review the exact text, then use existing Start controls if sending is authorized.

This code is not proof of X platform approval. Operator approval does not equal
recipient opt-in. Automated unsolicited replies and website scripting carry X
policy/account risks. No evasion, account rotation or challenge bypass is added.
