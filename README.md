# GNSS Orbit Viewer

[日本語](README.ja.md)

A live wallpaper / web app that shows the GPS, GLONASS, Galileo, BeiDou and QZSS satellites orbiting a 3D Earth in real time.

![GNSS Orbit Viewer](docs/demo.gif)

- **Real orbits.** It downloads the current orbital elements from [CelesTrak](https://celestrak.org/) and propagates them with SGP4 in a Web Worker, so every satellite is where it really is right now.
- **Real sky.** The Earth rotates with sidereal time, and the day/night terminator and city lights follow the actual Sun position.
- **Two themes.** *Realistic* has NASA imagery and soft trails. *Technical* has a dark map with a grid and saturated colours per constellation.
- **Readable at a glance.** Fading trails or full orbits, per-constellation toggles, and satellite labels that avoid overlapping each other.
- **Altitude scaling.** GNSS orbits are 3–6 Earth radii out, so by default only the height above the surface is shrunk to 10%. 100% gives true scale.
- **Your location.** A marker shows roughly where you are. It is estimated from your time zone (no IP lookup, no GPS), or you can set the latitude and longitude yourself.
- **Your sky.** Satellites above your horizon are highlighted, with lines of sight from your location and a live count per constellation (for example *Satellites in your sky: 57*).
- **Wallpaper-friendly.** Rendering pauses when hidden or when Lively pauses it. You can cap the frame rate, and the orbit data is cached locally.
- **10 languages.** English, 日本語, 简体中文, 繁體中文, 한국어, Русский, Español, Français, Deutsch and Português (Brasil). The language follows your system by default.

## Use with Lively Wallpaper

1. Download `gnss-orbit-viewer-lively-<version>.zip` from [Releases](https://github.com/MenEnger/gnss-wallpaper/releases).
2. Drag and drop the zip onto the Lively window.
3. Right-click the wallpaper → **Customise** to change the theme, labels, orbit lines, altitude scale, constellations, location, camera, time scale and frame-rate cap.

Notes:
- An internet connection is needed to download orbit data (at most every 2 hours) and the Earth textures. After the first run, cached orbit data is used if the network is unavailable.
- Lively forwards mouse input without reliable button state, so dragging to rotate the view is disabled under Lively. The camera orbits automatically.

## Run in a browser

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # static files in dist/
npm run build:lively   # Lively package in release/
```

Drag to rotate and scroll to zoom. Press `H` to show or hide the settings panel.

### Being nice to CelesTrak

CelesTrak asks clients not to query more than once per hour and to stop immediately on any non-200 response; IP addresses that keep querying get firewalled ([usage policy](https://celestrak.org/usage-policy.php)). This app downloads at most every 2 hours, shares one cache between all instances on the machine, and pauses automatic downloads after an error response until the user retries.

During development the dev server proxies CelesTrak through a disk cache (`.cache/`), so reloads or fresh browser profiles do not add requests. To work without contacting CelesTrak at all, point `OMM_FIXTURE` at a saved OMM JSON file before `npm run dev`.

## Translations

The translations other than English and Japanese were not reviewed by native speakers. Corrections are very welcome — edit the file for your language in [`src/locales/`](src/locales) and open a pull request.

## Credits

- Orbital data: [CelesTrak](https://celestrak.org/) GP data (OMM/JSON), propagated with [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4).
- Earth imagery: **NASA** Blue Marble and Black Marble (NASA Earth Observatory). The images are loaded at runtime from the example images of [three-globe](https://github.com/vasturiano/three-globe) and are not bundled with this project. Use of NASA imagery does not imply NASA endorsement.
- Time-zone locations: [IANA tz database](https://github.com/eggert/tz) (public domain).
- Rendering: [three.js](https://threejs.org/). Settings panel: [lil-gui](https://lil-gui.georgealways.com/).

## License

[MIT](LICENSE). The Earth imagery and orbital data are provided by their respective sources (see Credits) and are not covered by this license.
