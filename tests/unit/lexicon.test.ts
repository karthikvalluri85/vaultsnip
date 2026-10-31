import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// web/lexicon.js and web/synth.js are plain browser scripts that also export for Node
const require = createRequire(import.meta.url);
const L = require('../../web/lexicon.js');
(globalThis as { VSLexicon?: unknown }).VSLexicon = L;
const Y = require('../../web/synth.js');

describe('dashboard languages (web/lexicon.js)', () => {
  it('recognises German, French and Spanish dashboards from their words, and stays English otherwise', () => {
    expect(L.detect('Umsatz nach Region Gesamt Kunden Monat Jan Feb Mär'.split(' '))).toBe('de');
    expect(L.detect('Ventes par région Total Clients Moyenne Janv Févr Mars'.split(' '))).toBe('fr');
    expect(L.detect('Ingresos por región Clientes Promedio Total Ene Feb Mar'.split(' '))).toBe('es');
    expect(L.detect('Revenue by Region Total Customers Average Jan Feb Mar'.split(' '))).toBe('en');
    // an English dashboard with a few French or Spanish names stays English
    expect(L.detect('Revenue by Account Manager Total José García Hélène Dubois Q3'.split(' '))).toBe('en');
    // too few words to tell: English
    expect(L.detect(['Total'])).toBe('en');
  });
  it('keeps report words safe per language, with their accents, and never names', () => {
    expect(L.safeSet('fr').has('année')).toBe(true);
    expect(L.safeSet('de').has('umsatz')).toBe(true);
    expect(L.safeSet('es').has('región')).toBe(true);
    for (const lang of ['de', 'fr', 'es']) for (const name of ['maría', 'josé', 'müller', 'dupont', 'garcía', 'schmidt']) expect(L.safeSet(lang).has(name)).toBe(false);
  });
  it('reads a label in its language as its English equivalent', () => {
    expect(L.toEnglish('Ventes par région', 'fr')).toBe('ventes by region');
    expect(L.toEnglish('Umsatz nach Kunde', 'de')).toBe('umsatz by customer');
    expect(L.toEnglish('Responsable', 'es')).toBe('manager');
  });
});

describe('replica text in German, French and Spanish (web/synth.js)', () => {
  it('reads "by" in other languages: a French chart by region gets places, a Spanish column of managers gets people', () => {
    expect(Y.roleOf('Ventes par région', 'fr')).toBe('city');
    expect(Y.roleOf('Umsatz nach Stadt', 'de')).toBe('city');
    expect(Y.roleOf('Responsable', 'es')).toBe('person');
  });
  it('replaces unknown words with report words of the same length in the dashboard\'s language', () => {
    const r = () => 0.42;
    const fr = Y.word('Zorblatique', r, 'fr'), de = Y.word('Quorx', r, 'de');
    expect(fr.length).toBeGreaterThanOrEqual(9);
    expect(fr.length).toBeLessThanOrEqual(13);
    expect(/^[A-ZÀ-Ý]/u.test(fr)).toBe(true);
    const frPool = new Set([...L.LEX.fr.pool, ...L.LEX.fr.safe]);
    expect(frPool.has(fr.toLowerCase())).toBe(true);
    expect(new Set([...L.LEX.de.pool, ...L.LEX.de.safe]).has(de.toLowerCase())).toBe(true);
  });
});
