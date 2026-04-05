# Design System Specification: Editorial Security & Tonal Depth

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Fortified Vault."** 

Unlike traditional security applications that feel cold, clinical, or overly "tech-heavy," this system prioritizes a high-end editorial feel. We move beyond the "template" look by using intentional white space, asymmetrical layouts, and a sophisticated layering of surfaces. The goal is to make the user feel protected not by rigid steel bars (borders), but by an intelligent, seamless environment. We balance the authority of **Dark Imperial Blue** with the kinetic energy of **Orange**, creating an experience that feels both impenetrable and incredibly responsive.

---

## 2. Colors & Surface Architecture
This system rejects the "flat" web. We use color to define physical space and importance.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or containment. 
Boundaries must be defined solely through background color shifts. For example, a `surface-container-low` section sitting on a `surface` background creates a natural, sophisticated edge.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the Material tokens to create "nested" depth:
*   **Base:** `surface` (#f8f9ff)
*   **Secondary Content Area:** `surface-container-low` (#eff4ff)
*   **Interactive Cards:** `surface-container-lowest` (#ffffff)
*   **Elevated Overlays:** `surface-container-highest` (#d3e4fe)

### The "Glass & Gradient" Rule
To elevate the "out-of-the-box" Material look:
*   **Glassmorphism:** Use semi-transparent versions of `secondary` (#00157f) with a `backdrop-blur` of 20px–40px for floating headers or navigation bars.
*   **Signature Textures:** Apply subtle linear gradients (e.g., `primary` #855400 to `primary-container` #ffa500) for hero CTAs to add "soul" and a premium tactile feel.

---

## 3. Typography
We use **Inter** as a functional workhorse, but we treat it with editorial intent.

*   **Display Scale (`display-lg` to `display-sm`):** Use these for high-impact balance. Large, bold numbers for security scores or balances should use `display-md` to establish immediate authority.
*   **Headline & Title:** Use `headline-sm` (1.5rem) for section headers. Always pair these with generous `top-margin` (Spacing 8 or 10) to create a "magazine" feel.
*   **Body & Label:** Use `body-md` (0.875rem) for general information. For legal or "secure" fine print, use `label-sm` with increased letter spacing (0.05rem) to maintain readability despite the small size.

**The Tonal Mix:** Headers should almost exclusively use `on-secondary-container` (#1a2a8e) to feel authoritative, while body text uses `on-surface-variant` (#534433) to reduce visual fatigue.

---

## 4. Elevation & Depth
In this system, depth is a feeling, not a drop shadow.

*   **The Layering Principle:** Stack `surface-container` tiers. A `surface-container-lowest` card placed on a `surface-container-low` background creates a soft, natural lift.
*   **Ambient Shadows:** If an element must "float" (like a FAB or a Modal), use an extra-diffused shadow: `blur: 32px`, `y-offset: 8px`, `opacity: 6%`. The shadow color must be a tinted version of `on-surface` (#0b1c30), never pure black.
*   **The "Ghost Border" Fallback:** If accessibility requires a border, use `outline-variant` (#d9c3ac) at **15% opacity**. This provides a hint of structure without breaking the editorial flow.

---

## 5. Components

### Buttons & CTAs
*   **Primary:** Background: `primary-container` (#ffa500); Text: `on-primary-container` (#684000). Use `Rounded-md` (0.75rem).
*   **Secondary:** Background: `secondary-fixed` (#dfe0ff); Text: `on-secondary-fixed` (#000d5f).
*   **Tactile Feedback:** On press, buttons should transition to their "dim" variant (e.g., `primary-fixed-dim`).

### Cards & Lists
*   **The "No-Divider" Mandate:** Forbid the use of horizontal divider lines. Separate list items using `Spacing-4` (1rem) of vertical white space or by alternating background tones from `surface-container-low` to `surface-container-lowest`.
*   **Security Cards:** Use `xl` (1.5rem) rounded corners for main dashboard cards to evoke a "friendly but solid" shield feeling.

### Input Fields
*   **States:** Background should be `surface-container-low`. Upon focus, the background shifts to `surface-container-lowest` and a "Ghost Border" of `primary` appears at 20% opacity.
*   **Error State:** Use `error` (#ba1a1a) text paired with an `error-container` (#ffdad6) background.

### Custom Security Components
*   **The Biometric Shield:** A large, circular `surface-container-highest` element with a `primary` (#855400) icon, using a soft pulse animation created via a 10% opacity `surface-tint` expansion.

---

## 6. Do's and Don'ts

### Do
*   **Do** embrace asymmetry. Place a headline on the left and a CTA slightly offset to create a premium, custom feel.
*   **Do** use `surface-dim` (#cbdbf5) for inactive or background states to keep the UI from feeling "empty."
*   **Do** use the full `Roundedness Scale`. Use `xl` for large containers and `sm` for small tags/chips to create visual hierarchy.

### Don't
*   **Don't** use 100% opaque black (#000000) for text. Use `on-surface` (#0b1c30) to maintain tonal richness.
*   **Don't** use "Standard" Material shadows. If it looks like a default Android app, it has failed the editorial requirement.
*   **Don't** cram information. If a screen feels crowded, increase the spacing between sections to `Spacing-12` (3rem). Secure apps should feel "calm."

### Accessibility Note
Ensure all `primary` (#FFA500) text elements are checked against `on-primary-container` (#684000) or `on-surface` (#0b1c30) for a minimum 4.5:1 contrast ratio. For UI elements that are purely decorative, a lower contrast is acceptable if the functional path remains clear.