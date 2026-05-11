# Shadow Smith Project

A 2D puzzle-platformer built with **HTML5 Canvas + JavaScript** where **light creates playable shadows**.

---

## Gameplay Overview

In **Shadow Smith**, the player must:
1. **Collect the Key** to unlock the Flag.
2. **Reach the Flag** to clear the level.
3. Avoid being **SCANNED** by the light (when scanned, finishing is blocked).
4. Use **rotating light** to change shadow geometry: **shadows become platforms**.

The game contains **10 levels** with increasing difficulty and includes **checkpoints** and **best records** saved locally.

---

## Controls

- **Move:** `A/D` or `Left/Right Arrow`
- **Jump:** `W` / `Up Arrow` / `Space`
- **Dash:** `Shift`
- **Rotate Light:** `Q` / `E`
- **Start (Menu):** `Enter`
- **Restart Level:** `R`
- **Next Level (after win):** `N`
- **Mute:** `M`
- **Reduce Camera Shake:** `V`

> Tip: Click the canvas once to focus keyboard input and enable audio (browser autoplay policy).

---

## Features (Graphics + Gameplay)

### Computer Graphics / Rendering Concepts
- **Light cone rendering** (2D cone with gradient)
- **Line-of-sight checks** (light blocked by world geometry)
- **Dynamic shadow platform generation** (procedural shadow tiles)
- **Camera transform** (smooth follow + optional shake)
- **Particles** (key pickup, checkpoint activation, win effects)
- **Animated background** (stars + vignette)

### Gameplay Systems
- **10 levels** with progression
- **Dash**, **wall slide**, **wall jump**
- **Coyote time** + **jump buffer** for better platforming feel
- **Checkpoint system**
- **Local best records** using `localStorage` (time + rotations)
- **Safe Zone** near the finish flag to prevent unfair scanning

---

## How to Run Locally

You can run the game by opening `index.html` in a browser.

For best results (module loading & consistent behavior), you can use a local server:
- VS Code: **Live Server** extension
- or any simple HTTP server
