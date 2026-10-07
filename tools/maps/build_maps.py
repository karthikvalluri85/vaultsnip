#!/usr/bin/env python3
"""Builds web/maps/*.json (simplified region outlines for map visuals) from Natural Earth.

Natural Earth is public domain (https://www.naturalearthdata.com).
Needs: python3, node + npx (installs mapshaper on first run), internet access to GitHub.

    python3 tools/maps/build_maps.py

Each output file is a GeoJSON FeatureCollection. Every feature has:
  name  display name           a   lowercase aliases (names, ISO and postal codes)
  cp    label point [lon, lat] bb  bbox of the main landmass [minx, miny, maxx, maxy]
The collection carries "vs": {"title", "groups": {group: [region names]}, "moves": [...]}.
"""
import json, os, re, subprocess, sys, tempfile, unicodedata, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'web', 'maps')
CACHE = os.path.join(tempfile.gettempdir(), 'vaultsnip-ne')
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
# The world outline uses Natural Earth's India point of view, matching official Indian boundaries.
WORLD_SRC = 'ne_10m_admin_0_countries_ind'
ADM1_SRC = 'ne_10m_admin_1_states_provinces'


def fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name + '.geojson')
    if not os.path.exists(p):
        print('downloading', name)
        urllib.request.urlretrieve(NE + name + '.geojson', p)
    return p


def mapshaper(args):
    subprocess.run(['npx', '-y', 'mapshaper@0.7', '-quiet'] + args, check=True)


def fold(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r"[^a-z0-9& ]+", ' ', s)).strip()


def aliases(props, keys, extra=()):
    out = []
    for k in keys:
        v = props.get(k)
        if not v or v in ('-99', -99):
            continue
        for part in str(v).split('|'):
            f = fold(part)
            if f and f not in out:
                out.append(f)
    for e in extra:
        f = fold(e)
        if f and f not in out:
            out.append(f)
    return out


def rings(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def ring_area(r):
    return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))) / 2


def main_bbox(geom):
    polys = rings(geom)
    if not polys:
        return None
    big = max(polys, key=lambda p: ring_area(p[0]))
    xs = [c[0] for c in big[0]]; ys = [c[1] for c in big[0]]
    return [round(min(xs), 2), round(min(ys), 2), round(max(xs), 2), round(max(ys), 2)]


def transform_geom(geom, fn):
    def walk(c):
        if isinstance(c[0], (int, float)):
            return list(fn(c[0], c[1]))
        return [walk(x) for x in c]
    geom['coordinates'] = walk(geom['coordinates'])


def simplify(src, dst, where=None, dissolve=None, pct='4%', clip=None, extra=(), sliver='20km2', each=None):
    args = ['-i', src]
    if where:
        args += ['-filter', where]
    if each:
        args += ['-each', each]
    if dissolve:
        args += ['-dissolve', 'fields=' + dissolve, 'copy-fields=' + ','.join(extra) if extra else '']
        args = [a for a in args if a]
    if clip:
        args += ['-clip', 'bbox=' + ','.join(map(str, clip))]
    args += ['-simplify', 'visvalingam', 'weighted', pct, 'keep-shapes', '-filter-slivers', 'min-area=' + sliver,
             '-o', 'format=geojson', 'precision=0.01', dst]
    mapshaper(args)
    return json.load(open(dst))


def write(name, title, feats, groups=None, moves=None):
    fc = {'type': 'FeatureCollection', 'vs': {'title': title, 'groups': groups or {}, 'moves': moves or []}, 'features': feats}
    p = os.path.join(OUT, name + '.json')
    with open(p, 'w') as f:
        json.dump(fc, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{name:14s} {len(feats):4d} regions {os.path.getsize(p) / 1024:7.1f} KB')


WORLD_EXTRA = {
    'United States of America': ['usa', 'us', 'u s', 'u s a', 'america', 'united states'],
    'United Kingdom': ['uk', 'u k', 'great britain', 'britain', 'england', 'gb', 'scotland', 'wales'],
    'Russia': ['russian federation'], 'South Korea': ['korea', 'republic of korea', 'korea south'],
    'North Korea': ['dprk', 'korea north'], 'Czechia': ['czech republic'], 'Netherlands': ['holland', 'the netherlands'],
    'Turkey': ['turkiye'], "Côte d'Ivoire": ['ivory coast'], 'Vietnam': ['viet nam'], 'United Arab Emirates': ['uae'],
    'Bosnia and Herz.': ['bosnia', 'bosnia and herzegovina'], 'Dem. Rep. Congo': ['drc', 'dr congo', 'democratic republic of the congo'],
    'Congo': ['republic of the congo'], 'eSwatini': ['swaziland', 'eswatini'], 'Macedonia': ['north macedonia'],
    'China': ['prc', 'mainland china'], 'Taiwan': ['taiwan province of china'], 'Ireland': ['eire', 'republic of ireland'],
}
WORLD_GROUPS = {
    'Nordics': ['Denmark', 'Finland', 'Iceland', 'Norway', 'Sweden'], 'Scandinavia': ['Denmark', 'Norway', 'Sweden'],
    'Benelux': ['Belgium', 'Netherlands', 'Luxembourg'], 'DACH': ['Germany', 'Austria', 'Switzerland'],
    'Iberia': ['Spain', 'Portugal'], 'Baltics': ['Estonia', 'Latvia', 'Lithuania'], 'UK & Ireland': ['United Kingdom', 'Ireland'],
    'GCC': ['Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Kuwait', 'Oman', 'Bahrain'], 'ANZ': ['Australia', 'New Zealand'],
    'North America': ['United States of America', 'Canada', 'Mexico'], 'DACH region': ['Germany', 'Austria', 'Switzerland'],
}


def build_world():
    src = fetch(WORLD_SRC)
    tmp = os.path.join(CACHE, 'world.json')
    d = simplify(src, tmp, pct='1.6%')
    feats, groups = [], dict(WORLD_GROUPS)
    for f in d['features']:
        p = f['properties']
        name = p.get('NAME') or p.get('ADMIN')
        if p.get('ADM0_A3') == 'ATA' or not f.get('geometry'):
            continue
        al = aliases(p, ['NAME', 'NAME_LONG', 'ADMIN', 'NAME_EN', 'FORMAL_EN', 'ABBREV', 'ISO_A2_EH', 'ISO_A3_EH', 'ADM0_A3', 'GEOUNIT', 'SUBUNIT'], WORLD_EXTRA.get(name, []))
        al = [a for a in al if a not in ('99',)]
        cp = [round(p['LABEL_X'], 2), round(p['LABEL_Y'], 2)] if p.get('LABEL_X') is not None else None
        for g in (p.get('CONTINENT'), p.get('SUBREGION'), p.get('REGION_WB')):
            if g and g not in ('Seven seas (open ocean)', 'Antarctica'):
                groups.setdefault(g, []).append(name)
        feats.append({'type': 'Feature', 'properties': {'name': name, 'a': al, 'cp': cp, 'bb': main_bbox(f['geometry'])}, 'geometry': f['geometry']})
    groups['EMEA'] = sorted(set(groups.get('Europe', []) + groups.get('Africa', []) + groups.get('Middle East & North Africa', [])))
    groups['APAC'] = sorted(set(groups.get('Asia', []) + groups.get('Oceania', [])) - set(groups.get('Middle East & North Africa', [])))
    groups['LATAM'] = sorted(set(groups.get('South America', []) + groups.get('Latin America & Caribbean', [])))
    groups['MENA'] = groups.get('Middle East & North Africa', [])
    write('world', 'World (countries)', feats, groups)
    # Europe: the same countries, clipped to the continent
    eu = os.path.join(CACHE, 'europe.json')
    d = simplify(src, eu, where="CONTINENT=='Europe' || ['TUR','CYP','GEO','ARM','AZE','ISR','MAR','DZA','TUN','EGY','LBY'].indexOf(ADM0_A3)>-1", clip=[-25, 33, 45, 72], pct='6%')
    feats2 = []
    names = {x['properties']['name']: x for x in feats}
    for f in d['features']:
        p = f['properties']; name = p.get('NAME') or p.get('ADMIN')
        if not f.get('geometry'):
            continue
        w = names.get(name)
        props = dict(w['properties']) if w else {'name': name, 'a': [fold(name)]}
        props['bb'] = main_bbox(f['geometry'])
        cp = props.get('cp'); b = props['bb']
        if not cp or not (-25 <= cp[0] <= 45 and 33 <= cp[1] <= 72):
            props['cp'] = [round((b[0] + b[2]) / 2, 2), round((b[1] + b[3]) / 2, 2)]
        feats2.append({'type': 'Feature', 'properties': props, 'geometry': f['geometry']})
    eg = {k: v for k, v in groups.items() if k in WORLD_GROUPS or k in ('Western Europe', 'Northern Europe', 'Southern Europe', 'Eastern Europe')}
    write('europe', 'Europe (countries)', feats2, eg)


ADM1_KEYS = ['name', 'name_en', 'name_alt', 'gn_name', 'woe_name', 'name_local', 'postal', 'iso_3166_2', 'abbrev']


def adm1_aliases(p):
    al = aliases(p, ADM1_KEYS)
    iso = p.get('iso_3166_2') or ''
    if '-' in iso:
        al.append(fold(iso.split('-', 1)[1]))
    return list(dict.fromkeys(a for a in al if a))


COUNTRIES = [
    # file, title, ISO3, dissolve field (None = keep admin-1), simplification
    ('usa', 'United States (states)', 'USA', None, '3%'),
    ('canada', 'Canada (provinces)', 'CAN', None, '1.5%'),
    ('mexico', 'Mexico (states)', 'MEX', None, '5%'),
    ('brazil', 'Brazil (states)', 'BRA', None, '4%'),
    ('uk', 'United Kingdom (regions)', 'GBR', 'ukreg', '6%'),
    ('france', 'France (regions)', 'FRA', 'region', '6%'),
    ('germany', 'Germany (states)', 'DEU', None, '8%'),
    ('italy', 'Italy (regions)', 'ITA', 'region', '6%'),
    ('spain', 'Spain (autonomous communities)', 'ESP', 'region', '6%'),
    ('india', 'India (states and union territories)', 'IND', None, '6%'),
    ('china', 'China (provinces)', 'CHN', None, '3%'),
    ('japan', 'Japan (prefectures)', 'JPN', None, '6%'),
    ('australia', 'Australia (states and territories)', 'AUS', None, '3%'),
    ('south-africa', 'South Africa (provinces)', 'ZAF', None, '6%'),
]
REGION_EXTRA = {
    'germany': {'Nordrhein-Westfalen': ['nrw'], 'Baden-Württemberg': ['bawu'], 'Brandenburg': ['bb'], 'Mecklenburg-Vorpommern': ['mecklenburg western pomerania']},
    'uk': {'Scotland': ['sct'], 'Wales': ['wls', 'cymru'], 'Northern Ireland': ['ni', 'nir'], 'Greater London': ['london'],
           'East': ['east of england'], 'North East': ['north east england'], 'North West': ['north west england'],
           'South East': ['south east england'], 'South West': ['south west england'], 'West Midlands': [], 'East Midlands': [],
           'Yorkshire and the Humber': ['yorkshire', 'yorkshire and humber']},
}
FR_REGION_EN = {'Île-de-France': ['ile de france', 'paris region', 'idf'], "Provence-Alpes-Côte-d'Azur": ['paca', 'provence alpes cote d azur'],
                'Bretagne': ['brittany'], 'Normandie': ['normandy'], 'Corse': ['corsica']}
IT_REGION_EN = {'Lombardia': ['lombardy'], 'Piemonte': ['piedmont'], 'Toscana': ['tuscany'], 'Sicilia': ['sicily'], 'Sardegna': ['sardinia'],
                'Puglia': ['apulia'], "Valle d'Aosta": ['aosta valley'], 'Trentino-Alto Adige': ['trentino south tyrol']}
ES_REGION_EN = {'Andalucía': ['andalusia'], 'Cataluña': ['catalonia', 'catalunya'], 'Comunidad de Madrid': ['madrid'], 'Islas Baleares': ['balearic islands'],
                'Canary Is.': ['canary islands', 'canarias'], 'País Vasco': ['basque country', 'euskadi'], 'Comunidad Valenciana': ['valencia', 'valencian community'],
                'Castilla y León': ['castile and leon'], 'Castilla-La Mancha': ['castile la mancha'], 'Galicia': [], 'Foral de Navarra': ['navarra', 'navarre']}
US_GROUPS_FIELD = 'region'


def build_country(file, title, iso, dissolve, pct):
    src = fetch(ADM1_SRC)
    tmp = os.path.join(CACHE, file + '.json')
    where = f"adm0_a3=='{iso}'"
    if iso == 'FRA':
        where += " && ['Guyane française','Martinique','Guadeloupe','La Réunion','Mayotte'].indexOf(name)<0"
    if iso == 'ESP':
        where += " && ['Ceuta','Melilla'].indexOf(name)<0"
    clip = {'GBR': [-8.8, 49.8, 2, 61], 'AUS': [112, -44.5, 154.5, -9]}.get(iso)
    each = "ukreg = geonunit == 'England' ? region : geonunit" if iso == 'GBR' else None
    d = simplify(src, tmp, where=where, dissolve=dissolve, pct=pct, extra=['adm0_a3'] if dissolve else (), clip=clip,
                 sliver='0.5km2' if iso == 'IND' else '20km2', each=each)
    feats, groups, moves = [], {}, []
    extra = dict(REGION_EXTRA.get(file, {}))
    extra.update(FR_REGION_EN if iso == 'FRA' else IT_REGION_EN if iso == 'ITA' else ES_REGION_EN if iso == 'ESP' else {})
    for f in d['features']:
        p = f['properties']
        if not f.get('geometry'):
            continue
        if dissolve:
            name = p.get(dissolve)
            if not name:
                continue
            al = [fold(name)] + [fold(x) for x in extra.get(name, [])]
            props = {'name': name, 'a': list(dict.fromkeys(al))}
        else:
            name = p['name']
            if not name:  # unnamed islets (e.g. Natural Earth MX-X01)
                continue
            al = adm1_aliases(p) + [fold(x) for x in extra.get(name, [])]
            props = {'name': name, 'a': list(dict.fromkeys(al)), 'cp': [round(p['longitude'], 2), round(p['latitude'], 2)] if p.get('longitude') is not None else None}
            if p.get('region') and iso in ('USA', 'CAN', 'IND', 'CHN', 'JPN'):
                groups.setdefault(p['region'], []).append(name)
        if iso == 'DEU' and name == 'Brandenburg':  # Natural Earth gives Brandenburg Berlin's code
            props['a'] = [a for a in props['a'] if a not in ('be', 'de be')]
        feats.append({'type': 'Feature', 'properties': props, 'geometry': f['geometry']})
    if iso == 'USA':
        moves = usa_insets(feats)
    if iso == 'GBR':
        groups['England'] = [f['properties']['name'] for f in feats if f['properties']['name'] not in ('Scotland', 'Wales', 'Northern Ireland')]
        for f in feats:
            if f['properties']['name'] == 'East':
                f['properties']['a'] += ['east of england', 'eastern']
        groups['Great Britain'] = [f['properties']['name'] for f in feats if f['properties']['name'] != 'Northern Ireland']
    if iso == 'IND':
        india_pov(feats)
    for f in feats:
        f['properties']['bb'] = main_bbox(f['geometry'])
        if not f['properties'].get('cp'):
            b = f['properties']['bb']; f['properties']['cp'] = [round((b[0] + b[2]) / 2, 2), round((b[1] + b[3]) / 2, 2)]
    write(file, title, feats, groups, moves)


def usa_insets(feats):
    """Moves Alaska and Hawaii below the lower 48, like most US dashboards. Returns the moves so points can follow."""
    moves = []
    spec = {'Alaska': ([-180, 50, -129, 72], [-125, 22.5, -112, 29.5]), 'Hawaii': ([-161, 18.5, -154, 22.5], [-110.5, 23, -104.5, 26.5])}
    for f in feats:
        nm = f['properties']['name']
        if nm not in spec:
            continue
        (sx0, sy0, sx1, sy1), (tx0, ty0, tx1, ty1) = spec[nm]
        polys = [p for p in rings(f['geometry']) if all(sx0 <= c[0] <= sx1 for c in p[0])]
        f['geometry'] = {'type': 'MultiPolygon', 'coordinates': polys}
        k = min((tx1 - tx0) / (sx1 - sx0), (ty1 - ty0) / (sy1 - sy0))
        m = {'box': [sx0, sy0, sx1, sy1], 'k': round(k, 4), 'from': [sx0, sy0], 'to': [tx0, ty0]}
        transform_geom(f['geometry'], lambda x, y: (round(tx0 + (x - sx0) * k, 3), round(ty0 + (y - sy0) * k, 3)))
        f['properties']['cp'] = [round(tx0 + (f['properties']['cp'][0] - sx0) * k, 2), round(ty0 + (f['properties']['cp'][1] - sy0) * k, 2)]
        moves.append(m)
    return moves


def india_pov(feats):
    """Natural Earth's admin-1 layer follows de facto lines. Adds the remaining area of India's official
    outline (India point of view) to Jammu and Kashmir (west) and Ladakh (east)."""
    src = fetch(WORLD_SRC)
    states = os.path.join(CACHE, 'india-states.json'); outline = os.path.join(CACHE, 'india-outline.json'); rest = os.path.join(CACHE, 'india-rest.json')
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'name': f['properties']['name']}, 'geometry': f['geometry']} for f in feats]}, open(states, 'w'))
    mapshaper(['-i', src, '-filter', "ADM0_A3=='IND'", '-clip', 'bbox=72,32,81,37.5', '-o', 'format=geojson', 'force', outline])
    mapshaper(['-i', outline, '-erase', states, '-explode', '-o', 'format=geojson', 'force', rest])
    by = {f['properties']['name']: f for f in feats}
    for pc in json.load(open(rest)).get('features', []):
        g = pc.get('geometry')
        if not g:
            continue
        for poly in rings(g):
            r = poly[0]
            area = ring_area(r)
            perim = sum(((r[i + 1][0] - r[i][0]) ** 2 + (r[i + 1][1] - r[i][1]) ** 2) ** 0.5 for i in range(len(r) - 1))
            if area < 0.5 or 4 * 3.14159 * area / (perim * perim) < 0.05:  # skip slivers along shared borders
                continue
            xs = [c[0] for c in r]
            target = by['Jammu and Kashmir'] if (min(xs) + max(xs)) / 2 < 76.5 else by['Ladakh']
            target['geometry'] = {'type': 'MultiPolygon', 'coordinates': rings(target['geometry']) + [poly]}
            print('  India POV: added %.1f sq deg to %s' % (area, target['properties']['name']))
    # merge touching parts and simplify the added outline so no seams show
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'name': f['properties']['name']}, 'geometry': f['geometry']} for f in feats]}, open(states, 'w'))
    mapshaper(['-i', states, '-dissolve', 'fields=name', '-simplify', 'visvalingam', 'weighted', '20%', 'keep-shapes', '-o', 'format=geojson', 'precision=0.01', 'force', states])
    merged = {f['properties']['name']: f['geometry'] for f in json.load(open(states))['features']}
    for f in feats:
        f['geometry'] = merged.get(f['properties']['name'], f['geometry'])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    if not only or 'world' in only:
        build_world()
    for c in COUNTRIES:
        if not only or c[0] in only:
            build_country(*c)
