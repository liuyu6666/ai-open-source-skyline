import { notFound } from "next/navigation";

import { SkylineApp } from "@/components/skyline-app";
import { getSiteCopy, isSupportedLocale } from "@/lib/site-copy";
import { getSkylineSnapshot } from "@/lib/skyline-data";

type LocalePageProps = {
  params: Promise<{
    locale: string;
  }>;
};

export function generateStaticParams() {
  return [{ locale: "zh" }, { locale: "en" }];
}

export const dynamic = "force-dynamic";

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  getSiteCopy(locale);

  return <SkylineApp initialSnapshot={await getSkylineSnapshot()} locale={locale} />;
}
