# TeslaCam Browser NG

Watch your Tesla dashcam and Sentry clips with every camera in sync and every
event in one list. Works on a computer, a home server or a phone.

**[Try the live demo](https://joyjit.github.io/teslacam-browser-ng/)**. It has
two modes, switched in the top bar:

- **Sample archive:** real clips with faces and number plates blurred and
  places moved. Notes, Keep stars and the trash work, and stay in your browser.
- **My USB stick:** open your own `TeslaCam` folder or USB stick. It plays in
  your browser and nothing is uploaded.

## Highlights

- **One event list.** Newest first and grouped by day, with a thumbnail,
  reason and place for each event. Filter by Sentry, Saved, Recent or Track,
  or jump to a day.
- **Cameras laid out like the car.** Front in the middle, sides left and right,
  back below, plus pillars and cabin when present. Click a camera to enlarge it.
- **One player bar.** Play, speed and scrub for all cameras at once. The moment
  of the event is marked on the bar, with a Jump to event button.
- **Works on a phone.** The list comes first, then the player with a strip of
  cameras to swap.
- **Two modes**, below: a USB stick or one fixed clip archive.
- **Desktop app or server.** Electron for Mac, Windows and Linux, or a small
  web server for a NAS, a Raspberry Pi or Docker.

## Two modes

| | USB stick (default) | TeslaUSB |
| --- | --- | --- |
| For | A USB stick, or a copy of its `TeslaCam` folder | One clip archive on a server, e.g. uploaded by [TeslaUSB](https://github.com/marcone/teslausb) |
| Folders | Open any folder | Locked to the start folder |
| Notes and Keep star | No | Yes, saved next to the clips |
| Delete | Deletes the event (desktop app) | Moves it to a trash for 30 days |

## Run it

Desktop app, from source:

```
yarn install
yarn start
```

Server, then open http://localhost:8088:

```
yarn install
node server.js /path/to/TeslaCam
```

TeslaUSB mode: start the server with `TESLACAM_MODE=teslausb`. The server
needs write access to the clip folder for notes and the trash. Both are kept
in `.teslacam-browser/` inside it.

Docker (amd64 and arm64):

```
docker build -t teslacam-browser .
docker run --rm -p 8088:8088 \
  -v /path/to/TeslaCam:/media/TeslaCam teslacam-browser
```

Add `-e TESLACAM_MODE=teslausb` for TeslaUSB mode.

The server only shows, plays and deletes files inside the open folder. Behind
a login proxy that sends `Remote-User` (Authelia does), notes and deletions
record who made them. Trust that only if the server can't be reached any
other way.

## Changes from the original

This started as a fork of [TeslaCam Browser](https://github.com/BobStrogg/teslacam-browser)
by Chris Cavanagh. The main changes:

- A new page for web and desktop: the event list, the car layout, one player
  bar with the event marked, and a phone layout. The old page is still at
  `/classic`.
- TeslaUSB mode: one locked folder, notes and Keep stars per event, and a
  30-day trash.
- A safer server: no paths outside the open folder (`..` and links are
  checked), and nothing is deleted outside it.
- A live demo, which can also open your own folder in the browser.
- Test tools: `scripts/make-fake-clips.sh` makes fake clips, and
  `scripts/make-demo-clips.py` makes real clips safe to share (blurring,
  moved location, no metadata).

## Good to know

- **HEVC (H.265) clips** from newer cars don't play in Chrome or the desktop
  app on Linux, because there's no decoder. Use a Mac, or Windows with the
  HEVC Video Extensions. The page shows a warning when it can't play them.
- **Merged video:** click Copy path on an event, then run
  [tesla_dashcam](https://github.com/ehendrix23/tesla_dashcam) on that path.
- Not affiliated with Tesla.

## License

[CC0 1.0 (public domain)](LICENSE.md)
