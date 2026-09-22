const LOCAL_RENDERER_URL = "http://127.0.0.1:8010/render-preview";

export const MOCKUP_TEMPLATES = [
  { id: "pillow-psd-03-grey-sofa", label: "Grey sofa close-up" },
  { id: "pillow-psd-04-size", label: "18in / 45cm size" },
  { id: "pillow-psd-06-wood-chair", label: "Wood chair" },
  { id: "pillow-psd-01", label: "Sofa room" },
] as const;

export async function renderMockupPreviewsFromUrl(imageUrl: string) {
  const artworkUrl = /^https?:\/\//i.test(imageUrl)
    ? `/api/artwork?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;
  const artworkResponse = await fetch(artworkUrl);

  if (!artworkResponse.ok) {
    throw new Error("Could not load artwork for mockup rendering.");
  }

  const artwork = await artworkResponse.blob();
  const rendererEndpoint = getRendererEndpoint();

  return Promise.all(
    MOCKUP_TEMPLATES.map(async (template) => {
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

      return {
        ...template,
        blob: await mockupResponse.blob(),
      };
    }),
  );
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
