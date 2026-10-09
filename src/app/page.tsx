import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ImageUp, PackageCheck, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const authCode = firstParam(params.code);
  const tokenHash = firstParam(params.token_hash);
  if (authCode || tokenHash) {
    const callbackParams = new URLSearchParams();
    if (authCode) callbackParams.set("code", authCode);
    if (tokenHash) callbackParams.set("token_hash", tokenHash);
    const authType = firstParam(params.type);
    const nextPath = firstParam(params.next);
    if (authType) callbackParams.set("type", authType);
    if (nextPath) callbackParams.set("next", nextPath);
    redirect(`/auth/callback?${callbackParams.toString()}`);
  }

  const image = firstParam(params.image ?? params.imageUrl ?? params.img);

  if (image) {
    const designParams = new URLSearchParams({ image });
    const shape = firstParam(params.shape);
    const position = firstParam(params.position);
    const checkout = firstParam(params.checkout);
    if (shape) designParams.set("shape", shape);
    if (position) designParams.set("position", position);
    if (checkout === "1") designParams.set("checkout", "1");
    redirect(`/design?${designParams.toString()}`);
  }

  return (
    <AppShell>
      <main>
        <section className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:py-16">
          <div className="max-w-xl">
            <p className="text-sm font-bold text-accent">Custom pillow covers, made from your photo</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.98] tracking-[-0.045em] sm:text-6xl">
              Turn one photo into a pillow you can preview first.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-muted">
              Upload, crop, review four real-room previews, then order your set of two covers.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-accent px-6 font-bold text-accent-ink shadow-lg shadow-teal-900/15 transition hover:bg-accent-strong active:translate-y-px"
                href="/products"
              >
                Upload your photo <ArrowRight size={18} />
              </Link>
              <Link
                className="focus-ring inline-flex h-12 items-center justify-center rounded-lg border border-line bg-panel px-6 font-bold text-foreground transition hover:bg-surface active:translate-y-px"
                href="/design?image=%2Fdesign-samples%2Fpastel-color-pattern.jpg"
              >
                Try a sample
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-accent-soft/70 blur-2xl" />
            <div className="overflow-hidden rounded-2xl border border-line bg-panel p-3 shadow-[0_28px_80px_rgba(23,33,31,0.12)]">
              <Image
                alt="Custom floral pillow displayed on a wooden chair"
                className="aspect-[4/3] w-full rounded-xl object-cover"
                height={1254}
                priority
                sizes="(min-width: 1024px) 56vw, 100vw"
                src="/showcase/wood-chair.webp"
                width={1254}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1 pt-4 text-sm">
                <span className="font-bold">Your image, shown in a real setting</span>
                <span className="text-muted">Set of 2 · 18in / 45cm</span>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-panel">
          <div className="mx-auto grid w-full max-w-7xl gap-0 px-4 sm:px-6 md:grid-cols-3">
            <WorkflowItem
              icon={<ImageUp size={21} />}
              text="Choose a photo from your device."
              title="Upload"
            />
            <WorkflowItem
              icon={<ShieldCheck size={21} />}
              text="Crop it and compare four room views."
              title="Preview"
            />
            <WorkflowItem
              icon={<PackageCheck size={22} />}
              text="Enter delivery details and pay securely."
              title="Order"
            />
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl items-center gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
          <Image
            alt="Floral pillow close-up on a grey sofa"
            className="aspect-[4/3] w-full rounded-2xl border border-line object-cover shadow-[0_20px_60px_rgba(23,33,31,0.1)]"
            height={1254}
            sizes="(min-width: 1024px) 50vw, 100vw"
            src="/showcase/grey-sofa.webp"
            width={1254}
          />
          <div className="lg:pl-8">
            <h2 className="text-4xl font-black tracking-[-0.035em] sm:text-5xl">
              See the result before you buy.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted">
              Your production file stays clean while the previews show realistic folds, lighting, and scale.
            </p>
            <Link
              className="focus-ring mt-7 inline-flex items-center gap-2 font-bold text-accent hover:text-accent-strong"
              href="/products"
            >
              Create your preview <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function WorkflowItem({
  icon,
  text,
  title,
}: {
  icon: React.ReactNode;
  text: string;
  title: string;
}) {
  return (
    <div className="flex gap-4 border-line py-7 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0 md:last:pr-0">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <div>
        <h2 className="font-black">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{text}</p>
      </div>
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
