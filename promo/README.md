# Promo intro/outro for X

- `nonna-intro.mp4` (4s) and `nonna-outro.mp4` (4s): 1920x1080, 30fps, H.264 + AAC.
- `./promo/splice.sh <screen-recording.mov> [out.mp4]` joins intro + recording + outro (recording is letterboxed to 1080p; silence added if it has no audio).
- Sound: synthesized in `audio.py` (original, royalty-free) plus `assets/sounds/shout-1.mp3` (project-owned, MIT).
- Rebuild: `python3 audio.py intro intro.wav && python3 render.py intro 4 intro.wav nonna-intro.mp4` (same for `outro`); paths inside the scripts point at extracted frames and need adjusting.
