import templateRegistry from "@/lib/mockup-templates.json";

const LOCAL_RENDERER_URL = "http://127.0.0.1:8010/render-preview";
const MOCKUP_BROWSER_CACHE_NAME = "studio-blank-mockup-previews-v1";
const MAX_CACHED_PREVIEWS = 48;

export type MockupTemplateDefinition = {
  adminLabel: string;
  cardImageUrl: string;
  fallbackImageUrl?: string;
  family: string;
  id: string;
  label: string;
};

export const MOCKUP_TEMPLATES = templateRegistry satisfies MockupTemplateDefinition[];

export type RenderedMockupPreview = {
  id: string;
  label: string;
  blob: Blob;
};

export type MockupRenderResult = {
  previews: RenderedMockupPreview[];
  cacheHitCount: number;
};

export function getMockupFallbackPreviews(templateIds: string[]) {
  return MOCKUP_TEMPLATES
    .filter((template) => templateIds.includes(template.id))
    .map((template) => ({
      id: template.id,
      label: template.label,
      url: template.fallbackImageUrl ?? template.cardImageUrl,
    }));
}

export async function renderMockupPreviewsFromUrl(
  imageUrl: string,
  templateIds: string[] = MOCKUP_TEMPLATES.map((template) => template.id),
  onPreview?: (preview: RenderedMockupPreview) => void,
) {
  const artworkUrl = /^https?:\/\//i.test(imageUrl)
    ? `/api/artwork?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;
  const artworkResponse = await fetch(artworkUrl);

  if (!artworkResponse.ok) {
    throw new Error("Could not load artwork for mockup rendering.");
  }

  const artwork = await artworkResponse.blob();
  const rendererEndpoint = getRendererEndpoint();

  const templates = MOCKUP_TEMPLATES.filter((template) => templateIds.includes(template.id));
  if (!templates.length) throw new Error("No supported mockup templates were selected.");
  const browserCache = await openMockupBrowserCache(artwork, templates);
  let cacheHitCount = 0;

  const renderTemplate = async (template: MockupTemplateDefinition) => {
    const cachedBlob = await browserCache?.read(template.id);
    if (cachedBlob) {
      cacheHitCount += 1;
      const cachedPreview = { ...template, blob: cachedBlob };
      onPreview?.(cachedPreview);
      return cachedPreview;
    }

    const formData = new FormData();
    formData.append("template_id", template.id);
    formData.append("artwork", artwork, "artwork.webp");

    const mockupResponse = await fetch(rendererEndpoint, {
      body: formData,
      method: "POST",
    });

    if (!mockupResponse.ok) {
      throw new Error(`Mockup renderer failed for ${template.id}.`);
    }

    const preview = {
      ...template,
      blob: await mockupResponse.blob(),
    };
    await browserCache?.write(template.id, preview.blob);
    onPreview?.(preview);
    return preview;
  };

  // Prioritize the main scene so the customer sees a realistic result quickly.
  const [firstResult] = await Promise.allSettled([renderTemplate(templates[0])]);
  const restResults = await Promise.allSettled(
    templates.slice(1).map(renderTemplate),
  );
  const previews = [firstResult, ...restResults].flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (previews.length === 0) {
    throw new Error("Could not render a pillow preview.");
  }
  void browserCache?.trim();
  return { previews, cacheHitCount } satisfies MockupRenderResult;
}

async function openMockupBrowserCache(
  artwork: Blob,
  templates: MockupTemplateDefinition[],
) {
  if (typeof window === "undefined" || !("caches" in window) || !window.crypto?.subtle) {
    return null;
  }

  try {
    const digest = await window.crypto.subtle.digest("SHA-256", await artwork.arrayBuffer());
    const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const cache = await window.caches.open(MOCKUP_BROWSER_CACHE_NAME);
    const templateIds = new Set(templates.map((template) => template.id));
    const requestFor = (templateId: string) => new Request(
      `${window.location.origin}/__mockup-preview-cache/${fingerprint}/${encodeURIComponent(templateId)}.webp`,
    );

    return {
      async read(templateId: string) {
        if (!templateIds.has(templateId)) return null;
        const response = await cache.match(requestFor(templateId));
        return response?.ok ? response.blob() : null;
      },
      async write(templateId: string, blob: Blob) {
        if (!templateIds.has(templateId)) return;
        try {
          await cache.put(requestFor(templateId), new Response(blob, {
            headers: { "Content-Type": blob.type || "image/webp" },
          }));
        } catch {
          // Storage quota or privacy settings should not block preview rendering.
        }
      },
      async trim() {
        try {
          const keys = await cache.keys();
          const excess = keys.length - MAX_CACHED_PREVIEWS;
          if (excess > 0) {
            await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
          }
        } catch {
          // Cache cleanup is best-effort.
        }
      },
    };
  } catch {
    return null;
  }
}

function getRendererEndpoint() {
  const configuredUrl = process.env.NEXT_PUBLIC_MOCKUP_RENDERER_URL?.replace(
    /\/$/,
    "",
  );

  if (configuredUrl) {
    return `${configuredUrl}/render-preview`;
  }

  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    return LOCAL_RENDERER_URL;
  }

  return "/api/mockup";
}
