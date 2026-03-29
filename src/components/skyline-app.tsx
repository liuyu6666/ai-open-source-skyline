"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useMemo, useState } from "react";

import { SkylineScene } from "@/components/skyline-scene";
import {
  formatGeneratedAt,
  formatHoursAgo,
  formatNumber,
  formatRelativeDays,
  getSiteCopy,
  type SupportedLocale,
} from "@/lib/site-copy";
import type { SkylineSnapshot } from "@/lib/skyline-data";

type SkylineAppProps = {
  initialSnapshot: SkylineSnapshot;
  locale: SupportedLocale;
};

type SkyPalette = {
  backdrop: string;
  panel: string;
  panelSoft: string;
  horizon: string;
  ambient: number;
  fog: string;
  ground: string;
  street: string;
  districtEdge: string;
  text: string;
  muted: string;
  dayFactor: number;
  isNight: boolean;
  phaseLabel: string;
};

function getSkyPalette(now: Date, locale: SupportedLocale): SkyPalette {
  const copy = getSiteCopy(locale);
  const hour = now.getHours() + now.getMinutes() / 60;
  const dayFactor = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const isNight = dayFactor < 0.2;

  if (dayFactor > 0.8) {
    return {
      backdrop:
        "radial-gradient(circle at 18% 14%, rgba(255,239,191,0.26), transparent 26%), radial-gradient(circle at 78% 16%, rgba(170,215,255,0.22), transparent 28%), linear-gradient(180deg, #9bc8ff 0%, #598fd1 34%, #183456 100%)",
      panel: "rgba(7, 18, 33, 0.66)",
      panelSoft: "rgba(7, 18, 33, 0.44)",
      horizon: "#ffd587",
      ambient: 1.08,
      fog: "#5d8dc7",
      ground: "#102238",
      street: "#0b1220",
      districtEdge: "#7aa3d1",
      text: "#f8fbff",
      muted: "rgba(227, 237, 248, 0.78)",
      dayFactor,
      isNight,
      phaseLabel: copy.phase.day,
    };
  }

  if (dayFactor > 0.28) {
    return {
      backdrop:
        "radial-gradient(circle at 50% 12%, rgba(255,195,130,0.18), transparent 23%), linear-gradient(180deg, #647ea8 0%, #25354f 42%, #111b2c 100%)",
      panel: "rgba(7, 13, 23, 0.7)",
      panelSoft: "rgba(8, 14, 24, 0.48)",
      horizon: "#ffb972",
      ambient: 0.84,
      fog: "#334862",
      ground: "#0a1522",
      street: "#09111d",
      districtEdge: "#546d86",
      text: "#f8fbff",
      muted: "rgba(223, 232, 242, 0.76)",
      dayFactor,
      isNight,
      phaseLabel: copy.phase.dusk,
    };
  }

  return {
    backdrop:
      "radial-gradient(circle at 16% 12%, rgba(107,151,255,0.13), transparent 24%), radial-gradient(circle at 82% 18%, rgba(129,112,255,0.16), transparent 26%), linear-gradient(180deg, #040914 0%, #0b1320 44%, #14233a 100%)",
    panel: "rgba(5, 9, 18, 0.76)",
    panelSoft: "rgba(8, 11, 20, 0.56)",
    horizon: "#7dd3fc",
    ambient: 0.42,
    fog: "#0f1724",
    ground: "#040913",
    street: "#070d18",
    districtEdge: "#263a52",
    text: "#f8fbff",
    muted: "rgba(200, 214, 232, 0.78)",
    dayFactor,
    isNight,
    phaseLabel: copy.phase.night,
  };
}

function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="glass stat-tile">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const peak = Math.max(...points, 1);

  return (
    <div className="sparkline" aria-hidden="true">
      {points.map((value, index) => (
        <span
          key={`${value}-${index}`}
          style={{ height: `${Math.max(16, (value / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function SkylineApp({ initialSnapshot, locale }: SkylineAppProps) {
  const copy = getSiteCopy(locale);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date(initialSnapshot.generatedAt));
  const [isMounted, setIsMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localTimeZone, setLocalTimeZone] = useState(copy.browserTimeFallback);
  const palette = getSkyPalette(now, locale);

  const topMover = useMemo(
    () => [...snapshot.repos].sort((a, b) => b.starDelta7d - a.starDelta7d)[0],
    [snapshot.repos],
  );
  const newestRepo = useMemo(
    () => [...snapshot.repos].sort((a, b) => a.createdDaysAgo - b.createdDaysAgo)[0],
    [snapshot.repos],
  );
  const selectedRepo =
    selectedId === null ? null : snapshot.repos.find((repo) => repo.id === selectedId) ?? null;
  const districts = useMemo(
    () =>
      snapshot.districts.map((district) => ({
        ...district,
        label: copy.domainLabels[district.id],
      })),
    [copy.domainLabels, snapshot.districts],
  );

  const tickClock = useEffectEvent(() => {
    setNow(new Date());
  });

  useEffect(() => {
    setIsMounted(true);
    setNow(new Date());
    setLocalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => tickClock(), 60_000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--page-backdrop", palette.backdrop);
    document.documentElement.style.setProperty("--panel-bg", palette.panel);
    document.documentElement.style.setProperty("--panel-soft", palette.panelSoft);
    document.documentElement.style.setProperty("--panel-border", `${palette.horizon}35`);
    document.documentElement.style.setProperty("--text-main", palette.text);
    document.documentElement.style.setProperty("--text-muted", palette.muted);
    document.documentElement.style.setProperty("--accent-color", palette.horizon);
  }, [palette]);

  const refreshSnapshot = async () => {
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/skyline", { cache: "no-store" });
      const nextSnapshot = (await response.json()) as SkylineSnapshot;

      startTransition(() => {
        setSnapshot(nextSnapshot);

        if (selectedId && !nextSnapshot.repos.some((repo) => repo.id === selectedId)) {
          setSelectedId(null);
        }
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="skyline-backdrop">
        <SkylineScene
          districts={districts}
          onClearSelection={() => setSelectedId(null)}
          onSelect={setSelectedId}
          palette={palette}
          repos={snapshot.repos}
          selectedId={selectedId}
        />
      </div>

      <div className="hud">
        <section className="top-hud">
          <div className="brand-panel">
            <span className="eyebrow">{copy.brand}</span>
            <h1>{copy.title}</h1>
            <p>{snapshot.demoMode ? copy.demoSubtitle : copy.liveSubtitle}</p>
          </div>

          <div className="top-rail">
            <div className="top-actions">
              <button className="action-button" disabled={isRefreshing} onClick={refreshSnapshot} type="button">
                {isRefreshing ? copy.refreshing : copy.refresh}
              </button>
              <Link className="ghost-link" href={copy.switchHref}>
                {copy.switchLabel}
              </Link>
              <div className="clock-pill">
                <span>{palette.phaseLabel}</span>
                <strong suppressHydrationWarning>
                  {isMounted
                    ? now.toLocaleTimeString(copy.timeLocale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "--:--"}
                </strong>
                <small suppressHydrationWarning>{localTimeZone}</small>
              </div>
            </div>

            <section className="global-grid">
              <StatTile
                label={copy.stats.tracked.label}
                note={copy.stats.tracked.note}
                value={formatNumber(snapshot.stats.trackedRepos, locale)}
              />
              <StatTile
                label={copy.stats.newborn.label}
                note={copy.stats.newborn.note}
                value={formatNumber(snapshot.stats.newRepos24h, locale)}
              />
              <StatTile
                label={copy.stats.stars.label}
                note={copy.stats.stars.note}
                value={`+${formatNumber(snapshot.stats.starsAdded7d, locale)}`}
              />
              <StatTile
                label={copy.stats.updates.label}
                note={copy.stats.updates.note}
                value={formatNumber(snapshot.stats.updates7d, locale)}
              />
              <StatTile
                label={copy.stats.momentum.label}
                note={
                  topMover ? `+${formatNumber(topMover.starDelta7d, locale)} / 7d` : copy.emptyValue
                }
                value={topMover?.name ?? copy.emptyValue}
              />
              <StatTile
                label={copy.stats.newestRepo.label}
                note={
                  newestRepo ? formatRelativeDays(newestRepo.createdDaysAgo, locale) : copy.emptyValue
                }
                value={newestRepo?.name ?? copy.emptyValue}
              />
            </section>
          </div>
        </section>

        <div className="glass scene-note">
          <span>{copy.sceneLegend.height}</span>
          <span>{copy.sceneLegend.lights}</span>
          <span>{copy.sceneLegend.interaction}</span>
        </div>
      </div>

      {selectedRepo ? (
        <aside className="glass detail-drawer">
          <div className="drawer-head">
            <div>
              <span className="eyebrow">{copy.drawer.repoDetail}</span>
              <h2>{selectedRepo.name}</h2>
              <small>{selectedRepo.fullName}</small>
            </div>

            <button className="drawer-close" onClick={() => setSelectedId(null)} type="button">
              {copy.drawer.close}
            </button>
          </div>

          <p className="detail-copy">{selectedRepo.description[locale]}</p>

          <div className="meta-pills">
            <span>{copy.domainLabels[selectedRepo.domain]}</span>
            <span>{snapshot.demoMode ? copy.drawer.demo : copy.drawer.live}</span>
            <span>{formatGeneratedAt(snapshot.generatedAt, locale)}</span>
          </div>

          <div className="detail-grid">
            <div className="metric-box">
              <span>{copy.drawer.totalStars}</span>
              <strong>{formatNumber(selectedRepo.totalStars, locale)}</strong>
            </div>
            <div className="metric-box">
              <span>{copy.drawer.starDelta7d}</span>
              <strong>+{formatNumber(selectedRepo.starDelta7d, locale)}</strong>
            </div>
            <div className="metric-box">
              <span>{copy.drawer.updateEvents}</span>
              <strong>{formatNumber(selectedRepo.updateEvents7d, locale)}</strong>
            </div>
            <div className="metric-box">
              <span>{copy.drawer.contributors}</span>
              <strong>{formatNumber(selectedRepo.contributors30d, locale)}</strong>
            </div>
          </div>

          <div className="signal-panel">
            <div>
              <span className="eyebrow">{copy.drawer.dailyPulse}</span>
              <Sparkline points={selectedRepo.trend} />
            </div>

            <div className="signal-copy">
              <span>{copy.drawer.created}</span>
              <strong>{formatRelativeDays(selectedRepo.createdDaysAgo, locale)}</strong>
              <span>{copy.drawer.lastPush}</span>
              <strong>{formatHoursAgo(selectedRepo.lastPushHoursAgo, locale)}</strong>
              <span>{copy.drawer.mixedScore}</span>
              <strong>{selectedRepo.score.toFixed(1)}</strong>
            </div>
          </div>
        </aside>
      ) : (
        <aside className="glass detail-hint">
          <span className="eyebrow">{copy.drawer.repoDetail}</span>
          <strong>{copy.drawer.emptyTitle}</strong>
          <p>{copy.drawer.emptyBody}</p>
        </aside>
      )}
    </main>
  );
}
