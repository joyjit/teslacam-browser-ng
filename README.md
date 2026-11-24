# TeslaCam Browser NG

*Not affiliated with Tesla.*

Watch your Tesla dashcam and Sentry clips with every camera in sync and every
event in one list. Works on a computer, a home server or a phone.

**[Try the live demo](https://joyjit.github.io/teslacam-browser-ng/)**. It has
two modes, switched in the top bar:

- **Sample archive:** a self-contained demo with sample videos.
- **My USB stick:** open your own `TeslaCam` folder or USB stick. Your videos
  play right in your browser. Nothing is uploaded, even if the browser's
  prompt says "upload".

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
- **Runs as a small web server** on a NAS, a Raspberry Pi or in Docker.

## Two modes

| | USB stick (default) | TeslaUSB |
| --- | --- | --- |
| For | A USB stick, or a copy of its `TeslaCam` folder | One clip archive on a server, e.g. uploaded by [TeslaUSB](https://github.com/marcone/teslausb) |
| Folders | Open any folder | Locked to the start folder |
| Notes and Keep star | No | Yes, saved next to the clips |
| Delete | Deletes the event | Moves it to a trash for 30 days |

## Run it

Needs Node.js 22 or newer. Start the server, then open
http://localhost:8088:

```
yarn install --ignore-scripts
node server.js /path/to/TeslaCam
```

[TeslaUSB](https://github.com/marcone/teslausb) mode: start the server with
`TESLACAM_MODE=teslausb`. The server needs write access to the clip folder for
notes and the trash. Both are kept in `.teslacam-browser/` inside it.

Docker (amd64 and arm64), then open http://localhost:8088:

```
docker run --rm -p 8088:8088 \
  -v /path/to/TeslaCam:/media/TeslaCam \
  ghcr.io/joyjit/teslacam-browser-ng
```

Add `-e TESLACAM_MODE=teslausb` for TeslaUSB mode. To build the image
yourself: `docker build -t teslacam-browser-ng .`

The server only shows, plays and deletes files inside the open folder.

## Putting it online

The app has **no login of its own**, and anyone who can reach it can watch
and delete clips. Never forward port 8088 on your router.

To reach it from outside your home, put a web server in front that adds
HTTPS and a login, for example [Caddy](https://caddyserver.com) with
[Authelia](https://www.authelia.com), or a Cloudflare Tunnel with Access.
Start the container with `-p 127.0.0.1:8088:8088` so only that web server
can reach it. A minimal Caddy site (Caddy gets the HTTPS certificate by
itself; add your login with `forward_auth`):

```
clips.example.com {
  reverse_proxy localhost:8088
}
```

If the login sends the user's name in a `Remote-User` header (Authelia
does), notes and deletions record who made them.

## Changes from the original

This started as a fork of [TeslaCam Browser](https://github.com/BobStrogg/teslacam-browser)
by Chris Cavanagh. The main changes:

- A new page: the event list, the car layout, one player bar with the event
  marked, and a phone layout.
- TeslaUSB mode: one locked folder, notes and Keep stars per event, and a
  30-day trash.
- A safer server: no paths outside the open folder (`..` and links are
  checked), and nothing is deleted outside it.
- A live demo, which can also open your own folder in the browser.

## Good to know

- **HEVC (H.265) clips** from newer cars: on Linux, use Firefox 137 or
  newer; Chrome on Linux usually can't play them. On Windows, install the
  HEVC Video Extensions. Macs play them as is. The page shows a warning
  when it can't play them.
- **Merged video:** click Copy path on an event, then run
  [tesla_dashcam](https://github.com/ehendrix23/tesla_dashcam) on that path.

## License

[CC0 1.0 (public domain)](LICENSE.md)
