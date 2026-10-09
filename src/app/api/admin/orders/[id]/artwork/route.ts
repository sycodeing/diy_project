import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { DesignPayload, ProductSide } from "@/lib/types";

const orderIdSchema = z.string().uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();

  const { id } = await params;
  const parsedId = orderIdSchema.safeParse(id);
  if (!parsedId.success) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const side = new URL(request.url).searchParams.get("side");
  if (side !== "front" && side !== "back") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const supabase = await createSupabaseServerClient();
  const serviceClient = getSupabaseServiceClient();
  if (!supabase || !serviceClient) {
    return Response.json({ error: "Download is unavailable." }, { status: 503 });
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id,user_id,order_number,design_snapshot")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (!order) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const design = order.design_snapshot as DesignPayload;
  const imagePath = design.sides[side as ProductSide]?.imagePath;
  const expectedFolder = `${order.user_id}/`;
  if (
    !imagePath ||
    !imagePath.startsWith(expectedFolder) ||
    imagePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return Response.json({ error: "Image not found." }, { status: 404 });
  }

  const { data: image, error } = await serviceClient.storage
    .from("design-assets")
    .download(imagePath);
  if (error || !image) {
    return Response.json({ error: "Image not found." }, { status: 404 });
  }

  const safeOrderNumber = order.order_number.replace(/[^A-Za-z0-9_-]/g, "") || "order";
  const fileName = `DIY-${safeOrderNumber}.webp`;
  return new Response(image, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Type": image.type || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
