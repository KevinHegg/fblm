# Against All Odds: The First Black Legislators in Mississippi

An interactive county map and timeline for the companion research project at [much-ado.net/legislators](https://much-ado.net/legislators/). The display covers the biennial legislative snapshots from 1870 through 1894.

The map uses one proportional, numbered marker per county. The circle size and number both show how many Black legislators served that county in the selected year, avoiding overlapping markers. Hovering gives a quick county summary; clicking opens available names and biography links in a fixed detail panel.

## Embed

Use the dedicated query parameter to remove the title, introduction, and footer:

```html
<iframe
  src="https://kevinhegg.github.io/fblm/?embed=1"
  title="Against All Odds: Black legislators in Mississippi, 1870–1894"
  loading="lazy"
  style="width:100%;height:min(780px,90vh);min-height:560px;border:0"
  allow="fullscreen"
></iframe>
```

The embedded display is responsive. At narrow widths, the biography panel moves below the map. The iframe itself should be given at least 560 pixels of height.

## Development

Requirements: Node.js 22 or newer and a public Mapbox token.

```bash
npm install
MAPBOX_TOKEN=pk.example node scripts/write-config.mjs
npm run build:github
```

For GitHub Pages, the public, read-only browser token is stored as the repository Actions secret `MAPBOX_TOKEN`; the deployment workflow writes it into the published configuration. Local development uses the ignored file `public/config.local.json`. The token’s Mapbox URL restrictions allow only the published project and the local development address.

## Data

- Counts: project research workbook (`deedee_mapdata.xlsx`)
- Names and biography links: companion-site year rosters and individual profiles
- County geometry: U.S. Census Bureau TIGERweb current county layer

The source workbook contains one incorrect FIPS value for Clarke County (`20823`); the exported data corrects it to `28023`. In 12 of 160 populated county-year rows, the workbook total and the number of currently linked companion-site profiles differ. The interface preserves the workbook count and reports the available profile count transparently.
