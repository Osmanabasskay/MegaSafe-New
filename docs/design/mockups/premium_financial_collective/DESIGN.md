---
name: Premium Financial Collective
colors:
  surface: '#0f1419'
  surface-dim: '#0f1419'
  surface-bright: '#353940'
  surface-container-lowest: '#0a0f14'
  surface-container-low: '#181c21'
  surface-container: '#1c2026'
  surface-container-high: '#262a30'
  surface-container-highest: '#31353b'
  on-surface: '#dfe2ea'
  on-surface-variant: '#c6c5d4'
  inverse-surface: '#dfe2ea'
  inverse-on-surface: '#2c3137'
  outline: '#8f8f9e'
  outline-variant: '#454652'
  surface-tint: '#bbc3ff'
  primary: '#bbc3ff'
  on-primary: '#102287'
  primary-container: '#00157f'
  on-primary-container: '#7887ec'
  inverse-primary: '#4655b7'
  secondary: '#ffcb8d'
  on-secondary: '#462a00'
  secondary-container: '#ffa504'
  on-secondary-container: '#684100'
  tertiary: '#c6c6c7'
  on-tertiary: '#2f3131'
  tertiary-container: '#262828'
  on-tertiary-container: '#8e8f8f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dfe0ff'
  primary-fixed-dim: '#bbc3ff'
  on-primary-fixed: '#000d5f'
  on-primary-fixed-variant: '#2d3c9e'
  secondary-fixed: '#ffddb7'
  secondary-fixed-dim: '#ffb95c'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#0f1419'
  on-background: '#dfe2ea'
  surface-variant: '#31353b'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 16px
  margin-mobile: 20px
  margin-desktop: 120px
---

## Brand & Style
The design system is anchored in the concept of communal prosperity and modern security. It targets a demographic that values both the heritage of traditional contribution clubs (Osusu) and the precision of contemporary fintech. 

The aesthetic is a hybrid of **Corporate Modern** and **Glassmorphism**. It utilizes high-contrast surfaces to delineate between "Focus" states (white, form-heavy administrative tasks) and "Brand" states (deep imperial blue, immersive onboarding, and dashboard highlights). The emotional goal is to evoke a sense of "digital vaults"—solid, impenetrable, yet transparent and fluid in motion.

## Colors
The palette is dominated by **Dark Imperial Blue (#00157F)**, serving as the foundational environment for high-value displays and immersive brand moments. 

- **Primary Action (Orange):** #FFA500 is reserved exclusively for the most critical path actions: "Commit," "Save," and "Transfer." It must never be used for background decorative elements to maintain its functional urgency.
- **Surface (White):** Used as a secondary "Light Mode" canvas for complex forms, data entry, and legal documentation to ensure maximum legibility and a sense of cleanliness.
- **Accents:** Use varying opacities of White (10%, 20%) over the Blue background to create glass-like depth without introducing new hues.

## Typography
The system employs **Hanken Grotesk** for headlines to provide a sharp, contemporary edge that feels premium. **Inter** is used for all functional body text and labels to ensure maximum utility and accessibility across high-density financial data.

For financial figures and balances, use `headline-lg` with `medium` weight to ensure prominence. All labels should be set in medium or semi-bold weight to distinguish them from user-inputted data.

## Layout & Spacing
The system follows a strict **8px spacing scale**. 

- **Mobile:** 4-column fluid grid with 20px side margins and 16px gutters.
- **Desktop:** 12-column fixed grid (max-width 1280px) with 24px gutters.

Layouts should prioritize vertical rhythm. Use `lg` (40px) spacing between major sections and `md` (24px) for internal component padding. On dark blue screens, use generous whitespace (negative space) to emphasize the "Premium" feel; on white form-based screens, the layout may be tighter to improve information density.

## Elevation & Depth
Elevation is handled differently depending on the background:

1.  **On Dark Imperial Blue:** Depth is created through **Tonal Layering**. Elevated surfaces (like cards) use a slightly lighter shade of blue or a semi-transparent glass effect (Backdrop Blur: 20px) with a subtle 1px inner border (white at 10% opacity) to simulate a glass edge.
2.  **On White Surfaces:** Depth is created through **Ambient Shadows**. Use a very soft, multi-layered shadow with a hint of the primary blue in the tint: `0 10px 30px rgba(0, 21, 127, 0.05)`.
3.  **Active States:** Buttons and inputs should appear "lifted" using a more pronounced shadow or an outer glow in the case of the Orange primary button.

## Shapes
This design system uses a pronounced **Rounded (0.5rem / 16px+)** language to convey friendliness and modern accessibility.

- **Standard Containers:** 16px radius.
- **Large Cards & Sections:** 24px radius (`rounded-xl`).
- **Input Fields:** 12px radius to maintain a balance between the soft exterior and structured interior.
- **Interactive Accents:** Progress bar caps and tags use "Full Rounding" (Pill-shaped) to distinguish them from structural elements.

## Components
- **Buttons:** Primary buttons are solid Orange (#FFA500) with white or dark blue text. They feature a 16px corner radius. Secondary buttons on dark backgrounds should be "Ghost" style with a 1px white border.
- **Input Fields:** On white screens, use a "High-Contrast" style: 1.5px border in Dark Imperial Blue when focused. On dark screens, use a filled style (White at 10% opacity) with white text.
- **Progress Bars:** Use a thick 8px track. The background track is White at 10% opacity, and the "fill" is solid Orange.
- **Status Indicators:** 
    - *Success:* Emerald Green (not in primary palette, but functional).
    - *Pending/Warning:* Secondary Orange.
    - *Error:* Vibrant Red.
- **Cards:** Dashboard cards on the Dark Blue background must use a subtle gradient (Deep Blue to slightly lighter Blue) to ensure they are distinguishable from the base canvas.
- **Chips/Tags:** Used for "Contribution Categories." These should be pill-shaped with a font weight of 600.