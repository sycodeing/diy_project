import { fetchRemoteImage } from "@/lib/remote-image";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  if (!source) {
    return Response.json({ error: "Missing image URL." }, { status: 400 });
  }
  return fetchRemoteImage(source);
}
