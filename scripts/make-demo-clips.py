#!/usr/bin/env python3
"""Turn real TeslaCam events into shareable demo events.

For each event folder under SRC/{SavedClips,SentryClips}:
  * keep about one minute around the event time, split at the original
    clip boundaries so the app still sees several clips per event;
  * scale to 960x720 at a constant 24 fps, re-encode smaller, and drop all
    metadata (title/comment/creation time tags and per-frame GPS data);
  * optionally blur faces and number plates with EgoBlur gen2 models;
  * move the event's coordinates by a random distance and direction (a
    different one per event) and replace city/street with made-up names;
  * make a new thumb.png from the processed front camera.

Usage:
  scripts/make-demo-clips.py SRC OUT [--face F.jit --lp L.jit] [--every 4]
      [--jobs 4] [--mask back:0.28]

Blurring needs PyTorch, OpenCV and a checkout of
https://github.com/facebookresearch/EgoBlur (set EGOBLUR_SRC to it); the
gen2 model files come from https://www.projectaria.com/tools/egoblur.
Faces and plates are looked for on every Nth frame (--every) and the blur
boxes are stretched over the frames in between.
"""
import argparse, json, math, os, random, re, subprocess, sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta

import numpy as np

W, H, FPS = 960, 720, 24
WINDOW = 60          # seconds kept per event
BEFORE = 30          # seconds before the event, when available
SHIFT_KM = (20, 60)  # random shift distance range
NAMES = ["Demoville", "Sampleton", "Testbrook", "Mockford", "Placeholder Park",
         "Fakewood", "Dummy Hills", "Exampleton"]
STREETS = ["Demo St", "Sample Ave", "Example Rd", "Test Blvd", "Mock Ln"]

STAMP = re.compile(r"^(\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)-(.+)\.mp4$")
rng = random.SystemRandom()


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def parse_stamp(s):
    return datetime.strptime(s, "%Y-%m-%d_%H-%M-%S")


def decode(path, start, length):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}",
           "-i", path, "-an", "-vf", f"fps={FPS},scale={W}:{H}",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    size = W * H * 3
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    p.wait()


# ---------- blurring ----------
_det = None


def detectors(face, lp):
    global _det
    if _det is None:
        import torch
        torch.set_num_threads(int(os.environ.get("BLUR_THREADS", "6")))
        sys.path.insert(0, os.environ["EGOBLUR_SRC"])
        from gen2.script.predictor import EgoblurDetector, ClassID
        # Detect at the output size (short side 720): on these frames it was
        # both faster and found more than EgoBlur's default 1200.
        aug = {"min_size_test": H, "max_size_test": W}
        # Thresholds well below EgoBlur's camera-rgb defaults: a missed face
        # or plate matters more here than an extra blurred patch. A driver
        # seen through a side window scored between 0.4 and 0.5 but was
        # found on every frame at 0.1.
        _det = [EgoblurDetector(face, "cpu", ClassID.FACE, 0.1, 0.3, resize_aug=aug),
                EgoblurDetector(lp, "cpu", ClassID.LICENSE_PLATE, 0.2, 0.3, resize_aug=aug)]
    return _det


def detect(frame, dets):
    import torch
    from gen2.script.predictor import PATCH_INSTANCES_FIELDS
    from gen2.script.detectron2.export.torchscript_patch import patch_instances
    t = torch.from_numpy(np.ascontiguousarray(frame.transpose(2, 0, 1)))
    boxes = []
    with torch.no_grad(), patch_instances(fields=PATCH_INSTANCES_FIELDS):
        for d in dets:
            boxes += d.run(t)[0]
    return boxes


def grow(b, f=0.25, minpad=10):
    x0, y0, x1, y1 = b
    px = max((x1 - x0) * f, minpad)
    py = max((y1 - y0) * f, minpad)
    return [x0 - px, y0 - py, x1 + px, y1 + py]


def spans(a_boxes, b_boxes):
    """Boxes covering movement between two sampled frames: each box joined
    with the nearest box in the other frame (if close), else kept alone."""
    out = []
    for src, dst in ((a_boxes, b_boxes), (b_boxes, a_boxes)):
        for b in src:
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            best, bd = None, 1e9
            for o in dst:
                d = math.hypot((o[0] + o[2]) / 2 - cx, (o[1] + o[3]) / 2 - cy)
                if d < bd:
                    best, bd = o, d
            # A passing car moves a face 20-50 px per frame at 960 wide.
            lim = max(4 * max(b[2] - b[0], b[3] - b[1]), 250)
            if best is not None and bd < lim:
                out.append([min(b[0], best[0]), min(b[1], best[1]),
                            max(b[2], best[2]), max(b[3], best[3])])
            else:
                out.append(b)
    return out


def blur(frame, boxes):
    if not boxes:
        return frame
    import cv2
    frame = frame.copy()
    for b in boxes:
        x0, y0, x1, y1 = grow(b)
        x0, y0 = max(int(x0), 0), max(int(y0), 0)
        x1, y1 = min(int(x1) + 1, W), min(int(y1) + 1, H)
        if x1 <= x0 or y1 <= y0:
            continue
        roi = frame[y0:y1, x0:x1]
        # pixelate then smooth: nothing readable survives
        small = cv2.resize(roi, (max(1, (x1 - x0) // 12), max(1, (y1 - y0) // 12)),
                           interpolation=cv2.INTER_AREA)
        roi = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
        frame[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (0, 0), 3)
    return frame


def process(job):
    src, start, length, out, face, lp, every, mask = job
    blur_on = face is not None
    sampled = {}
    if blur_on:
        dets = detectors(face, lp)
        for i, fr in enumerate(decode(src, start, length)):
            if i % every == 0:
                sampled[i] = detect(fr, dets)
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-profile:v", "main",
         "-pix_fmt", "yuv420p", "-g", str(FPS * 2), "-movflags", "+faststart",
         "-map_metadata", "-1", "-fflags", "+bitexact", out], stdin=subprocess.PIPE)
    nblur = 0
    for i, fr in enumerate(decode(src, start, length)):
        if blur_on:
            # sampled frames on each side, two deep, so one missed detection
            # in between does not leave a gap
            k = i - i % every
            near = [s for s in (k - every, k, k + every, k + 2 * every) if s in sampled]
            boxes = []
            for a, b in zip(near, near[1:]):
                boxes += spans(sampled[a], sampled[b])
            if len(near) == 1:
                boxes += sampled[near[0]]
            nblur += bool(boxes)
            fr = blur(fr, boxes)
        if mask:
            fr = blur(fr, [[0, H * (1 - mask), W, H]])
        enc.stdin.write(fr.tobytes())
    enc.stdin.close()
    enc.wait()
    found = sum(len(v) for v in sampled.values())
    return f"{os.path.basename(out)}: {found} detections, {nblur} frames blurred"


def shift(lat, lon):
    d = rng.uniform(*SHIFT_KM)
    a = rng.uniform(0, 2 * math.pi)
    nlat = lat + d * math.cos(a) / 110.574
    nlon = lon + d * math.sin(a) / (111.320 * math.cos(math.radians(lat)))
    return f"{nlat:.4f}", f"{nlon:.4f}"


def plan_event(src_dir, out_dir, face, lp, every, masks):
    ev = json.load(open(os.path.join(src_dir, "event.json")))
    t_ev = datetime.fromisoformat(ev["timestamp"])
    clips = {}
    for f in os.listdir(src_dir):
        m = STAMP.match(f)
        if m:
            clips.setdefault(m.group(1), {})[m.group(2)] = os.path.join(src_dir, f)
    spans_ = []
    for s, cams in sorted(clips.items()):
        st = parse_stamp(s)
        dur = max(probe_duration(p) for p in cams.values())
        spans_.append((st, st + timedelta(seconds=dur), cams))
    first, last = spans_[0][0], spans_[-1][1]
    w0 = max(first, t_ev - timedelta(seconds=BEFORE))
    w1 = min(last, w0 + timedelta(seconds=WINDOW))
    w0 = max(first, w1 - timedelta(seconds=WINDOW))
    os.makedirs(out_dir, exist_ok=True)
    jobs = []
    for st, en, cams in spans_:
        a, b = max(st, w0), min(en, w1)
        if (b - a).total_seconds() < 1:
            continue
        stamp = a.strftime("%Y-%m-%d_%H-%M-%S")
        for cam, path in cams.items():
            jobs.append((path, (a - st).total_seconds(), (b - a).total_seconds(),
                         os.path.join(out_dir, f"{stamp}-{cam}.mp4"), face, lp, every,
                         masks.get(cam)))
    # event.json with moved location
    new = dict(ev)
    if ev.get("est_lat") and ev.get("est_lon"):
        new["est_lat"], new["est_lon"] = shift(float(ev["est_lat"]), float(ev["est_lon"]))
    if "city" in ev:
        new["city"] = rng.choice(NAMES)
    if ev.get("street"):
        new["street"] = rng.choice(STREETS)
    with open(os.path.join(out_dir, "event.json"), "w") as fh:
        json.dump(new, fh, indent="\t")
    return jobs, t_ev


def thumb(out_dir, t_ev):
    fronts = sorted(f for f in os.listdir(out_dir) if f.endswith("-front.mp4"))
    pick, off = fronts[0], 0.0
    for f in fronts:
        st = parse_stamp(f[:19])
        if st <= t_ev:
            pick, off = f, (t_ev - st).total_seconds()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{off:.2f}",
                    "-i", os.path.join(out_dir, pick), "-frames:v", "1",
                    "-vf", "scale=128:96", os.path.join(out_dir, "thumb.png")],
                   check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--face")
    ap.add_argument("--lp")
    ap.add_argument("--every", type=int, default=4)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--only", help="process only event folders containing this text")
    ap.add_argument("--mask", action="append", default=[], metavar="CAMERA:FRACTION",
                    help="always blur the bottom FRACTION of a camera, e.g. back:0.28 "
                         "where your own car (and its markings) shows")
    a = ap.parse_args()
    if bool(a.face) != bool(a.lp):
        ap.error("--face and --lp go together")
    masks = {c: float(f) for c, f in (m.split(":") for m in a.mask)}
    events, jobs = [], []
    for cat in ("SavedClips", "SentryClips"):
        base = os.path.join(a.src, cat)
        for name in sorted(os.listdir(base)) if os.path.isdir(base) else []:
            if a.only and a.only not in name:
                continue
            out_dir = os.path.join(a.out, cat, name)
            j, t_ev = plan_event(os.path.join(base, name), out_dir, a.face, a.lp, a.every, masks)
            jobs += j
            events.append((out_dir, t_ev))
    print(f"{len(events)} events, {len(jobs)} files", flush=True)
    with ProcessPoolExecutor(a.jobs) as pool:
        for msg in pool.map(process, jobs):
            print(msg, flush=True)
    for out_dir, t_ev in events:
        thumb(out_dir, t_ev)


if __name__ == "__main__":
    main()
