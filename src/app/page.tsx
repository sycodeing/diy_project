import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ImageUp, PackageCheck, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const image = firstParam(params.image ?? params.imageUrl ?? params.img);

  if (image) {
    const designParams = new URLSearchParams({ image });
    const shape = firstParam(params.shape);
    const position = firstParam(params.position);
    if (shape) designParams.set("shape", shape);
    if (position) designParams.set("position", position);
    redirect(`/design?${designParams.toString()}`);
  }

  return (
    <AppShell>
      <main>
        <section className="relative min-h-[72dvh] overflow-hidden border-b border-line">
          <Image
            alt="Custom floral pillow on a wooden chair"
            className="object-cover object-center"
            fill
            priority
            sizes="100vw"
            src="/showcase/wood-chair.webp"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-black/10" />
          <div className="relative mx-auto flex min-h-[72dvh] w-full max-w-7xl items-end px-4 pb-12 pt-28 sm:px-6 sm:pb-16">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
                Photo-to-product studio
              </p>
              <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-normal sm:text-7xl">
                Custom Pillow Studio
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-stone-200 sm:text-lg">
                Open a generated link or upload your own image. We crop it for
                a set of two 18in / 45cm pillow covers and render four real-scene
                previews before you order. Inserts are not included.
              </p>
              <Link
                className="focus-ring mt-7 inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-5 font-black text-accent-ink transition hover:bg-foreground"
                href="/design"
              >
                Start designing <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </section>

        <section className="border-b border-line bg-panel/55">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-3">
            <WorkflowItem
              icon={<Sparkles size={22} />}
              index="01"
              text="A link can carry an image into the editor and immediately start the first preview."
              title="Open the design"
            />
            <WorkflowItem
              icon={<ImageUp size={22} />}
              index="02"
              text="Replace it with your own photo, drag and zoom the square crop, then compare four scenes."
              title="Make it yours"
            />
            <WorkflowItem
              icon={<PackageCheck size={22} />}
              index="03"
              text="Sign in only when you are ready, confirm the delivery address, and complete secure payment."
              title="Confirm the order"
            />
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-12 sm:px-6 lg:grid-cols-2">
          <Image
            alt="Floral pillow close-up on a grey sofa"
            className="aspect-square w-full rounded-lg border border-line object-cover"
            height={1254}
            sizes="(min-width: 1024px) 50vw, 100vw"
            src="/showcase/grey-sofa.webp"
            width={1254}
          />
          <div className="flex flex-col justify-center py-6 lg:px-10">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-accent">
              Preview before production
            </p>
            <h2 className="mt-3 text-4xl font-black tracking-normal sm:text-5xl">
              One image. Four useful views.
            </h2>
            <p className="mt-5 max-w-xl leading-7 text-muted">
              The scene previews preserve the pillow shape, folds, lighting and
              foreground occlusion. Your factory file remains the clean square
              artwork rather than the lifestyle mockup.
            </p>
            <Link
              className="focus-ring mt-7 inline-flex items-center gap-2 font-black text-foreground hover:text-accent"
              href="/design?image=/debug/pillow-sample.png"
            >
              Try the sample image <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function WorkflowItem({
  icon,
  index,
  text,
  title,
}: {
  icon: React.ReactNode;
  index: string;
  text: string;
  title: string;
}) {
  return (
    <div className="border-t border-line pt-5">
      <div className="flex items-center justify-between text-accent">
        {icon}
        <span className="font-mono text-xs">{index}</span>
      </div>
      <h2 className="mt-5 text-2xl font-black">{title}</h2>
      <p className="mt-3 leading-7 text-muted">{text}</p>
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
