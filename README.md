# Interactive Earth Globe

An interactive, browser-based 3D Earth built with Three.js. It includes day/night shading, country borders, click-to-highlight countries, and a country info panel.

## Run Locally

From the project folder:

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8000
```

## Deploy to GitHub Pages

1. Put `index.html`, `main.js`, and the `assets/` folder in your repo root.
2. In GitHub: **Settings → Pages**
3. Under **Build and deployment**, choose:
   - Source: **Deploy from a branch**
   - Branch: **main** (or **master**)
   - Folder: **/ (root)**

## Credits and Data Sources

- Earth textures: Solar System Scope  
  https://www.solarsystemscope.com/
- Country borders GeoJSON: Johan / world.geo.json  
  https://github.com/johan/world.geo.json
- Country summaries API: Wikipedia REST API  
  https://en.wikipedia.org/api/rest_v1/
- Time zone lookup: Open-Meteo API  
  https://open-meteo.com/
- 3D engine: Three.js (via unpkg CDN)  
  https://threejs.org/  
  https://unpkg.com/

## Notes

- Some assets and APIs may have their own licenses or attribution requirements. If you publish this project, review the terms for each data source.
