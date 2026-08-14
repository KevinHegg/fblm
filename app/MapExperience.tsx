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
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.7 16 10 6 16.3Z" /></svg>;
  }
  if (kind === "pause") {
    return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4h3.4v12H5zm6.6 0H15v12h-3.4z" /></svg>;
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {endpoint && <path d={previous ? "M4 4h1.8v12H4z" : "M14.2 4H16v12h-1.8z"} />}
      <path d={previous ? "M14.7 4.2 6.3 10l8.4 5.8Z" : "M5.3 4.2 13.7 10l-8.4 5.8Z"} />
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
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const popupRef = useRef<import("mapbox-gl").Popup | null>(null);
  const [counts, setCounts] = useState<CountsData | null>(null);
  const [names, setNames] = useState<NamesData | null>(null);
  const [counties, setCounties] = useState<CountyCollection | null>(null);
  const [yearIndex, setYearIndex] = useState(0);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [loadingError, setLoadingError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [embed, setEmbed] = useState(false);

  const year = counts?.years[yearIndex] ?? 1870;
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
    queueMicrotask(() => setEmbed(embedParam));
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
    const base = detectAssetBase();
    const countyData = counties;
    const countsData = counts;

    async function initializeMap() {
      try {
        const [{ default: mapboxgl }, configResponse] = await Promise.all([
          import("mapbox-gl"),
          fetch(`${base}/${window.location.hostname === "localhost" ? "config.local.json" : "config.json"}`),
        ]);
        const config = await configResponse.json();
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
        popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 18 });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-left");
        map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          setMapReady(true);
          setLoadingError("");
          map.fitBounds([[-91.72, 30.08], [-88.02, 35.08]], { padding: 28, duration: 0 });
          map.addSource("counties", { type: "geojson", data: countyData });
          map.addLayer({
            id: "county-fill",
            type: "fill",
            source: "counties",
            paint: { "fill-color": "#f6f0e5", "fill-opacity": 0.2 },
          });
          map.addLayer({
            id: "county-lines",
            type: "line",
            source: "counties",
            paint: { "line-color": "#8a7e70", "line-opacity": 0.5, "line-width": 0.8 },
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
              "text-size": 9,
              "text-font": ["DIN Pro Regular", "Arial Unicode MS Regular"],
              "text-allow-overlap": false,
            },
            paint: {
              "text-color": "#514a43",
              "text-opacity": 0.48,
              "text-halo-color": "#fffaf1",
              "text-halo-width": 1.1,
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
        });
        map.on("error", (event) => {
          if (String(event.error?.message ?? "").includes("401")) setLoadingError("The map token is not authorized for this address.");
        });
      } catch {
        setLoadingError("The map is ready, but its public Mapbox token still needs to be added.");
      }
    }
    initializeMap();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
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
    setPlaying(false);
    setYearIndex(index);
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
          <a className="project-link" href={COMPANION_URL} target="_blank" rel="noreferrer">Companion project ↗</a>
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
                onClick={() => setPlaying((value) => !value)}
                disabled={!playing && yearIndex === (counts?.years.length ?? 1) - 1}
                aria-label={playing ? "Pause timeline" : "Play timeline"}
                title={playing ? "Pause" : "Play"}
              >
                <TransportIcon kind={playing ? "pause" : "play"} />
              </button>
              <button type="button" onClick={() => goToYear(Math.min((counts?.years.length ?? 1) - 1, yearIndex + 1))} disabled={yearIndex === (counts?.years.length ?? 1) - 1} aria-label="Next year" title="Next year"><TransportIcon kind="next" /></button>
              <button type="button" onClick={() => goToYear((counts?.years.length ?? 1) - 1)} disabled={yearIndex === (counts?.years.length ?? 1) - 1} aria-label="Go to last year" title="Last year"><TransportIcon kind="last" /></button>
            </div>
            <input
              aria-label="Year"
              type="range"
              min="0"
              max={Math.max(0, (counts?.years.length ?? 1) - 1)}
              value={yearIndex}
              onChange={(event) => { setPlaying(false); setYearIndex(Number(event.target.value)); }}
            />
            <div className="year-ticks" aria-hidden="true">
              <span>1870</span><span>1882</span><span>1894</span>
            </div>
          </div>
        </div>

        <div className="map-layout">
          <div className="map-wrap">
            <div ref={mapContainer} className="map" aria-label={`Map of Black legislators by Mississippi county in ${year}`} />
            {loadingError && !mapReady && <div className="map-message" role="status">{loadingError}</div>}
            <div className="legend"><span className="legend__dot">3</span><span>Circle size and number show legislators serving that county</span></div>
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
