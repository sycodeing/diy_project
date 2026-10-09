"use client";

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { ArrowRight, Check, ImageUp, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { CheckoutAddressDialog } from "@/components/checkout-address-dialog";
import {
  DEFAULT_DESIGN,
  PRODUCT_ARTWORK_FRAME,
  POSITION_OPTIONS,
  PRODUCT_CURRENCY,
  PRODUCT_PRICE_CENTS,
  SHAPE_OPTIONS,
  getColorHex,
} from "@/lib/product-config";
import { renderMockupPreviewsFromUrl } from "@/lib/mockup-renderer";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type {
  DesignPayload,
  DesignPosition,
  DesignShape,
  ProductSide,
  ShippingAddress,
} from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

const STORAGE_KEY = "studio-blank-design";
const ADDRESS_STORAGE_KEY = "studio-blank-shipping-address";
const CROP_OUTPUT_TYPE = "image/webp";

const EMPTY_ADDRESS: ShippingAddress = {
  fullName: "",
  line1: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
};

type CropDraft = {
  fileName: string;
  offsetX: number;
  offsetY: number;
  sourceUrl: string;
  zoom: number;
};

type CropDrag = {
  mode: "pan";
  originX: number;
  originY: number;
  pointerId: number;
  startX: number;
  startY: number;
};

type CropGesture = {
  originX: number;
  originY: number;
  startCenterX: number;
  startCenterY: number;
  startDistance: number;
  startZoom: number;
};

type TrackedPointer = {
  x: number;
  y: number;
};

type MockupPreview = {
  id: string;
  label: string;
  url: string;
};

export function DiyDesigner({
  authEnabled = false,
  autoCheckout = false,
  initialParams = {},
  isAuthenticated = false,
  paypalEnabled = false,
  userId = null,
  defaultShippingAddress = null,
}: {
  authEnabled?: boolean;
  autoCheckout?: boolean;
  initialParams?: Record<string, string | undefined>;
  isAuthenticated?: boolean;
  paypalEnabled?: boolean;
  userId?: string | null;
  defaultShippingAddress?: ShippingAddress | null;
}) {
  const router = useRouter();
  const activeSide: ProductSide = "front";
  const [hasInitialLinkDesign] = useState(
    () => Boolean(designFromRecord(initialParams)),
  );
  const [design, setDesign] = useState<DesignPayload>(
    () => designFromRecord(initialParams) ?? DEFAULT_DESIGN,
  );
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null);
  const [checkoutAddress, setCheckoutAddress] =
    useState<ShippingAddress>(EMPTY_ADDRESS);
  const [isAddressOpen, setIsAddressOpen] = useState(false);
  const [mockupPreviews, setMockupPreviews] = useState<MockupPreview[]>([]);
  const [activeMockupId, setActiveMockupId] = useState<string | null>(null);
  const [mockupStatus, setMockupStatus] = useState<
    "idle" | "rendering" | "ready" | "failed"
  >("idle");
  const [isReadingImage, setIsReadingImage] = useState(false);
  const [isPending, startTransition] = useTransition();
  const mockupObjectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    void trackMarketingEvent("design_opened");
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (!hasInitialLinkDesign) {
        const savedDesign = readStoredDesign();
        if (savedDesign) setDesign(savedDesign);
      }
      setHasLoadedDraft(true);
    });
  }, [hasInitialLinkDesign]);

  useEffect(() => {
    if (!hasLoadedDraft) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  }, [design, hasLoadedDraft]);

  useEffect(() => {
    if (!autoCheckout) return;
    if (authEnabled && !isAuthenticated) {
      const returnTo = getCheckoutReturnTo();
      router.replace(`/auth?next=${encodeURIComponent(returnTo)}`);
      return;
    }
    queueMicrotask(() => {
      setCheckoutAddress(readStoredAddress(getAddressStorageKey(userId), defaultShippingAddress));
      setIsAddressOpen(true);
    });
  }, [authEnabled, autoCheckout, defaultShippingAddress, isAuthenticated, router, userId]);

  useEffect(() => {
    return () => {
      revokeObjectUrls(mockupObjectUrlsRef.current);
    };
  }, []);

  useEffect(() => {
    const artworkUrl = design.sides.front.imagePreviewUrl;
    let canceled = false;

    if (!artworkUrl) {
      revokeObjectUrls(mockupObjectUrlsRef.current);
      mockupObjectUrlsRef.current = [];
      queueMicrotask(() => {
        if (!canceled) {
          setMockupStatus("idle");
          setMockupPreviews([]);
          setActiveMockupId(null);
        }
      });
      return () => {
        canceled = true;
      };
    }

    queueMicrotask(() => {
      if (!canceled) {
        setMockupStatus("rendering");
      }
    });

    renderMockupPreviewsFromUrl(artworkUrl)
      .then((renderedPreviews) => {
        if (canceled) {
          return;
        }

        const previews = renderedPreviews.map((preview) => ({
          id: preview.id,
          label: preview.label,
          url: URL.createObjectURL(preview.blob),
        }));
        revokeObjectUrls(mockupObjectUrlsRef.current);
        mockupObjectUrlsRef.current = previews.map((preview) => preview.url);
        setMockupPreviews(previews);
        setActiveMockupId((current) =>
          previews.some((preview) => preview.id === current)
            ? current
            : previews[0]?.id ?? null,
        );
        setMockupStatus("ready");
        void trackMarketingEvent("preview_ready");
      })
      .catch(() => {
        if (!canceled) {
          revokeObjectUrls(mockupObjectUrlsRef.current);
          mockupObjectUrlsRef.current = [];
          setMockupPreviews([]);
          setActiveMockupId(null);
          setMockupStatus("failed");
        }
      });

    return () => {
      canceled = true;
    };
  }, [design.sides.front.imagePreviewUrl]);

  function updateSide(
    side: ProductSide,
    patch: Partial<DesignPayload["sides"][ProductSide]>,
  ) {
    setDesign((current) => ({
      ...current,
      sides: {
        ...current.sides,
        [side]: {
          ...current.sides[side],
          ...patch,
        },
      },
    }));
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setIsReadingImage(true);
    setError(null);
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        setError("Could not read this image.");
        setIsReadingImage(false);
        return;
      }

      setCropDraft({
        fileName: file.name,
        offsetX: 0,
        offsetY: 0,
        sourceUrl: reader.result,
        zoom: 1,
      });
      setIsReadingImage(false);
    });
    reader.addEventListener("error", () => {
      setError("Could not read this image.");
      setIsReadingImage(false);
    });
    reader.readAsDataURL(file);
  }

  function applyCroppedImage(imagePreviewUrl: string) {
    setMockupStatus("rendering");
    updateSide("front", {
      kind: "image",
      imagePreviewUrl,
      imagePath: undefined,
      position: "full_panel",
      shape: PRODUCT_ARTWORK_FRAME.shape === "circle" ? "circle" : "rectangle",
    });
    setCropDraft(null);
  }

  function checkout() {
    setError(null);
    startTransition(() => {
      try {
        if (!design.sides.front.imagePreviewUrl) {
          throw new Error("Upload or open a link with an image first.");
        }

        if (authEnabled && !isAuthenticated) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
          router.push(`/auth?next=${encodeURIComponent(getCheckoutReturnTo())}`);
          return;
        }

        setCheckoutAddress(readStoredAddress(getAddressStorageKey(userId), defaultShippingAddress));
        setIsAddressOpen(true);
      } catch (checkoutError) {
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Checkout failed.",
        );
      }
    });
  }

  function confirmOrder(address: ShippingAddress, paymentProvider: "stripe" | "paypal") {
    setError(null);
    setIsAddressOpen(false);
    startTransition(async () => {
      try {
        window.localStorage.setItem(getAddressStorageKey(userId), JSON.stringify(address));
        const uploadedDesign = await uploadArtwork(design);
        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ design: uploadedDesign, shipping: address, paymentProvider }),
        });
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Could not prepare payment.");
        }

        window.localStorage.removeItem(STORAGE_KEY);
        window.location.href = payload.url;
      } catch (checkoutError) {
        setError(
          checkoutError instanceof Error
            ? checkoutError.message
            : "Checkout failed.",
        );
      }
    });
  }

  async function uploadArtwork(current: DesignPayload) {
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      throw new Error("Supabase is required for real orders.");
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      router.push(`/auth?next=${encodeURIComponent(getCheckoutReturnTo())}`);
      throw new Error("Sign in before checkout.");
    }

    const uploaded = structuredClone(current);
    const front = uploaded.sides.front;

    if (front.kind !== "image" || !front.imagePreviewUrl) {
      throw new Error("Upload or open an image before checkout.");
    }

    if (!front.imagePath) {
      const imageResponse = await fetch(front.imagePreviewUrl);
      if (!imageResponse.ok) {
        throw new Error("Could not prepare the artwork for storage.");
      }

      const blob = await imageResponse.blob();
      const extension = blob.type === "image/png" ? "png" : "webp";
      const path = `${user.id}/${crypto.randomUUID()}/front.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("design-assets")
        .upload(path, blob, {
          cacheControl: "3600",
          contentType: blob.type || "image/webp",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      front.imagePath = path;
    }

    delete front.imagePreviewUrl;
    return uploaded;
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-6 pt-6 sm:px-6 lg:min-h-[calc(100dvh-4rem)]">
      <section className="grid flex-1 gap-5 lg:grid-rows-[1fr_auto]">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-2xl border border-line bg-panel p-4 shadow-[0_18px_48px_rgba(23,33,31,0.08)] sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="max-w-2xl text-3xl font-black leading-tight tracking-[-0.035em] sm:text-4xl">
                  {design.sides.front.imagePreviewUrl ? "Preview your custom pillow" : "Upload a photo to begin"}
                </h1>
                <p className="mt-2 text-sm text-muted">Follow the steps below. You can review the result before ordering.</p>
              </div>
              <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
                <p className="text-muted">Base price</p>
                <p className="text-2xl font-black">
                  {formatMoney(PRODUCT_PRICE_CENTS, PRODUCT_CURRENCY)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  2 covers · 18in / 45cm · inserts not included
                </p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-surface text-xs font-bold sm:text-sm" aria-label="Order steps">
              <span className={cn("flex min-h-11 items-center justify-center gap-2 px-2", !design.sides.front.imagePreviewUrl ? "bg-accent text-accent-ink" : "text-accent-strong")}><span className="grid size-6 place-items-center rounded-full border border-current/20 bg-white/20">1</span> Upload</span>
              <span className={cn("flex min-h-11 items-center justify-center gap-2 px-2", design.sides.front.imagePreviewUrl ? "bg-accent text-accent-ink" : "text-muted")}><span className="grid size-6 place-items-center rounded-full border border-current/20 bg-panel">2</span> Preview</span>
              <span className="flex min-h-11 items-center justify-center gap-2 px-2 text-muted"><span className="grid size-6 place-items-center rounded-full border border-line bg-panel">3</span> Order</span>
            </div>

            <ContentControls chooseImage={chooseImage} design={design} />

            <PillowPreview
              activeSide={activeSide}
              activeMockupId={activeMockupId}
              design={design}
              isLoading={isReadingImage || mockupStatus === "rendering"}
              loadingLabel={
                isReadingImage
                  ? "Reading your photo..."
                  : "Rendering four real-scene previews..."
              }
              mockupPreviews={mockupPreviews}
              onSelectMockup={setActiveMockupId}
            />

            <p className="mt-3 text-sm text-muted" role="status" aria-live="polite">
              {mockupStatus === "ready"
                ? `${mockupPreviews.length} room previews are ready.`
                : mockupStatus === "rendering"
                  ? "Creating your room previews..."
                : mockupStatus === "failed"
                    ? "Room previews are unavailable. You can still review the layout."
                    : "Choose a photo to create room previews."}
            </p>
          </div>

          <aside className="h-fit rounded-2xl border border-line bg-panel p-5 shadow-sm lg:sticky lg:top-20">
            <p className="text-lg font-black">Your order</p>
            <p className="mt-2 text-sm leading-6 text-muted">A set of two 18in / 45cm pillow covers. Inserts are not included.</p>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-sm">
              <span className="text-muted">Total</span>
              <span className="text-xl font-black">{formatMoney(PRODUCT_PRICE_CENTS, PRODUCT_CURRENCY)}</span>
            </div>
            <p className="mt-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-strong">{design.sides.front.imagePreviewUrl ? "Photo added. Review the preview, then continue." : "Start by adding your photo."}</p>
          </aside>
        </div>

        <div className="-mx-4 border-t border-line bg-panel px-4 py-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-xl lg:border lg:p-5">
          {error ? (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              {authEnabled
                ? "Preview first. Sign in and enter an eligible address only when you are ready to order."
                : "Configure Supabase and Stripe to accept real orders."}
            </p>
            <button
              className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-black text-accent-ink shadow-sm shadow-teal-900/15 transition hover:bg-accent-strong active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !design.sides.front.imagePreviewUrl || isPending || isReadingImage || mockupStatus === "rendering"
              }
              onClick={checkout}
              type="button"
            >
              {isReadingImage || mockupStatus === "rendering"
                ? "Creating previews..."
                : isPending
                ? "Continuing..."
                : !design.sides.front.imagePreviewUrl
                  ? "Upload a photo first"
                : authEnabled && !isAuthenticated
                  ? "Sign in to continue"
                : "Continue to delivery"}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>
      {cropDraft ? (
        <PhotoCropper
          draft={cropDraft}
          onApply={applyCroppedImage}
          onCancel={() => setCropDraft(null)}
          onChange={setCropDraft}
        />
      ) : null}
      {isAddressOpen ? (
        <CheckoutAddressDialog
          initialAddress={checkoutAddress}
          onClose={() => setIsAddressOpen(false)}
          onConfirm={confirmOrder}
          paypalEnabled={paypalEnabled}
        />
      ) : null}
    </main>
  );
}

async function trackMarketingEvent(eventType: "design_opened" | "preview_ready") {
  try {
    await fetch("/api/marketing/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType }),
      keepalive: true,
    });
  } catch {
    // Attribution must never block the customer from designing or checking out.
  }
}

function ContentControls({
  chooseImage,
  design,
}: {
  chooseImage: (event: ChangeEvent<HTMLInputElement>) => void;
  design: DesignPayload;
}) {
  const side = design.sides.front;

  return (
    <div className="grid gap-4">
      <ControlGroup title="Photo">
        <div className="grid gap-3 sm:grid-cols-[240px_minmax(0,1fr)]">
          <label
            className={cn(
              "focus-ring inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition active:translate-y-px",
              side.kind === "image"
                ? "border-accent bg-accent/10 text-foreground"
                : "border-line bg-panel text-muted hover:bg-surface hover:text-foreground",
            )}
          >
            <ImageUp size={16} />
            Image
            <input
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={chooseImage}
              type="file"
            />
          </label>
          <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
            {side.imagePreviewUrl
              ? "Photo loaded. Use the upload button to replace it."
              : "JPG, PNG or WebP. Your photo is used to prepare the preview."}
          </div>
        </div>
      </ControlGroup>
    </div>
  );
}

function PhotoCropper({
  draft,
  onApply,
  onCancel,
  onChange,
}: {
  draft: CropDraft;
  onApply: (imagePreviewUrl: string) => void;
  onCancel: () => void;
  onChange: (draft: CropDraft) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<CropDrag | null>(null);
  const gestureRef = useRef<CropGesture | null>(null);
  const pointersRef = useRef<Map<number, TrackedPointer>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    let canceled = false;

    if (!canvas) {
      return;
    }

    renderCropToCanvas(draft, canvas).catch(() => {
      if (!canceled) {
        setCropError("Could not preview this image.");
      }
    });

    return () => {
      canceled = true;
    };
  }, [draft]);

  function patchDraft(patch: Partial<CropDraft>) {
    onChange({ ...draft, ...patch });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      dragRef.current = {
        mode: "pan",
        originX: draft.offsetX,
        originY: draft.offsetY,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      gestureRef.current = null;
      return;
    }

    if (pointers.size === 2) {
      const gesturePoints = [...pointers.values()];
      const center = getPointCenter(gesturePoints[0], gesturePoints[1]);

      dragRef.current = null;
      gestureRef.current = {
        originX: draft.offsetX,
        originY: draft.offsetY,
        startCenterX: center.x,
        startCenterY: center.y,
        startDistance: getPointDistance(gesturePoints[0], gesturePoints[1]),
        startZoom: draft.zoom,
      };
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;
    const existingPointer = pointers.get(event.pointerId);

    if (!existingPointer) {
      return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && gestureRef.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const gesturePoints = [...pointers.values()];
      const center = getPointCenter(gesturePoints[0], gesturePoints[1]);
      const distance = getPointDistance(gesturePoints[0], gesturePoints[1]);
      const zoomRatio = distance / gestureRef.current.startDistance;
      const nextZoom = clamp(gestureRef.current.startZoom * zoomRatio, 1, 3);
      const nextX =
        gestureRef.current.originX -
        ((center.x - gestureRef.current.startCenterX) / rect.width) * 160;
      const nextY =
        gestureRef.current.originY -
        ((center.y - gestureRef.current.startCenterY) / rect.height) * 160;

      patchDraft({
        offsetX: clamp(nextX, -100, 100),
        offsetY: clamp(nextY, -100, 100),
        zoom: nextZoom,
      });
      return;
    }

    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId || pointers.size !== 1) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nextX =
      drag.originX - ((event.clientX - drag.startX) / rect.width) * 160;
    const nextY =
      drag.originY - ((event.clientY - drag.startY) / rect.height) * 160;

    patchDraft({
      offsetX: clamp(nextX, -100, 100),
      offsetY: clamp(nextY, -100, 100),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const pointers = pointersRef.current;

    pointers.delete(event.pointerId);

    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }

    if (pointers.size < 2) {
      gestureRef.current = null;
    }

    if (pointers.size === 1) {
      const [nextPointerId] = pointers.keys();
      const nextPointer = pointers.get(nextPointerId);

      if (nextPointer) {
        dragRef.current = {
          mode: "pan",
          originX: draft.offsetX,
          originY: draft.offsetY,
          pointerId: nextPointerId,
          startX: nextPointer.x,
          startY: nextPointer.y,
        };
      }
    }
  }

  function onCropWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    patchDraft({
      zoom: clamp(draft.zoom - event.deltaY * 0.002, 1, 3),
    });
  }

  async function confirmCrop() {
    setIsProcessing(true);
    setCropError(null);

    try {
      onApply(await createCroppedDataUrl(draft));
    } catch {
      setCropError("Could not crop this image.");
    } finally {
      setIsProcessing(false);
    }
  }

  const frameClass =
    PRODUCT_ARTWORK_FRAME.shape === "circle"
      ? "aspect-square rounded-full"
      : PRODUCT_ARTWORK_FRAME.aspectRatio === 1
        ? "aspect-square rounded-lg"
        : "aspect-[4/3] rounded-lg";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-3xl rounded-2xl border border-line bg-panel p-4 shadow-2xl shadow-slate-900/20 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
              Crop photo
            </p>
            <h2 className="mt-1 text-2xl font-black tracking-normal">
              {PRODUCT_ARTWORK_FRAME.label}
            </h2>
          </div>
          <button
            aria-label="Close cropper"
            className="focus-ring grid size-10 place-items-center rounded-lg border border-line bg-surface text-muted transition hover:text-foreground"
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_230px]">
          <div
            className={cn(
              "relative cursor-grab touch-none select-none overflow-hidden border border-line bg-surface active:cursor-grabbing",
              frameClass,
            )}
            onPointerCancel={onPointerUp}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onCropWheel}
          >
            <canvas
              aria-label="Cropped artwork preview"
              className="h-full w-full"
              height={PRODUCT_ARTWORK_FRAME.outputHeight}
              ref={canvasRef}
              width={PRODUCT_ARTWORK_FRAME.outputWidth}
            />
            <CropGrid />
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-surface p-3 text-sm">
              <p className="font-bold">{draft.fileName}</p>
              <p className="mt-1 text-muted">
                {PRODUCT_ARTWORK_FRAME.outputWidth} x{" "}
                {PRODUCT_ARTWORK_FRAME.outputHeight}
              </p>
            </div>

            <SliderControl
              label="Zoom"
              max={3}
              min={1}
              onChange={(value) => patchDraft({ zoom: value })}
              step={0.01}
              value={draft.zoom}
            />

            {cropError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">
                {cropError}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-bold text-foreground transition hover:bg-surface"
                onClick={onCancel}
                type="button"
              >
                <X size={16} />
                Cancel
              </button>
              <button
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-3 text-sm font-black text-accent-ink transition hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isProcessing}
                onClick={confirmCrop}
                type="button"
              >
                {isProcessing ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {isProcessing ? "Preparing..." : "Use photo"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function CropGrid() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
      <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
      <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
      <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
      <div className="absolute inset-0 border border-white/70" />
    </div>
  );
}

function SliderControl({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="block text-sm font-bold">
      <span className="mb-2 flex items-center justify-between">
        {label}
        <span className="font-mono text-xs text-muted">{value.toFixed(2)}</span>
      </span>
      <input
        className="w-full accent-[var(--accent)]"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function ControlGroup({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-black uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      {children}
    </div>
  );
}

function PillowPreview({
  activeSide,
  activeMockupId,
  design,
  isLoading,
  loadingLabel,
  mockupPreviews,
  onSelectMockup,
}: {
  activeSide: ProductSide;
  activeMockupId: string | null;
  design: DesignPayload;
  isLoading: boolean;
  loadingLabel: string;
  mockupPreviews: MockupPreview[];
  onSelectMockup: (id: string) => void;
}) {
  const color = getColorHex(design.selection.color);
  const side = design.sides[activeSide];
  const activeMockup =
    mockupPreviews.find((preview) => preview.id === activeMockupId) ??
    mockupPreviews[0];

  if (activeMockup) {
    return (
      <div className="grid gap-3">
        <div className="relative grid min-h-[320px] place-items-center overflow-hidden rounded-xl border border-line bg-surface sm:min-h-[440px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={`Rendered pillow preview: ${activeMockup.label}`}
            className="h-full max-h-[620px] w-full object-contain"
            src={activeMockup.url}
          />
          <PreviewLoadingOverlay label={loadingLabel} visible={isLoading} />
        </div>
        <div
          aria-label="Pillow preview scenes"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {mockupPreviews.map((preview) => (
            <button
              aria-pressed={preview.id === activeMockup.id}
              className={cn(
                "focus-ring grid min-w-0 gap-2 rounded-lg border bg-panel p-2 text-left transition",
                preview.id === activeMockup.id
                  ? "border-2 border-accent text-foreground"
                  : "border-line text-muted hover:border-accent/50 hover:text-foreground",
              )}
              key={preview.id}
              onClick={() => onSelectMockup(preview.id)}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="aspect-square w-full rounded object-cover"
                src={preview.url}
              />
              <span className="truncate text-xs font-bold">{preview.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative grid min-h-[320px] place-items-center overflow-hidden rounded-xl border border-line bg-surface sm:min-h-[440px]">
      <div className="relative w-full max-w-[360px] px-10 py-8 sm:max-w-[460px]">
        <div className="absolute left-[12%] right-[12%] top-4 h-0.5 bg-foreground/90">
          <span className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rotate-45 border-b-2 border-l-2 border-foreground" />
          <span className="absolute -right-1 top-1/2 size-2 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-foreground" />
        </div>
        <div className="absolute bottom-[16%] right-2 top-[16%] w-0.5 bg-foreground/90">
          <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-l-2 border-t-2 border-foreground" />
          <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-foreground" />
        </div>
        <div className="relative mx-auto aspect-square w-full">
          <div
            className="absolute inset-[3%] rounded-[28px] border border-white/40 shadow-2xl shadow-black/60"
            style={{
              background: `linear-gradient(145deg, ${color}, ${color} 62%, rgb(0 0 0 / 0.16))`,
            }}
          />
          <div className="absolute inset-[5%] rounded-[24px] border border-black/10 bg-white/10 shadow-inner" />
          <div className="absolute inset-x-[8%] top-[12%] h-[16%] rounded-lg border border-black/10 bg-white/15" />
          <div className="absolute bottom-[9%] left-[16%] right-[16%] h-6 rounded-full bg-black/10 blur-sm" />
          <PrintLayer side={activeSide} sideDesign={side} />
        </div>
      </div>
      <div className="absolute left-4 top-4 rounded-lg border border-line bg-background/70 px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] text-muted backdrop-blur">
        {activeSide} view
      </div>
      <PreviewLoadingOverlay label={loadingLabel} visible={isLoading} />
    </div>
  );
}

function PreviewLoadingOverlay({
  label,
  visible,
}: {
  label: string;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <div
      aria-busy="true"
      aria-live="assertive"
      className="absolute inset-0 z-20 grid place-items-center bg-white/90 px-6 text-center backdrop-blur-sm"
      role="status"
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel px-5 py-7 shadow-2xl shadow-slate-900/15 sm:px-8">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto animate-spin text-accent"
          size={48}
          strokeWidth={3}
        />
        <p className="mt-5 text-2xl font-black tracking-normal">
          Building your preview
        </p>
        <p className="mt-2 text-sm font-bold text-muted">{label}</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface">
          <span className="block h-full w-full animate-pulse bg-accent" />
        </div>
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-accent">
          Keep this page open
        </p>
      </div>
    </div>
  );
}

function revokeObjectUrls(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

function PrintLayer({
  side,
  sideDesign,
}: {
  side: ProductSide;
  sideDesign: DesignPayload["sides"][ProductSide];
}) {
  if (sideDesign.kind === "none") {
    return null;
  }

  const positionClass = getPositionClass(side, sideDesign.position);
  const shapeClass =
    sideDesign.shape === "circle" ? "rounded-full aspect-square" : "rounded-lg";
  const sizeClass =
    sideDesign.position === "top_banner"
      ? "w-[44%] min-h-12 text-[0.7rem]"
      : sideDesign.position === "bottom_caption"
        ? "w-[46%] min-h-10 text-[0.56rem]"
        : sideDesign.position === "full_panel"
          ? "w-[68%] min-h-[58%] text-[0.8rem]"
          : "w-[40%] min-h-20 text-[0.72rem]";

  return (
    <div
      className={cn(
        "absolute grid place-items-center overflow-hidden border border-black/30 bg-foreground p-2 text-center font-black uppercase leading-tight tracking-normal text-background shadow-xl",
        positionClass,
        shapeClass,
        sizeClass,
      )}
    >
      {sideDesign.kind === "image" ? (
        sideDesign.imagePreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt="DIY uploaded artwork preview"
            className="h-full w-full object-cover"
            src={sideDesign.imagePreviewUrl}
          />
        ) : (
          <span>Upload image</span>
        )
      ) : (
        <span>Upload image</span>
      )}
    </div>
  );
}

async function renderCropToCanvas(draft: CropDraft, canvas: HTMLCanvasElement) {
  const image = await loadImage(draft.sourceUrl);
  const crop = getCropSourceRect(image.naturalWidth, image.naturalHeight, draft);
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas is not available.");
  }

  canvas.width = PRODUCT_ARTWORK_FRAME.outputWidth;
  canvas.height = PRODUCT_ARTWORK_FRAME.outputHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    crop.sourceX,
    crop.sourceY,
    crop.sourceWidth,
    crop.sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
}

async function createCroppedDataUrl(draft: CropDraft) {
  const canvas = document.createElement("canvas");
  await renderCropToCanvas(draft, canvas);
  return canvas.toDataURL(CROP_OUTPUT_TYPE, 0.9);
}

function getCropSourceRect(
  imageWidth: number,
  imageHeight: number,
  draft: CropDraft,
) {
  const targetAspect = PRODUCT_ARTWORK_FRAME.aspectRatio;
  const imageAspect = imageWidth / imageHeight;
  const coverWidth =
    imageAspect > targetAspect ? imageHeight * targetAspect : imageWidth;
  const coverHeight =
    imageAspect > targetAspect ? imageHeight : imageWidth / targetAspect;
  const sourceWidth = coverWidth / draft.zoom;
  const sourceHeight = coverHeight / draft.zoom;
  const maxOffsetX = Math.max((imageWidth - sourceWidth) / 2, 0);
  const maxOffsetY = Math.max((imageHeight - sourceHeight) / 2, 0);
  const sourceX = clamp(
    imageWidth / 2 - sourceWidth / 2 + (draft.offsetX / 100) * maxOffsetX,
    0,
    imageWidth - sourceWidth,
  );
  const sourceY = clamp(
    imageHeight / 2 - sourceHeight / 2 + (draft.offsetY / 100) * maxOffsetY,
    0,
    imageHeight - sourceHeight,
  );

  return {
    sourceHeight,
    sourceWidth,
    sourceX,
    sourceY,
  };
}

function loadImage(sourceUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Image failed to load.")));
    image.src = sourceUrl;
  });
}

function getPointCenter(first: TrackedPointer, second: TrackedPointer) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function getPointDistance(first: TrackedPointer, second: TrackedPointer) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPositionClass(side: ProductSide, position: string) {
  if (side === "back") {
    return "left-1/2 top-[40%] -translate-x-1/2";
  }

  switch (position) {
    case "top_banner":
      return "left-1/2 top-[16%] -translate-x-1/2";
    case "bottom_caption":
      return "left-1/2 top-[70%] -translate-x-1/2";
    case "full_panel":
      return "left-1/2 top-[20%] -translate-x-1/2";
    default:
      return "left-1/2 top-[42%] -translate-x-1/2";
  }
}

function designFromRecord(
  params: Record<string, string | undefined>,
): DesignPayload | null {
  const image = normalizeImageParam(
    params.image ??
      params.imageUrl ??
      params.img ??
      undefined,
  );

  if (!image) {
    return null;
  }

  const shape = pickParam(
    params.shape ?? null,
    SHAPE_OPTIONS.map((item) => item.value),
    DEFAULT_DESIGN.sides.front.shape,
  ) as DesignShape;
  const position = pickParam(
    params.position ?? null,
    POSITION_OPTIONS.filter((item) => item.sides.includes("front")).map(
      (item) => item.value,
    ),
    DEFAULT_DESIGN.sides.front.position,
  ) as DesignPosition;

  return {
    ...DEFAULT_DESIGN,
    sides: {
      ...DEFAULT_DESIGN.sides,
      front: {
        kind: "image",
        imagePreviewUrl: image,
        shape,
        position,
      },
    },
  };
}

function readStoredDesign() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const design = JSON.parse(value) as DesignPayload;
    return design?.selection?.productSlug === "custom-pillow"
      ? { ...design, selection: DEFAULT_DESIGN.selection }
      : null;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function getAddressStorageKey(userId: string | null) {
  return `${ADDRESS_STORAGE_KEY}:${userId ?? "guest"}`;
}

function getCheckoutReturnTo() {
  const url = new URL(window.location.href);
  url.searchParams.set("checkout", "1");
  return `${url.pathname}${url.search}`;
}

function readStoredAddress(
  storageKey: string,
  fallback: ShippingAddress | null,
) {
  try {
    const value = window.localStorage.getItem(storageKey);
    const address = value ? (JSON.parse(value) as ShippingAddress) : null;
    const isComplete = address && [
      address.fullName,
      address.line1,
      address.city,
      address.region,
      address.postalCode,
      address.country,
    ].every((part) => typeof part === "string" && part.trim().length > 0);
    return isComplete ? address : fallback ?? EMPTY_ADDRESS;
  } catch {
    window.localStorage.removeItem(storageKey);
    return fallback ?? EMPTY_ADDRESS;
  }
}

function normalizeImageParam(value?: string) {
  if (value === "/debug/pillow-sample.svg") {
    return "/debug/pillow-sample.png";
  }

  return value;
}

function pickParam<T extends string>(
  value: string | null,
  allowed: T[],
  fallback: T,
) {
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}
