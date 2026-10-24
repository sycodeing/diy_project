export const X_REPLY_STATUS_LABELS: Record<string, string> = {
  draft: "待审核",
  queued: "已批准，等待本机",
  claimed: "本机处理中",
  sent: "发送成功",
  failed: "发送失败",
  uncertain: "结果不确定，禁止重试",
  rejected: "已拒绝",
};

export const X_REPLY_STATUS_STYLES: Record<string, string> = {
  draft: "border-amber-200 bg-amber-50 text-amber-900",
  queued: "border-blue-200 bg-blue-50 text-blue-900",
  claimed: "border-violet-200 bg-violet-50 text-violet-900",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-900",
  failed: "border-red-200 bg-red-50 text-red-900",
  uncertain: "border-orange-300 bg-orange-50 text-orange-950",
  rejected: "border-line bg-surface text-muted",
};

export const X_ACTION_LABELS: Record<string, string> = {
  post: "原创帖子",
  reply: "回复帖子",
};

export const X_MANUAL_STATUS_LABELS: Record<string, string> = {
  draft: "待手动发送",
  sent: "已登记发送",
  discarded: "已作废",
};

export type XReplyAccount = {
  id: string;
  account_key: string;
  display_name: string;
  positioning: string;
  audience: string;
  voice: string;
  topics: string[];
  prohibited_topics: string;
  daily_limit: number;
  active: boolean;
  created_at: string;
};

export type XReplyJob = {
  id: string;
  action_type: "post" | "reply";
  target_post_url: string | null;
  reply_text: string;
  scheduled_for: string;
  status: string;
  account_key_snapshot: string | null;
  positioning_snapshot: string | null;
  worker_id: string | null;
  xuse_draft_id: string | null;
  action_id: string | null;
  result_url: string | null;
  error_code: string | null;
  error_message: string | null;
  approved_at: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
  x_lead_id: string | null;
  preparation_status: "pending" | "processing" | "ready" | "failed";
  preparation_error: string | null;
  prepared_at: string | null;
  x_reply_accounts: Pick<XReplyAccount, "account_key" | "display_name" | "positioning"> | null;
};

export type XManualPost = {
  id: string;
  action_type: "post" | "reply";
  target_post_url: string | null;
  post_text: string;
  status: "draft" | "sent" | "discarded";
  result_url: string | null;
  sent_at: string | null;
  created_at: string;
  preparation_status: "pending" | "processing" | "ready" | "failed";
  preparation_error: string | null;
  prepared_at: string | null;
  preview_download_status: "idle" | "pending" | "processing" | "completed" | "failed";
  preview_download_path: string | null;
  preview_download_error: string | null;
  preview_download_requested_at: string | null;
  preview_downloaded_at: string | null;
  x_reply_accounts: Pick<XReplyAccount, "account_key" | "display_name" | "positioning"> | null;
  x_leads: null | {
    media_url: string;
    pet_type: "cat" | "dog" | null;
    marketing_links: null | {
      source_hash: string;
      expires_at: string;
    };
  };
};

const X_MANUAL_STATUS_ORDER: Record<XManualPost["status"], number> = {
  draft: 0,
  sent: 1,
  discarded: 2,
};

export function sortXManualPosts(posts: XManualPost[]) {
  return posts.toSorted((left, right) => {
    const statusDifference = X_MANUAL_STATUS_ORDER[left.status] - X_MANUAL_STATUS_ORDER[right.status];
    return statusDifference || right.created_at.localeCompare(left.created_at);
  });
}

export type XReplyWorker = {
  worker_id: string;
  status: string;
  xuse_available: boolean;
  configured_accounts: string[];
  worker_version: string | null;
  last_error: string | null;
  last_seen_at: string;
};
