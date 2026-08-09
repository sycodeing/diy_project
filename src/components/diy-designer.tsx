"use client";

import { ChangeEvent, useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowRight,
  BadgeDollarSign,
  Circle,
  ImageUp,
  Package,
  RectangleHorizontal,
  Type,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  COLOR_OPTIONS,
  DEFAULT_DESIGN,
  POSITION_OPTIONS,
  PRODUCT_CURRENCY,
  PRODUCT_PRICE_CENTS,
  SHAPE_OPTIONS,
  SIZE_OPTIONS,
  STYLE_OPTIONS,
  getColorHex,
  getOptionLabel,
} from "@/lib/product-config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { DesignPayload, ProductSide } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

const STORAGE_KEY = "studio-blank-design";

type PendingFiles = Partial<Record<ProductSide, File>>;

export function DiyDesigner() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<"material" | "content">(
    "material",
  );
  const [activeSide, setActiveSide] = useState<ProductSide>("front");
  const [design, setDesign] = useState<DesignPayload>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_DESIGN;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_DESIGN;
    }

    try {
      const restored = JSON.parse(raw) as DesignPayload;
      return restored.selection?.productSlug === "custom-pillow"
        ? restored
        : DEFAULT_DESIGN;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return DEFAULT_DESIGN;
    }
  });
  const [pendingFiles, setPendingFiles] = useState<PendingFiles>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(design, (key, value) =>
        key === "imagePreviewUrl" ? undefined : value,
      ),
    );
  }, [design]);

  const selectedColor = useMemo(
    () => COLOR_OPTIONS.find((item) => item.value === design.selection.color),
    [design.selection.color],
  );

  function updateSelection(key: "color" | "style" | "size", value: string) {
    setDesign((current) => ({
      ...current,
      selection: {
        ...current.selection,
        [key]: value,
      },
    }));
  }

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

  function chooseImage(side: ProductSide, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const preview = URL.createObjectURL(file);
    setPendingFiles((current) => ({ ...current, [side]: file }));
    updateSide(side, {
      kind: "image",
      imagePreviewUrl: preview,
      imagePath: undefined,
    });
  }

  async function uploadPendingImages(current: DesignPayload) {
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      throw new Error("Missing Supabase environment variables.");
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      router.push("/auth?next=/");
      return null;
    }

    const draftId = crypto.randomUUID();
    const uploaded = JSON.parse(JSON.stringify(current)) as DesignPayload;

    for (const side of ["front", "back"] as const) {
      const file = pendingFiles[side];

      if (!file) {
        continue;
      }

      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
      const path = `${user.id}/${draftId}/${side}-${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("design-assets")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      uploaded.sides[side].imagePath = path;
      delete uploaded.sides[side].imagePreviewUrl;
    }

    return uploaded;
  }

  function checkout() {
    setError(null);
    startTransition(async () => {
      try {
        const uploadedDesign = await uploadPendingImages(design);

        if (!uploadedDesign) {
          return;
        }

        const response = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(uploadedDesign),
        });

        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };

        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Could not create checkout.");
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

            <PillowPreview design={design} activeSide={activeSide} />
          </div>

          <aside className="hidden rounded-lg border border-line bg-black/70 p-5 lg:block">
            <div className="flex items-center gap-3">
              <span
                className="size-10 rounded-lg border border-line"
                style={{ backgroundColor: selectedColor?.hex }}
              />
              <div>
                <p className="text-sm font-bold">Selected blank</p>
                <p className="text-sm text-muted">
                  {selectedColor?.label},{" "}
                  {getOptionLabel(STYLE_OPTIONS, design.selection.style)},{" "}
                  {design.selection.size}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3 border-t border-line pt-6 text-sm text-muted">
              <p>Front: {describeSide(design.sides.front)}</p>
              <p>Back: {describeSide(design.sides.back)}</p>
              <p>
                We save a local proof and mirror Temu order data when it is
                available.
              </p>
            </div>
          </aside>
        </div>

        <div className="sticky bottom-0 z-30 -mx-4 border-t border-line bg-background/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:rounded-lg lg:border lg:bg-panel/85 lg:p-5">
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-line bg-black p-1">
            <StepButton
              active={activeStep === "material"}
              icon={<Package size={17} />}
              label="1. Material"
              onClick={() => setActiveStep("material")}
            />
            <StepButton
              active={activeStep === "content"}
              icon={<Type size={17} />}
              label="2. DIY content"
              onClick={() => setActiveStep("content")}
            />
          </div>

          {activeStep === "material" ? (
            <MaterialControls design={design} updateSelection={updateSelection} />
          ) : (
            <ContentControls
              activeSide={activeSide}
              chooseImage={chooseImage}
              design={design}
              setActiveSide={setActiveSide}
              updateSide={updateSide}
            />
          )}

          {error ? (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              Front and back are saved separately. Each side uses one content
              type.
            </p>
            <button
              className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-5 font-black text-accent-ink transition hover:bg-foreground active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending}
              onClick={checkout}
              type="button"
            >
              {isPending ? "Preparing checkout..." : "Order this design"}
              <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function StepButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-black transition active:translate-y-px",
        active
          ? "bg-foreground text-background"
          : "text-muted hover:bg-white/5 hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function MaterialControls({
  design,
  updateSelection,
}: {
  design: DesignPayload;
  updateSelection: (key: "color" | "style" | "size", value: string) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ControlGroup title="Color">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
          {COLOR_OPTIONS.map((color) => (
            <button
              className={cn(
                "focus-ring flex h-12 items-center gap-2 rounded-lg border px-3 text-left text-sm font-bold transition active:translate-y-px",
                design.selection.color === color.value
                  ? "border-accent bg-accent/10 text-foreground"
                  : "border-line bg-black text-muted hover:text-foreground",
              )}
              key={color.value}
              onClick={() => updateSelection("color", color.value)}
              type="button"
            >
              <span
                className="size-5 rounded-full border border-line"
                style={{ backgroundColor: color.hex }}
              />
              {color.label}
            </button>
          ))}
        </div>
      </ControlGroup>

      <ControlGroup title="Style">
        <div className="grid gap-2">
          {STYLE_OPTIONS.map((style) => (
            <ChoiceButton
              active={design.selection.style === style.value}
              key={style.value}
              label={style.label}
              onClick={() => updateSelection("style", style.value)}
            />
          ))}
        </div>
      </ControlGroup>

      <ControlGroup title="Size">
        <div className="grid grid-cols-3 gap-2">
          {SIZE_OPTIONS.map((size) => (
            <ChoiceButton
              active={design.selection.size === size}
              key={size}
              label={size}
              onClick={() => updateSelection("size", size)}
            />
          ))}
        </div>
      </ControlGroup>
    </div>
  );
}

function ContentControls({
  activeSide,
  chooseImage,
  design,
  setActiveSide,
  updateSide,
}: {
  activeSide: ProductSide;
  chooseImage: (side: ProductSide, event: ChangeEvent<HTMLInputElement>) => void;
  design: DesignPayload;
  setActiveSide: (side: ProductSide) => void;
  updateSide: (
    side: ProductSide,
    patch: Partial<DesignPayload["sides"][ProductSide]>,
  ) => void;
}) {
  const side = design.sides[activeSide];
  const validPositions = POSITION_OPTIONS.filter((position) =>
    position.sides.includes(activeSide),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
      <ControlGroup title="Side">
        <div className="grid grid-cols-2 gap-2">
          {(["front", "back"] as const).map((item) => (
            <ChoiceButton
              active={activeSide === item}
              key={item}
              label={item === "front" ? "Front" : "Back"}
              onClick={() => setActiveSide(item)}
            />
          ))}
        </div>
      </ControlGroup>

      <ControlGroup title="Content">
        <div className="grid gap-3 sm:grid-cols-3">
          <ChoiceButton
            active={side.kind === "none"}
            label="Blank"
            onClick={() => updateSide(activeSide, { kind: "none" })}
          />
          <ChoiceButton
            active={side.kind === "text"}
            icon={<Type size={16} />}
            label="Text"
            onClick={() => updateSide(activeSide, { kind: "text" })}
          />
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
              onChange={(event) => chooseImage(activeSide, event)}
              type="file"
            />
          </label>
        </div>

        {side.kind === "text" ? (
          <input
            className="focus-ring mt-3 h-12 w-full rounded-lg border border-line bg-black px-3 text-foreground placeholder:text-stone-600"
            maxLength={32}
            onChange={(event) =>
              updateSide(activeSide, { text: event.target.value })
            }
            placeholder="Type the print text"
            value={side.text ?? ""}
          />
        ) : null}
      </ControlGroup>

      <ControlGroup title="Shape and position">
        <div className="grid grid-cols-2 gap-2">
          {SHAPE_OPTIONS.map((shape) => (
            <ChoiceButton
              active={side.shape === shape.value}
              icon={
                shape.value === "circle" ? (
                  <Circle size={15} />
                ) : (
                  <RectangleHorizontal size={15} />
                )
              }
              key={shape.value}
              label={shape.label}
              onClick={() => updateSide(activeSide, { shape: shape.value })}
            />
          ))}
        </div>
        <div className="mt-2 grid gap-2">
          {validPositions.map((position) => (
            <ChoiceButton
              active={side.position === position.value}
              key={position.value}
              label={position.label}
              onClick={() =>
                updateSide(activeSide, { position: position.value })
              }
            />
          ))}
        </div>
      </ControlGroup>
    </div>
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

function ChoiceButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition active:translate-y-px",
        active
          ? "border-accent bg-accent/10 text-foreground"
          : "border-line bg-black text-muted hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function PillowPreview({
  activeSide,
  design,
}: {
  activeSide: ProductSide;
  design: DesignPayload;
}) {
  const color = getColorHex(design.selection.color);
  const side = design.sides[activeSide];

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
          <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded bg-black px-2 py-1 text-xs font-black">
            {design.selection.size}
          </span>
        </div>
        <div className="absolute bottom-[16%] right-2 top-[16%] w-0.5 bg-foreground/90">
          <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-l-2 border-t-2 border-foreground" />
          <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-foreground" />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 rotate-90 rounded bg-black px-2 py-1 text-xs font-black">
            {design.selection.size}
          </span>
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
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between rounded-lg border border-line bg-background/70 px-3 py-2 text-sm backdrop-blur">
        <span className="text-muted">
          {getOptionLabel(COLOR_OPTIONS, design.selection.color)}
        </span>
        <span className="inline-flex items-center gap-2 font-bold">
          <BadgeDollarSign size={16} />
          {formatMoney(PRODUCT_PRICE_CENTS, PRODUCT_CURRENCY)}
        </span>
      </div>
    </div>
  );
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
          <span>Image</span>
        )
      ) : (
        <span>{sideDesign.text || "Text"}</span>
      )}
    </div>
  );
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

function describeSide(side: DesignPayload["sides"][ProductSide]) {
  if (side.kind === "none") {
    return "blank";
  }

  return `${side.kind}, ${side.shape}, ${side.position.replaceAll("_", " ")}`;
}
