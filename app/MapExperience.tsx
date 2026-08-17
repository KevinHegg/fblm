"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CountRecord = { year: number; county: string; fips: string; count: number };
type Person = { name: string; url: string; chamber: string };
type NameRecord = CountRecord & { people: Person[] };
type CountsData = { years: number[]; totals: Record<string, number>; records: CountRecord[] };
type NamesData = { records: NameRecord[] };
type SortMode = "name" | "county";
type CountyProperties = {
  GEOID: string;
  BASENAME: string;
  INTPTLAT: string;
  INTPTLON: string;
};
type CountyCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, CountyProperties>;

const COMPANION_URL = "https://much-ado.net/legislators/";
const MISSISSIPPI_BOUNDS: [[number, number], [number, number]] = [[-91.85, 29.72], [-87.95, 35.15]];
const PLAY_HINT_KEY = "fblm-play-hint-dismissed";

function wasPlayHintDismissed() {
  try { if (window.localStorage.getItem(PLAY_HINT_KEY) === "1") return true; }
  catch { /* Continue to the cookie fallback. */ }
  try { return document.cookie.split("; ").includes(`${PLAY_HINT_KEY}=1`); }
  catch { return false; }
}

function rememberPlayHintDismissal() {
  try { window.localStorage.setItem(PLAY_HINT_KEY, "1"); }
  catch { /* Continue to the cookie fallback. */ }
  try { document.cookie = `${PLAY_HINT_KEY}=1; Max-Age=31536000; Path=/; SameSite=Lax`; }
  catch { /* Storage may be unavailable in privacy-restricted iframes. */ }
}

function surnameFirst(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const suffixes = new Set(["Jr.", "Sr.", "II", "III", "IV"]);
  const suffix = suffixes.has(parts.at(-1) ?? "") ? parts.pop() : undefined;
  const surname = parts.pop();
  return `${surname}, ${parts.join(" ")}${suffix ? `, ${suffix}` : ""}`;
}

function TransportIcon({ kind }: { kind: "first" | "previous" | "play" | "pause" | "next" | "last" }) {
  const previous = kind === "first" || kind === "previous";
  const endpoint = kind === "first" || kind === "last";
  if (kind === "play") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 6.4 14 10l-6 3.6Z" /></svg>;
  }
  if (kind === "pause") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 6h2.2v8H7zm3.8 0H13v8h-2.2z" /></svg>;
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {endpoint && <path d={previous ? "M4 4h1.6v12H4z" : "M14.4 4H16v12h-1.6z"} />}
      <path d={previous ? "m13.8 4.8-7 5.2 7 5.2" : "m6.2 4.8 7 5.2-7 5.2"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function detectAssetBase() {
  if (typeof window === "undefined") return "";
  return window.location.pathname === "/fblm" || window.location.pathname.startsWith("/fblm/")
    ? "/fblm"
    : "";
}

export function MapExperience() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const timelineTrack = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const popupRef = useRef<import("mapbox-gl").Popup | null>(null);
  const [counts, setCounts] = useState<CountsData | null>(null);
  const [names, setNames] = useState<NamesData | null>(null);
  const [counties, setCounties] = useState<CountyCollection | null>(null);
  const [yearIndex, setYearIndex] = useState(0);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showPlayHint, setShowPlayHint] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [loadingError, setLoadingError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [timelineTrackWidth, setTimelineTrackWidth] = useState(0);

  const year = counts?.years[yearIndex] ?? 1870;
  const yearProgress = counts && counts.years.length > 1
    ? yearIndex / (counts.years.length - 1)
    : 0;
  const currentYearLeft = timelineTrackWidth > 0
    ? 8 + yearProgress * Math.max(0, timelineTrackWidth - 16)
    : 0;
  const timelineTicks = useMemo(() => {
    const years = counts?.years ?? [];
    if (years.length === 0) return [];
    if (years.length === 1) return [{ year: years[0], index: 0 }];
    const capacity = timelineTrackWidth > 0
      ? Math.max(2, Math.floor(timelineTrackWidth / 54))
      : 3;
    const tickCount = Math.min(years.length, capacity);
    const indexes = new Set<number>();
    for (let tick = 0; tick < tickCount; tick += 1) {
      indexes.add(Math.round((tick * (years.length - 1)) / (tickCount - 1)));
    }
    return [...indexes].sort((a, b) => a - b).map((index) => ({ year: years[index], index }));
  }, [counts, timelineTrackWidth]);
  const records = useMemo(
    () => counts?.records.filter((record) => record.year === year && record.count > 0) ?? [],
    [counts, year],
  );
  const nameLookup = useMemo(
    () => new Map(names?.records.map((record) => [`${record.year}|${record.fips}`, record]) ?? []),
    [names],
  );
  const selected = selectedFips
    ? records.find((record) => record.fips === selectedFips) ?? null
    : null;
  const selectedNames = selected ? nameLookup.get(`${year}|${selected.fips}`)?.people ?? [] : [];
  const activePeople = useMemo(() => {
    const people = records.flatMap((record) =>
      (nameLookup.get(`${year}|${record.fips}`)?.people ?? []).map((person) => ({
        ...person,
        county: record.county,
        year,
        displayName: surnameFirst(person.name),
      })),
    );
    return people.sort((a, b) => {
      if (sortMode === "county") {
        return a.county.localeCompare(b.county) || a.displayName.localeCompare(b.displayName);
      }
      return a.displayName.localeCompare(b.displayName) || a.county.localeCompare(b.county);
    });
  }, [records, nameLookup, sortMode, year]);

  const pointData = useCallback(
    (activeRecords: CountRecord[]): GeoJSON.FeatureCollection<GeoJSON.Point> => {
      const byFips = new Map(activeRecords.map((record) => [record.fips, record]));
      return {
        type: "FeatureCollection",
        features: (counties?.features ?? []).flatMap((county) => {
          const record = byFips.get(county.properties.GEOID);
          if (!record) return [];
          return [{
            type: "Feature" as const,
            geometry: {
              type: "Point" as const,
              coordinates: [Number(county.properties.INTPTLON), Number(county.properties.INTPTLAT)],
            },
            properties: { ...record },
          }];
        }),
      };
    },
    [counties],
  );

  useEffect(() => {
    const embedParam = new URLSearchParams(window.location.search).get("embed") === "1";
    queueMicrotask(() => {
      setEmbed(embedParam);
      setShowPlayHint(!wasPlayHintDismissed());
    });
    const base = detectAssetBase();
    Promise.all([
      fetch(`${base}/data/counts.json`).then((response) => response.json()),
      fetch(`${base}/data/legislators.json`).then((response) => response.json()),
      fetch(`${base}/data/ms-counties.geojson`).then((response) => response.json()),
    ])
      .then(([countsResult, namesResult, countiesResult]) => {
        setCounts(countsResult);
        setNames(namesResult);
        setCounties(countiesResult);
      })
      .catch(() => setLoadingError("The historical data could not be loaded."));
  }, []);

  useEffect(() => {
    const track = timelineTrack.current;
    if (!track) return;
    const updateWidth = () => setTimelineTrackWidth(track.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !counts) return;
    const lastIndex = counts.years.length - 1;
    if (yearIndex >= lastIndex) {
      queueMicrotask(() => setPlaying(false));
      return;
    }
    const timer = window.setTimeout(() => {
      setYearIndex((current) => Math.min(current + 1, lastIndex));
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [playing, counts, yearIndex]);

  useEffect(() => {
    if (!counties || !counts || !mapContainer.current || mapRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let startupAnimationFrame: number | undefined;
    let startupUntil = 0;
    let refreshMapCanvas: (() => void) | undefined;
    const refreshAfterResume = () => {
      if (document.visibilityState === "hidden") return;
      window.requestAnimationFrame(() => refreshMapCanvas?.());
    };
    const base = detectAssetBase();
    const countyData = counties;
    const countsData = counts;

    async function initializeMap() {
      try {
        const [{ default: mapboxgl }, configResponse, hydrographyResponse] = await Promise.all([
          import("mapbox-gl"),
          fetch(`${base}/${window.location.hostname === "localhost" ? "config.local.json" : "config.json"}`),
          fetch(`${base}/data/hydrography.json`),
        ]);
        const [config, hydrography] = await Promise.all([
          configResponse.json(),
          hydrographyResponse.json() as Promise<GeoJSON.FeatureCollection>,
        ]);
        if (!config.mapboxToken) throw new Error("token");
        if (cancelled || !mapContainer.current) return;
        mapboxgl.accessToken = config.mapboxToken;
        const map = new mapboxgl.Map({
          container: mapContainer.current,
          style: "mapbox://styles/mapbox/outdoors-v12",
          center: [-89.75, 32.75],
          zoom: 5.5,
          attributionControl: false,
          logoPosition: "bottom-right",
        });
        mapRef.current = map;
        refreshMapCanvas = () => {
          if (cancelled) return;
          map.resize();
          map.triggerRepaint();
        };
        const paintStartupFrames = () => {
          if (cancelled) return;
          refreshMapCanvas?.();
          if (performance.now() < startupUntil) {
            startupAnimationFrame = window.requestAnimationFrame(paintStartupFrames);
          }
        };
        resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(() => refreshMapCanvas?.()));
        resizeObserver.observe(mapContainer.current);
        window.addEventListener("pageshow", refreshAfterResume);
        document.addEventListener("visibilitychange", refreshAfterResume);
        popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 18 });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          setMapReady(true);
          setLoadingError("");
          map.addSource("counties", { type: "geojson", data: countyData });
          [
            "waterway-shadow",
            "water-shadow",
            "waterway",
            "water",
            "water-depth",
            "waterway-label",
            "water-line-label",
            "water-point-label",
          ].forEach((layerId) => {
            if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "none");
          });
          map.addLayer({
            id: "county-fill",
            type: "fill",
            source: "counties",
            paint: { "fill-color": "#f6f0e5", "fill-opacity": 0.09 },
          });
          map.addSource("fblm-hydrography", { type: "geojson", data: hydrography });
          map.addLayer({
            id: "fblm-mississippi-river",
            type: "line",
            source: "fblm-hydrography",
            paint: {
              "line-color": "#3f91ae",
              "line-opacity": 0.98,
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.8, 9, 3.2],
            },
          });
          map.addLayer({
            id: "county-lines",
            type: "line",
            source: "counties",
            paint: { "line-color": "#786e62", "line-opacity": 0.62, "line-width": 0.85 },
          });
          const countyLabelData: GeoJSON.FeatureCollection<GeoJSON.Point> = {
            type: "FeatureCollection",
            features: countyData.features.map((county) => ({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [Number(county.properties.INTPTLON), Number(county.properties.INTPTLAT)],
              },
              properties: { name: county.properties.BASENAME },
            })),
          };
          map.addSource("county-labels", { type: "geojson", data: countyLabelData });
          map.addLayer({
            id: "county-labels",
            type: "symbol",
            source: "county-labels",
            layout: {
              "text-field": ["get", "name"],
              "text-size": 9.3,
              "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": "#3f3832",
              "text-opacity": 0.68,
              "text-halo-color": "#fffaf1",
              "text-halo-width": 1.1,
            },
          });
          map.addLayer({
            id: "fblm-water-labels",
            type: "symbol",
            source: "fblm-hydrography",
            minzoom: 5.5,
            layout: {
              "symbol-placement": "line",
              "text-field": ["get", "name"],
              "text-size": 9,
              "text-font": ["DIN Pro Italic", "Arial Unicode MS Regular"],
              "text-max-angle": 35,
              "text-padding": 12,
            },
            paint: {
              "text-color": "#246f8a",
              "text-halo-color": "#fffdf7",
              "text-halo-width": 1.2,
            },
          });
          const initialRecords = countsData.records.filter(
            (record) => record.year === countsData.years[0] && record.count > 0,
          );
          map.addSource("legislators", { type: "geojson", data: pointData(initialRecords) });
          map.addLayer({
            id: "legislator-circles",
            type: "circle",
            source: "legislators",
            paint: {
              "circle-color": "#8f1d2c",
              "circle-stroke-color": "#fffaf1",
              "circle-stroke-width": 2,
              "circle-opacity": 0.92,
              "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 13, 5, 27],
            },
          });
          map.addLayer({
            id: "legislator-counts",
            type: "symbol",
            source: "legislators",
            layout: {
              "text-field": ["to-string", ["get", "count"]],
              "text-size": 13,
              "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#fffaf1" },
          });

          const showTooltip = (event: import("mapbox-gl").MapMouseEvent & { features?: import("mapbox-gl").MapboxGeoJSONFeature[] }) => {
            const feature = event.features?.[0];
            const properties = (feature as unknown as { properties?: Record<string, string | number> })?.properties;
            if (!properties) return;
            map.getCanvas().style.cursor = "pointer";
            popupRef.current
              ?.setLngLat(event.lngLat)
              .setHTML(`<strong>${properties.county} County</strong><span>${properties.count} legislator${properties.count === 1 ? "" : "s"} in ${properties.year}</span>`)
              .addTo(map);
          };
          map.on("mousemove", "legislator-circles", showTooltip);
          map.on("mouseleave", "legislator-circles", () => {
            map.getCanvas().style.cursor = "";
            popupRef.current?.remove();
          });
          map.on("click", "legislator-circles", (event) => {
            const fips = (event.features?.[0] as unknown as { properties?: { fips?: string } })?.properties?.fips;
            if (fips) setSelectedFips(String(fips));
          });
          map.fitBounds(MISSISSIPPI_BOUNDS, { padding: 28, duration: 0, pitch: 0, bearing: 0 });
          refreshMapCanvas?.();
          startupUntil = performance.now() + 2500;
          startupAnimationFrame = window.requestAnimationFrame(paintStartupFrames);
          map.once("idle", () => refreshMapCanvas?.());
        });
        map.on("error", (event) => {
          const message = String(event.error?.message ?? "");
          if (message.includes("401")) setLoadingError("The map token is not authorized for this address.");
        });
      } catch {
        setLoadingError("The map is ready, but its public Mapbox token still needs to be added.");
      }
    }
    initializeMap();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (startupAnimationFrame !== undefined) window.cancelAnimationFrame(startupAnimationFrame);
      window.removeEventListener("pageshow", refreshAfterResume);
      document.removeEventListener("visibilitychange", refreshAfterResume);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [counties, counts, pointData]);

  useEffect(() => {
    const source = mapRef.current?.getSource("legislators") as import("mapbox-gl").GeoJSONSource | undefined;
    source?.setData(pointData(records));
  }, [records, pointData]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!counts || ["INPUT", "SELECT", "A", "BUTTON"].includes((event.target as HTMLElement).tagName)) return;
      if (event.key === "ArrowLeft") { setPlaying(false); setYearIndex((value) => Math.max(0, value - 1)); }
      if (event.key === "ArrowRight") { setPlaying(false); setYearIndex((value) => Math.min(counts.years.length - 1, value + 1)); }
      if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [counts]);

  const goToYear = (index: number) => {
    dismissPlayHint();
    setPlaying(false);
    setYearIndex(index);
  };

  const togglePlayback = () => {
    dismissPlayHint();
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!counts || yearIndex >= counts.years.length - 1) return;
    setYearIndex((current) => Math.min(current + 1, counts.years.length - 1));
    setPlaying(true);
  };

  const dismissPlayHint = () => {
    setShowPlayHint(false);
    rememberPlayHintDismissal();
  };

  const resetMapView = () => {
    mapRef.current?.fitBounds(MISSISSIPPI_BOUNDS, { padding: 28, duration: 650, pitch: 0, bearing: 0 });
  };

  return (
    <main className={embed ? "site site--embed" : "site"}>
      {!embed && (
        <header className="masthead">
          <h1>
            <a href={COMPANION_URL} target="_blank" rel="noreferrer">
              <strong>Against All Odds</strong>
              <span>The First Black Legislators in Mississippi</span>
            </a>
          </h1>
          <a className="project-link" href={COMPANION_URL} target="_blank" rel="noreferrer">Main project ↗</a>
        </header>
      )}

      <section className="explorer" aria-label="Interactive legislator map and timeline">
        <div className="timeline">
          <div className="timeline__summary">
            <span className="timeline__kicker">Mississippi legislature</span>
            <strong>{year}</strong>
            <span>{counts?.totals[String(year)] ?? 0} legislators · {records.length} counties</span>
          </div>
          <div className="timeline__controls">
            <div className="transport-controls" role="group" aria-label="Timeline playback controls">
              <button type="button" onClick={() => goToYear(0)} disabled={yearIndex === 0} aria-label="Go to first year" title="First year"><TransportIcon kind="first" /></button>
              <button type="button" onClick={() => goToYear(Math.max(0, yearIndex - 1))} disabled={yearIndex === 0} aria-label="Previous year" title="Previous year"><TransportIcon kind="previous" /></button>
              <button
                type="button"
                className="transport-controls__primary"
                onClick={togglePlayback}
                disabled={!playing && yearIndex === (counts?.years.length ?? 1) - 1}
                aria-label={playing ? "Pause timeline" : "Play timeline"}
                title={playing ? "Pause" : "Play"}
              >
                <TransportIcon kind={playing ? "pause" : "play"} />
                {showPlayHint && !playing && (
                  <span className="play-hint" aria-hidden="true">
                    <svg viewBox="0 0 14 24"><path d="M7 23V4m0 0L2.5 8.5M7 4l4.5 4.5" /></svg>
                  </span>
                )}
              </button>
              <button type="button" onClick={() => goToYear(Math.min((counts?.years.length ?? 1) - 1, yearIndex + 1))} disabled={yearIndex === (counts?.years.length ?? 1) - 1} aria-label="Next year" title="Next year"><TransportIcon kind="next" /></button>
              <button type="button" onClick={() => goToYear((counts?.years.length ?? 1) - 1)} disabled={yearIndex === (counts?.years.length ?? 1) - 1} aria-label="Go to last year" title="Last year"><TransportIcon kind="last" /></button>
            </div>
            <div className="timeline__track" ref={timelineTrack}>
              <span
                className="timeline__current-year"
                style={{ left: `${currentYearLeft}px`, visibility: timelineTrackWidth > 0 ? "visible" : "hidden" }}
                aria-hidden="true"
              >
                {year}
              </span>
              <input
                aria-label="Year"
                type="range"
                min="0"
                max={Math.max(0, (counts?.years.length ?? 1) - 1)}
                value={yearIndex}
                onChange={(event) => { dismissPlayHint(); setPlaying(false); setYearIndex(Number(event.target.value)); }}
              />
              <div className="year-ticks" aria-hidden="true">
                {timelineTicks.map((tick) => (
                  <span
                    key={tick.year}
                    style={{ left: `${(tick.index / Math.max(1, (counts?.years.length ?? 1) - 1)) * 100}%` }}
                  >
                    {tick.year}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="map-layout">
          <div className="map-wrap">
            <div ref={mapContainer} className="map" aria-label={`Map of Black legislators by Mississippi county in ${year}`} />
            <button className="map-reset" type="button" onClick={resetMapView} aria-label="Reset map view" title="Reset map view">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M7 3H3v4m10-4h4v4M7 17H3v-4m10 4h4v-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="10" cy="10" r="2.2" fill="currentColor" />
              </svg>
            </button>
            {loadingError && !mapReady && <div className="map-message" role="status">{loadingError}</div>}
            <div className="legend">
              <span className="legend__dot">3</span>
              <span className="legend__copy">
                <span>Circle size and number show legislators serving that county</span>
                <span>Hover for more details.</span>
              </span>
            </div>
          </div>
          <aside className="detail-panel" aria-live="polite">
            {selected ? (
              <>
                <button className="close-panel" type="button" onClick={() => setSelectedFips(null)} aria-label="Close county details">×</button>
                <span className="detail-panel__year">{year}</span>
                <h2>{selected.county} County</h2>
                <p className="detail-panel__count">{selected.count} legislator{selected.count === 1 ? "" : "s"}</p>
                {selectedNames.length > 0 ? (
                  <ol className="people-list">
                    {selectedNames.map((person) => (
                      <li key={`${person.url}-${person.chamber}`}>
                        <a href={person.url} target="_blank" rel="noreferrer">{surnameFirst(person.name)}<span>({selected.county}, {year}) · {person.chamber ? `${person.chamber} biography` : "Biography"} ↗</span></a>
                      </li>
                    ))}
                  </ol>
                ) : <p className="detail-note">No linked profile is available for this county-year.</p>}
                {selectedNames.length !== selected.count && (
                  <p className="detail-note">The workbook records {selected.count}; the companion roster currently links {selectedNames.length} {selectedNames.length === 1 ? "profile" : "profiles"}.</p>
                )}
              </>
            ) : (
              <div className="roster-panel">
                <span className="detail-panel__year">{year}</span>
                <h2>Legislators</h2>
                <p className="detail-panel__count">{activePeople.length} linked profiles · {counts?.totals[String(year)] ?? 0} recorded</p>
                <div className="sort-controls" aria-label="Sort legislators">
                  <span>Sort by</span>
                  <button type="button" className={sortMode === "name" ? "is-active" : ""} onClick={() => setSortMode("name")}>Name</button>
                  <button type="button" className={sortMode === "county" ? "is-active" : ""} onClick={() => setSortMode("county")}>County</button>
                </div>
                <ol className="people-list people-list--roster">
                  {activePeople.map((person) => (
                    <li key={`${person.url}-${person.chamber}-${person.county}`}>
                      <a href={person.url} target="_blank" rel="noreferrer">
                        {person.displayName}
                        <span>({person.county}, {person.year}) · {person.chamber ? `${person.chamber} biography` : "Biography"} ↗</span>
                      </a>
                    </li>
                  ))}
                </ol>
                {activePeople.length !== (counts?.totals[String(year)] ?? 0) && (
                  <p className="detail-note">The workbook count is shown on the map; this list includes the profiles currently linked by the companion roster.</p>
                )}
              </div>
            )}
          </aside>
        </div>
      </section>

    </main>
  );
}
