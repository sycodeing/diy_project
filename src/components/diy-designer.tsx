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
import { ArrowRight, Check, Crop, ImageUp, X } from "lucide-react";
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
import { createMockOrder, saveMockOrder } from "@/lib/mock-orders";
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
  userEmail = null,
}: {
  authEnabled?: boolean;
  autoCheckout?: boolean;
  initialParams?: Record<string, string | undefined>;
  isAuthenticated?: boolean;
  userEmail?: string | null;
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
  const [isPending, startTransition] = useTransition();
  const mockupObjectUrlsRef = useRef<string[]>([]);

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
    if (!autoCheckout || (authEnabled && !isAuthenticated)) return;
    queueMicrotask(() => {
      setCheckoutAddress(readStoredAddress());
      setIsAddressOpen(true);
    });
  }, [authEnabled, autoCheckout, isAuthenticated]);

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

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        setError("Could not read this image.");
        return;
      }

      setError(null);
      setCropDraft({
        fileName: file.name,
        offsetX: 0,
        offsetY: 0,
        sourceUrl: reader.result,
        zoom: 1,
      });
    });
    reader.readAsDataURL(file);
  }

  function applyCroppedImage(imagePreviewUrl: string) {
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
          router.push(`/auth?next=${encodeURIComponent("/design?checkout=1")}`);
          return;
        }

        setCheckoutAddress(readStoredAddress());
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

  function confirmMockOrder(address: ShippingAddress) {
    window.localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify(address));
    const order = createMockOrder(design, address, userEmail);
    saveMockOrder(order);
    window.localStorage.removeItem(STORAGE_KEY);
    setIsAddressOpen(false);
    router.push(`/orders/${order.id}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-6 pt-6 sm:px-6 lg:min-h-[calc(100dvh-4rem)]">
      <section className="grid flex-1 gap-5 lg:grid-rows-[1fr_auto]">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="rounded-lg border border-line bg-panel/75 p-4 shadow-2xl shadow-black/30 sm:p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
                  Live product preview
                </p>
                <h1 className="mt-2 max-w-2xl text-4xl font-black leading-[0.95] tracking-normal sm:text-6xl">
                  Build the pillow before it exists.
                </h1>
              </div>
              <div className="rounded-lg border border-line bg-black px-4 py-3 text-sm">
                <p className="text-muted">Base price</p>
                <p className="text-2xl font-black">
                  {formatMoney(PRODUCT_PRICE_CENTS, PRODUCT_CURRENCY)}
                </p>
              </div>
            </div>

            <PillowPreview
              activeSide={activeSide}
              activeMockupId={activeMockupId}
              design={design}
              mockupPreviews={mockupPreviews}
              onSelectMockup={setActiveMockupId}
            />

            <p className="mt-3 text-sm text-muted">
              {mockupStatus === "ready"
                ? `${mockupPreviews.length} real scene previews rendered from the mockup service.`
                : mockupStatus === "rendering"
                  ? "Rendering real scene preview..."
                  : mockupStatus === "failed"
                    ? "Mockup service is not available. Showing layout preview."
                    : "Upload or open a generated link to render the scene preview."}
            </p>
          </div>

          <aside className="hidden rounded-lg border border-line bg-black/70 p-5 lg:block">
            <div>
              <p className="text-sm font-bold">Debug proof</p>
              <p className="mt-2 text-sm text-muted">
                Open a generated link or upload a replacement photo. The
                visible editor no longer exposes product options.
              </p>
            </div>

            <div className="mt-6 space-y-3 border-t border-line pt-6 text-sm text-muted">
              <p>Source: {design.sides.front.imagePreviewUrl ? "ready" : "missing"}</p>
              <p>
                We save a local proof and mirror Temu order data when it is
                available.
              </p>
            </div>
            <DebugLinks />
          </aside>
        </div>

        <div className="-mx-4 border-t border-line bg-background/95 px-4 py-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:rounded-lg lg:border lg:bg-panel/85 lg:p-5">
          <ContentControls chooseImage={chooseImage} design={design} />

          <div className="mt-4 lg:hidden">
            <DebugLinks />
          </div>

          {error ? (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              {authEnabled
                ? "Preview first. Sign in and enter an eligible address only when you are ready to order."
                : "Local debug mode skips sign-in, validates the delivery area, and creates a browser-only mock order."}
            </p>
            <button
              className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={checkout}
              type="button"
            >
              {isPending
                ? "Continuing..."
                : authEnabled && !isAuthenticated
                  ? "Sign in to order"
                  : "Continue to address"}
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
          onConfirm={confirmMockOrder}
        />
      ) : null}
    </main>
  );
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
                : "border-line bg-black text-muted hover:text-foreground",
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
          <div className="rounded-lg border border-line bg-black px-3 py-2 text-sm text-muted">
            {side.imagePreviewUrl
              ? "Photo loaded. Use the upload button to replace it."
              : "Upload a photo or open a debug link with an image parameter."}
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 px-4 py-6 backdrop-blur">
      <section className="w-full max-w-3xl rounded-lg border border-line bg-panel p-4 shadow-2xl shadow-black/50 sm:p-5">
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
            className="focus-ring grid size-10 place-items-center rounded-lg border border-line bg-black text-muted transition hover:text-foreground"
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_230px]">
          <div
            className={cn(
              "relative cursor-grab touch-none select-none overflow-hidden border border-line bg-black active:cursor-grabbing",
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
            <div className="rounded-lg border border-line bg-black p-3 text-sm">
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
              <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {cropError}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line bg-black px-3 text-sm font-bold text-foreground transition hover:bg-white/10"
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
                {isProcessing ? <Crop size={16} /> : <Check size={16} />}
                Use photo
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
  mockupPreviews,
  onSelectMockup,
}: {
  activeSide: ProductSide;
  activeMockupId: string | null;
  design: DesignPayload;
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
        <div className="relative grid min-h-[420px] place-items-center overflow-hidden rounded-lg border border-line bg-black sm:min-h-[540px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={`Rendered pillow preview: ${activeMockup.label}`}
            className="h-full max-h-[620px] w-full object-contain"
            src={activeMockup.url}
          />
        </div>
        <div
          aria-label="Pillow preview scenes"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {mockupPreviews.map((preview) => (
            <button
              aria-pressed={preview.id === activeMockup.id}
              className={cn(
                "focus-ring grid min-w-0 gap-2 rounded-lg border bg-black p-2 text-left transition",
                preview.id === activeMockup.id
                  ? "border-accent text-foreground"
                  : "border-line text-muted hover:border-white/35 hover:text-foreground",
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
    <div className="relative grid min-h-[420px] place-items-center overflow-hidden rounded-lg border border-line bg-black sm:min-h-[540px]">
      <div className="absolute inset-0 opacity-50">
        <div className="absolute left-8 top-10 h-40 w-40 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute bottom-6 right-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
      </div>
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
    return design?.selection?.productSlug === "custom-pillow" ? design : null;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function readStoredAddress() {
  try {
    const value = window.localStorage.getItem(ADDRESS_STORAGE_KEY);
    return value ? (JSON.parse(value) as ShippingAddress) : EMPTY_ADDRESS;
  } catch {
    window.localStorage.removeItem(ADDRESS_STORAGE_KEY);
    return EMPTY_ADDRESS;
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

function DebugLinks() {
  const examples = [
    {
      label: "Debug link A",
      href: "/design?image=/debug/pillow-sample.png&position=full_panel&shape=rectangle",
    },
    {
      label: "Debug link B",
      href: "/design?image=/debug/pillow-sample.png&position=center_panel&shape=circle",
    },
    {
      label: "Debug link C",
      href: "/design?image=/debug/pillow-sample.png&position=top_banner&shape=rectangle",
    },
  ];

  return (
    <div className="mt-6 border-t border-line pt-6">
      <p className="mb-3 text-sm font-black">Debug links</p>
      <div className="space-y-2">
        {examples.map((example) => (
          <a
            className="focus-ring block rounded-lg border border-line bg-white/5 px-3 py-2 text-sm font-bold text-foreground transition hover:border-accent"
            href={example.href}
            key={example.href}
          >
            {example.label}
          </a>
        ))}
      </div>
    </div>
  );
}
