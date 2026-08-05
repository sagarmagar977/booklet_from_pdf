# Client-Side Booklet Imposer & Converter

A high-performance prepress utility built on top of **Astro** and **React** that imposes standard single-page vertical PDFs into printer-ready landscape 2-up spreads. All PDF manipulations run locally inside a browser **Web Worker** thread using **pdf-lib**, ensuring maximum performance and a 100% private, serverless runtime boundary.

## 🚀 Key Features

* **100% In-Browser Privacy:** Zero-trust architecture. Files are processed entirely in client RAM. No endpoints, database storing, or network tracking.
* **Typo-Free Signature Imposition:** Imposes vertical source pages into landscape spreads based on the 4-page signature sequence:
  - **Front (Side A):** `[ Page 4k + 4 | Page 4k + 1 ]`
  - **Back (Side B):** `[ Page 4k + 2 | Page 4k + 3 ]`
* **Enhanced Saddle-Stitch Booklet Mode:** Imposes all document pages to fold together as a single stacked booklet nested outside-in.
* **Prepress Margins & Scaling:**
  - Standard output presets (A3, A4, A5, Letter, Legal) and custom dimension inputs (mm, cm, inches, points).
  - Customizable center gutter margin (binding margin) and outer bleed margins.
  - Smart uniform aspect-ratio scaling (Fit to Half-Sheet) or centered original sizing.
* **Interactive Spread Previewer:** Live visual mock detailing exact slot coordinates before compilation.
* **Programmatic SEO Base:** Includes fully optimized sitemap indexing and SEO meta landing pages.

## 📁 Project Structure

```text
/
├── public/
│   └── robots.txt          # Crawling restrictions & sitemap path
├── src/
│   ├── components/
│   │   ├── BookletApp.tsx  # Interactive dashboard React island
│   │   └── BookletApp.css  # Premium styling
│   ├── layouts/
│   │   └── Layout.astro    # Master Layout with CSP and JSON-LD schemas
│   ├── pages/              # Programmatic SEO Landers
│   │   ├── index.astro
│   │   ├── print-booklet-online.astro
│   │   ├── a4-to-a5-booklet.astro
│   │   ├── letter-to-half-letter.astro
│   │   └── pdf-4-page-signature.astro
│   └── workers/
│       └── imposition.worker.ts # Local pdf-lib Web Worker processor
├── package.json
└── astro.config.mjs        # Integrations registration (React, Sitemap)
```

## 🧞 Local Commands

All commands should be executed from the root of the project workspace:

| Command | Action |
| :--- | :--- |
| `npm install` | Installs dependencies |
| `npm run dev` | Spawns local hot-reload dev server at `localhost:4321` |
| `npm run astro -- dev --background` | Runs dev server in background mode |
| `npm run astro -- dev status` | Checks background dev server status |
| `npm run astro -- dev logs` | Tails background dev server output logs |
| `npm run astro -- dev stop` | Terminates background dev server |
| `npm run build` | Compiles static pages, sitemaps, and workers into `./dist/` |
| `npm run preview` | Serves the generated production build locally |

## 🛡️ Security Model

Enforces strict content restriction headers via CSP meta tags:
* `connect-src 'none'`: Absolutely blocks outbound XHR/WebSocket/Fetch calls, guaranteeing file privacy.
* `object-src 'none'`: Shields client runtime from PDF browser exploit plug-ins.
* `frame-ancestors 'none'`: Prevents clickjacking embedding inside external iframes.
