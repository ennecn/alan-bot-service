# Alan Custom Emotions Model

This document formalizes the current minimal emotion model used by Alan.

## Base Set (Minimal Core)

Alan keeps a fixed 6D core for deterministic behavior calculations:

- `joy`
- `sadness`
- `anger`
- `anxiety`
- `longing`
- `trust`

These six dimensions are the only direct inputs to:

- emotion decay/update
- memory pool pressure
- impulse firing
- delivery mode selection

## Custom Emotions

Cards may define `extensions.behavioral_engine.custom_emotions`.

Each custom emotion has:

- `range: [min, max]`
- `baseline: number`
- `projection?: Partial<Record<EmotionDimension, number>>`

`custom_state` is persisted in `emotion_state.md` and updated each turn:

1. decay toward baseline (slow half-life)
2. apply System1 `custom_deltas`
3. clamp to configured range

## Combination Mechanism

Combination into behavior happens via projection:

- If `projection` exists, custom shift maps to the 6D core using provided weights.
- If omitted, engine uses a conservative name-based heuristic projection.

Multiple custom emotions combine additively on the 6D core (with clamping), then the core drives downstream behavior.

## Design Intent

- Keep deterministic core small and stable.
- Allow open-ended custom semantics without rewriting engine math.
- Make custom emotion behavior configurable per card via `projection`.
