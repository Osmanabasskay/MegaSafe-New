-- Migration: sierra_leone_regions
-- Creates country_regions table, seeds Sierra Leone cities & provinces,
-- deploys get_country_regions() SECURITY DEFINER RPC.

-- ── 1. TABLE ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.country_regions (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id       UUID    NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  name             TEXT    NOT NULL,
  region_type      TEXT    NOT NULL CHECK (region_type IN ('city', 'province', 'district')),
  parent_region_id UUID    REFERENCES public.country_regions(id) ON DELETE SET NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (country_id, name, region_type)
);

CREATE INDEX IF NOT EXISTS idx_country_regions_country_type
  ON public.country_regions (country_id, region_type)
  WHERE is_active = TRUE;

-- ── 2. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.country_regions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "country_regions_select_active" ON public.country_regions;
CREATE POLICY "country_regions_select_active"
  ON public.country_regions FOR SELECT
  TO authenticated, anon
  USING (is_active = TRUE);

-- ── 3. SEED — Sierra Leone provinces ──────────────────────────────────────
WITH sl AS (SELECT id FROM public.countries WHERE code = 'SL')
INSERT INTO public.country_regions (country_id, name, region_type, sort_order)
SELECT sl.id, v.name, 'province', v.srt
FROM sl
CROSS JOIN (VALUES
  (0, 'Western Area'),
  (1, 'Northern Province'),
  (2, 'North West Province'),
  (3, 'Eastern Province'),
  (4, 'Southern Province')
) AS v(srt, name)
ON CONFLICT (country_id, name, region_type) DO NOTHING;

-- ── 4. SEED — Sierra Leone cities (DO block resolves parent UUIDs) ─────────
DO $$
DECLARE
  sl_id        UUID;
  western_id   UUID;
  northern_id  UUID;
  northwest_id UUID;
  eastern_id   UUID;
  southern_id  UUID;
BEGIN
  SELECT id INTO sl_id FROM public.countries WHERE code = 'SL';
  IF sl_id IS NULL THEN
    RAISE NOTICE 'Sierra Leone not found in countries table — skipping city seed';
    RETURN;
  END IF;

  SELECT id INTO western_id   FROM public.country_regions WHERE country_id=sl_id AND name='Western Area'        AND region_type='province';
  SELECT id INTO northern_id  FROM public.country_regions WHERE country_id=sl_id AND name='Northern Province'   AND region_type='province';
  SELECT id INTO northwest_id FROM public.country_regions WHERE country_id=sl_id AND name='North West Province' AND region_type='province';
  SELECT id INTO eastern_id   FROM public.country_regions WHERE country_id=sl_id AND name='Eastern Province'    AND region_type='province';
  SELECT id INTO southern_id  FROM public.country_regions WHERE country_id=sl_id AND name='Southern Province'   AND region_type='province';

  INSERT INTO public.country_regions (country_id, name, region_type, parent_region_id, sort_order) VALUES
    -- Western Area
    (sl_id, 'Freetown',    'city', western_id,   0),
    (sl_id, 'Waterloo',    'city', western_id,   1),
    (sl_id, 'Hastings',    'city', western_id,   2),
    (sl_id, 'Wellington',  'city', western_id,   3),
    (sl_id, 'Lumley',      'city', western_id,   4),
    -- Northern Province
    (sl_id, 'Makeni',      'city', northern_id,  0),
    (sl_id, 'Kabala',      'city', northern_id,  1),
    (sl_id, 'Magburaka',   'city', northern_id,  2),
    (sl_id, 'Binkolo',     'city', northern_id,  3),
    (sl_id, 'Kamabai',     'city', northern_id,  4),
    -- North West Province
    (sl_id, 'Port Loko',   'city', northwest_id, 0),
    (sl_id, 'Kambia',      'city', northwest_id, 1),
    (sl_id, 'Lunsar',      'city', northwest_id, 2),
    (sl_id, 'Rokupr',      'city', northwest_id, 3),
    (sl_id, 'Mange',       'city', northwest_id, 4),
    -- Eastern Province
    (sl_id, 'Kenema',      'city', eastern_id,   0),
    (sl_id, 'Koidu',       'city', eastern_id,   1),
    (sl_id, 'Kailahun',    'city', eastern_id,   2),
    (sl_id, 'Segbwema',    'city', eastern_id,   3),
    (sl_id, 'Pendembu',    'city', eastern_id,   4),
    -- Southern Province
    (sl_id, 'Bo',          'city', southern_id,  0),
    (sl_id, 'Moyamba',     'city', southern_id,  1),
    (sl_id, 'Bonthe',      'city', southern_id,  2),
    (sl_id, 'Pujehun',     'city', southern_id,  3),
    (sl_id, 'Mattru Jong', 'city', southern_id,  4)
  ON CONFLICT (country_id, name, region_type) DO NOTHING;
END;
$$;

-- ── 5. RPC — get_country_regions ──────────────────────────────────────────
-- Returns { cities: [{id, name, province_id, province_name}], provinces: [{id, name}] }
-- SECURITY DEFINER so RLS on country_regions is bypassed (table is already open
-- to anon SELECT, but DEFINER ensures no future RLS change can break the picker).
CREATE OR REPLACE FUNCTION public.get_country_regions(p_country_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'cities', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',            c.id,
          'name',          c.name,
          'province_id',   c.parent_region_id,
          'province_name', p.name
        )
        ORDER BY c.sort_order, c.name
      )
      FROM public.country_regions c
      LEFT JOIN public.country_regions p ON p.id = c.parent_region_id
      WHERE c.country_id = p_country_id
        AND c.region_type = 'city'
        AND c.is_active = TRUE
    ), '[]'::jsonb),
    'provinces', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', r.id, 'name', r.name)
        ORDER BY r.sort_order, r.name
      )
      FROM public.country_regions r
      WHERE r.country_id = p_country_id
        AND r.region_type = 'province'
        AND r.is_active = TRUE
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_country_regions(UUID) TO authenticated, anon;
