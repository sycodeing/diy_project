import { handleMarketingRedirect } from "@/lib/marketing-redirect";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return handleMarketingRedirect(request, token, true);
}
