import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const runtime = "nodejs";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");

  if (!source) {
    return Response.json({ error: "Missing image URL." }, { status: 400 });
  }

  let url: URL;

  try {
    url = new URL(source);
  } catch {
    return Response.json({ error: "Invalid image URL." }, { status: 400 });
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    (await isPrivateHost(url.hostname))
  ) {
    return Response.json({ error: "Image host is not allowed." }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? 0);

    if (!response.ok || !contentType.startsWith("image/")) {
      return Response.json({ error: "Remote URL is not an image." }, { status: 400 });
    }

    if (declaredLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Image exceeds 10 MB." }, { status: 413 });
    }

    const body = await response.arrayBuffer();

    if (body.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "Image exceeds 10 MB." }, { status: 413 });
    }

    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Could not load remote image." }, { status: 502 });
  }
}

async function isPrivateHost(hostname: string) {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }

  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
    return addresses.some(({ address }) => isPrivateAddress(address));
  } catch {
    return true;
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();

  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) {
    return true;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  const ipv4 = normalized.startsWith("::ffff:")
    ? normalized.slice("::ffff:".length)
    : normalized;
  const parts = ipv4.split(".").map(Number);

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] >= 224 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}
