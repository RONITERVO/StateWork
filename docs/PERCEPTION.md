# One meaning, many ways through it

StateWork does not assume that a person wants a calendar grid, can read a spatial map, hears sound, perceives color, sees a screen, can drag an object, or can act before a timer expires. Preferences are capabilities and choices, not diagnoses. They live outside shared work semantics.

The reference client is a starting point, not a claim that every person or device has been accommodated. Automated checks cannot establish real screen-reader, braille, switch, gaze, speech or haptic usability. Those require user and device testing.

## Shared semantic surface

An `Observation` contains stable IDs, readable labels, a linear ordering, factual state, relationships, legal action descriptions and navigation targets. Every nontext adapter should preserve a direct mapping back to those IDs. A layout can disappear or change without making work unreachable.

The same item can be a DOM button, spoken choice, braille label, tactile cue or 3D object. Selecting it leads to the same ID. Executing an action passes a validated command through the same authority and version checks. Color, position, pitch, texture and motion may reinforce meaning but must not be its only representation.

| Layer | Foundation provided | Adapter responsibility |
| --- | --- | --- |
| Text / screen reader | Labeled facts, summaries, relationships, DOM reference, keyboard order | Reader-specific testing, pronunciation, verbosity and orientation |
| Visual / color preferences | List/board/timeline/map, labels beyond color, high contrast | Your color system, magnification, graphical density |
| Low information density | Brief profile, pages, one-task focus, no mandatory timing | Personal prioritization and pacing |
| Speech / audio | Text-to-speech input, semantic cues, opt-in local browser voice | Voice availability, local synthesis, spatial audio, earcons and explicit consent |
| Braille / tactile | Ordered strings, stable IDs, semantic cue data | Translation, device driver, routing keys, tactile vocabulary |
| Switch / keyboard | Sequential navigation targets, labeled actions, untimed forms | Single-switch scanning and dwell settings; reference browser uses standard Tab navigation |
| Gaze / alternative motor input | Stable action targets and IDs; no drag requirement | Calibration, dwell, confirmation and device-specific hit targets |
| Spatial / XR | Deterministic 3D projection with labels and semantic links | XR rendering, comfort, locomotion, reachable targets and hardware testing |
| Agents / automation | Structured observations, same commands, real MCP tools | Intent, permissions and safe handling of untrusted work text |

## Profile and adapter contract

```ts
interface PerceptionAdapter<T> {
  id: string;
  contractVersion: 1;
  output: string[];
  input: string[];
  requires: string[];
  render(observation: Observation, profile: PerceptionProfile): T;
}
```

Profiles specify output and input channel IDs, `detail`, `motion`, `contrast`, language, display zone, text scale (1–2) and maximum item count. Output/input IDs are extensible, e.g. `haptic`, `braille`, `spatial`, `example.org/device`. Adapter IDs and namespaces do not fetch code. Only trusted host code registers and calls an adapter. Saved `renderer` strings are preferences, never script paths; the reference client falls back to text for unknown renderers.

`negotiate(adapter, profile, availableCapabilities)` returns support and explicit reasons. It requires at least one matching output channel, at least one matching input method, and every required device capability. An adapter accepting preferences still has to implement them; negotiation is not proof of accessibility. Never silently enable sound, vibration, motion or timed input after negotiation.

The supplied `textAdapter` emits text consumable by a speech or braille adapter; it does not drive either device. `spatialAdapter` returns a stable layout for a given ordered observation; it is presentational, may change when the query changes, and contains no authoritative geometry. `cueFor` emits a text-backed semantic cue with `interrupt: false`. [Run the example](../examples/perception.mjs) to see negotiation failure and a text fallback without activating hardware.

## Navigation patterns

- A linear reader follows `navigation.next` and `previous`. Preserve current item ID across refreshed observations when it still exists.
- A context reader offers parent, children, prerequisites and reverse relationship links.
- A spatial renderer binds pick targets to IDs and provides a textual index. The reference map includes the linked connection list below the SVG.
- A switch adapter can scan actions; it must skip or explain disabled actions and use explicit confirmation according to the person's preferences. No fixed dwell timing belongs in the domain.
- A device adapter can express an observation through multiple output channels. Do not infer that absence of an output channel means loss of input capability.

## Reference behavior

The client uses native inputs, buttons, dialog focus containment, a skip link, explicit labels, live save/error messages and standard keyboard navigation. Search has Ctrl/⌘+K; it is suppressed while a dialog is open. No action depends on hover, color, audio or dragging. CSS honors reduced motion; the default experience has no animation. Work is escaped before insertion into HTML, and unknown extensions are never rendered as markup.

Time zone and wording localization remain adapter concerns. The current UI and built-in text summaries are English. `language` is a preference contract and selects a local speech voice when available; it does not claim a translated UI. Browser speech is opt-in, uses an explicitly local voice, and may be unavailable. Native speech input, single-switch scanning, physical braille/haptics and XR are not implemented in the reference client.

Design reference: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/), particularly text alternatives, sensory characteristics, keyboard access, reflow and focus. The test record documents checks performed; no blanket WCAG conformance certification is claimed.
