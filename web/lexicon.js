/* Dashboard vocabulary in German, French and Spanish, on this device (window.VSLexicon; module.exports in Node).
   safe: words a report uses as labels (titles, axes, legends, column headers), kept readable like the English allowlist
   when the dashboard is in that language. Only label vocabulary, never names: a word here is never masked.
   stop: short words that tell the language apart (used, with accents and the safe words, to recognise the language).
   by: the word that introduces a chart's dimension ("Umsatz nach Region", "Ventes par région", "Ventas por región").
   person: column headers and labels that announce a person. pool: everyday report words, from which replica text of
   the same length is drawn when a hidden word is neither a number nor a name. */
(function (global) {
  const words = s => s.trim().split(/\s+/).filter(Boolean);
  const LEX = {
    de: {
      name: 'Deutsch', ocr: 'deu', faker: 'de',
      safe: words(`
        der die das den dem des ein eine einer eines und oder mit ohne für von vom zum zur zu im in am an auf aus bei bis nach pro je über unter vor seit gegen als wie
        nummer e-mail email gesamt gesamtsumme summe zwischensumme insgesamt total durchschnitt mittelwert median anteil quote rate verhältnis index anzahl menge stück
        umsatz umsätze erlös erlöse ertrag erträge gewinn verlust kosten ausgaben aufwand budget prognose plan ist soll ziel ziele abweichung marge bruttomarge nettomarge
        netto brutto steuer steuern rabatt preis preise wert werte betrag beträge saldo bilanz rechnung rechnungen bestellung bestellungen auftrag aufträge
        wachstum veränderung trend entwicklung leistung übersicht zusammenfassung bericht berichte kennzahl kennzahlen dashboard kpi kpis
        kunde kunden kundin neukunden bestandskunden konto konten nutzer benutzer sitzungen besucher besuche seitenaufrufe aufrufe klicks impressionen
        conversion konversion konversionen leads verkäufe verkauf vertrieb abschlüsse pipeline chancen buchungen
        region regionen land länder stadt städte bundesland bundesländer gebiet markt märkte segment segmente kanal kanäle kategorie kategorien produkt produkte marke marken artikel
        abteilung abteilungen team teams verantwortlich name typ status priorität phase quelle quellen position positionen filiale filialen standort standorte lager
        datum tag tage woche wochen monat monate monatlich quartal quartale jahr jahre jährlich zeitraum zeit stunde stunden heute vorjahr vormonat
        januar februar märz april mai juni juli august september oktober november dezember jan feb mär mrz apr jun jul aug sep sept okt nov dez
        montag dienstag mittwoch donnerstag freitag samstag sonntag mo di mi do fr sa so
        deutschland österreich schweiz frankreich spanien italien europa asien amerika nord süd ost west mitte global international national
        online offline direkt indirekt organisch bezahlt suche partner offen geschlossen ausstehend aktiv inaktiv gewonnen verloren
        betrieb finanzen personal marketing technik einkauf logistik lieferung versand bestand mitarbeiter mitarbeitende personalbestand
        alle keine mehr weniger andere sonstige ja nein unbekannt stand quelle aktualisiert vertraulich intern seite von bis
        top höchste niedrigste beste schlechteste erste letzte nächste vorherige aktuell neu alt hoch mittel niedrig`),
      stop: words('der die das und mit für von nach den dem des ist nicht auf aus bei zum zur über'),
      by: ['nach', 'pro', 'je'],
      toEn: { kunde: 'customer', kunden: 'customers', mitarbeiter: 'employee', nutzer: 'user', benutzer: 'user', konto: 'account', stadt: 'city', 'städte': 'cities', region: 'region', land: 'country', 'länder': 'countries', gebiet: 'territory', filiale: 'store', produkt: 'product', produkte: 'products', segment: 'segment', monat: 'month', markt: 'market', standort: 'location', marke: 'brand', kategorie: 'category', lieferant: 'supplier' },
      person: words('verantwortlich verantwortliche ansprechpartner ansprechpartnerin mitarbeiter mitarbeiterin vertriebsmitarbeiter verkäufer verkäuferin berater beraterin kundenbetreuer manager leiter leiterin autor erstellt bearbeiter inhaber'),
      pool: words(`umsatz kosten gewinn kunde region monat jahr woche summe anteil markt kanal stand liste daten werte zahlen bericht ziel trend plan quote menge preis
        bereich gruppe stufe phase thema punkt seite zeile spalte posten konto lager filiale auftrag termin projekt aufgabe prozess ergebnis analyse vergleich
        übersicht entwicklung verteilung leistung qualität service betrieb vertrieb einkauf technik personal finanzen marketing logistik versand lieferung bestand`)
    },
    fr: {
      name: 'Français', ocr: 'fra', faker: 'fr',
      safe: words(`
        le la les l un une des du de d et ou avec sans pour par sur sous dans en au aux à entre vers chez selon contre comme que qui
        total totaux sous-total somme moyenne médiane part taux ratio indice nombre quantité volume
        chiffre chiffres d'affaires affaires ca ventes vente revenu revenus recettes produit bénéfice bénéfices résultat perte pertes coût coûts dépenses charges budget prévision prévisions réel objectif objectifs écart marge
        net nette brut brute taxe taxes tva remise prix valeur valeurs montant montants solde facture factures commande commandes
        croissance évolution variation tendance tendances performance aperçu synthèse résumé rapport rapports indicateur indicateurs tableau bord kpi kpis
        client clients cliente clientes compte comptes utilisateur utilisateurs sessions visiteurs visites pages vues clics impressions
        conversion conversions prospects leads opportunités affaires pipeline réservations
        région régions pays ville villes département départements territoire marché marchés segment segments canal canaux catégorie catégories produit produits marque marques article articles
        service services équipe équipes responsable nom type statut priorité étape source sources ligne lignes magasin magasins agence agences site sites entrepôt
        date dates jour jours semaine semaines mois mensuel mensuelle trimestre trimestres trimestriel année années an ans annuel annuelle période périodes heure heures aujourd'hui cumul
        janvier février mars avril mai juin juillet août septembre octobre novembre décembre janv févr fév avr juil sept oct nov déc
        lundi mardi mercredi jeudi vendredi samedi dimanche lun mar mer jeu ven sam dim
        france allemagne espagne italie belgique suisse europe asie amérique afrique nord sud est ouest centre global mondial international national
        en ligne hors direct indirect organique payant recherche partenaire partenaires ouvert ouverts fermé fermés attente actif actifs inactif gagné perdu
        opérations finance finances rh juridique marketing technique achats logistique livraison livraisons stock stocks employés effectif effectifs collaborateurs
        tous toutes aucun aucune plus moins autre autres oui non inconnu données mis jour actualisé confidentiel interne page sur
        top meilleur meilleurs pire premier première dernier dernière suivant précédent actuel nouveau nouveaux ancien haut moyen bas élevé faible`),
      stop: words('le la les des du et pour par sur avec dans au aux une est pas qui que ce'),
      by: ['par'],
      toEn: { client: 'customer', clients: 'customers', cliente: 'customer', collaborateurs: 'employee', collaborateur: 'employee', utilisateur: 'user', utilisateurs: 'users', compte: 'account', ville: 'city', villes: 'cities', 'région': 'region', 'régions': 'regions', pays: 'country', territoire: 'territory', magasin: 'store', agence: 'store', produit: 'product', produits: 'products', segment: 'segment', mois: 'month', 'marché': 'market', marque: 'brand', 'catégorie': 'category', fournisseur: 'supplier' },
      person: words('responsable gestionnaire commercial commerciale vendeur vendeuse conseiller conseillère chargé chargée auteur créé propriétaire titulaire collaborateur collaboratrice agent interlocuteur'),
      pool: words(`ventes coûts marge client région mois année semaine total part marché canal liste données valeurs chiffres rapport objectif tendance plan taux volume prix
        domaine groupe niveau étape thème point page ligne colonne poste compte stock agence commande projet tâche processus résultat analyse bilan suivi
        aperçu évolution répartition qualité service gestion achats technique finance marketing logistique livraison réseau secteur`)
    },
    es: {
      name: 'Español', ocr: 'spa', faker: 'es',
      safe: words(`
        el la los las lo un una unos unas del de y o e u con sin para por sobre en al a entre hacia desde hasta según contra como que
        unidades unidad empleado empleada código códigos total totales subtotal suma promedio media mediana cuota participación tasa ratio índice número cantidad volumen
        ingresos ingreso ventas venta facturación beneficio beneficios ganancia ganancias utilidad pérdida pérdidas costo costos coste costes gasto gastos presupuesto previsión pronóstico real objetivo objetivos meta metas desviación margen
        neto neta bruto bruta impuesto impuestos iva descuento precio precios valor valores importe importes monto montos saldo factura facturas pedido pedidos orden órdenes
        crecimiento cambio variación tendencia tendencias rendimiento desempeño resumen informe informes reporte reportes indicador indicadores tablero panel kpi kpis
        cliente clientes cuenta cuentas usuario usuarios sesiones visitantes visitas páginas vistas clics impresiones
        conversión conversiones prospectos leads oportunidades negocios pipeline reservas
        región regiones país países ciudad ciudades provincia provincias estado estados territorio mercado mercados segmento segmentos canal canales categoría categorías producto productos marca marcas artículo artículos
        departamento departamentos equipo equipos responsable nombre tipo estado prioridad etapa fuente fuentes línea líneas tienda tiendas sucursal sucursales almacén
        fecha fechas día días semana semanas mes meses mensual trimestre trimestres trimestral año años anual período periodo períodos hora horas hoy acumulado
        enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre ene abr ago sept dic
        lunes martes miércoles jueves viernes sábado domingo lun mié jue vie sáb dom
        españa méxico argentina colombia chile perú europa asia américa áfrica norte sur este oeste centro global mundial internacional nacional
        línea directo indirecto orgánico pagado búsqueda socio socios abierto abiertos cerrado cerrados pendiente activo activos inactivo ganado perdido
        operaciones finanzas rrhh legal marketing tecnología compras logística entrega entregas envío envíos inventario existencias empleados plantilla personal
        todos todas ninguno ninguna más menos otro otros otra otras sí no desconocido datos actualizado confidencial interno página
        top mejor mejores peor primero primera último última siguiente anterior actual nuevo nuevos alto medio bajo`),
      stop: words('el la los las del y para por con en una es que se no al'),
      by: ['por'],
      toEn: { cliente: 'customer', clientes: 'customers', empleado: 'employee', empleados: 'employee', usuario: 'user', usuarios: 'users', cuenta: 'account', ciudad: 'city', ciudades: 'cities', 'región': 'region', regiones: 'regions', 'país': 'country', 'países': 'countries', territorio: 'territory', tienda: 'store', sucursal: 'store', producto: 'product', productos: 'products', segmento: 'segment', mes: 'month', mercado: 'market', marca: 'brand', 'categoría': 'category', proveedor: 'supplier' },
      person: words('responsable gestor gestora vendedor vendedora comercial asesor asesora ejecutivo ejecutiva agente autor creado propietario titular empleado empleada contacto encargado encargada'),
      pool: words(`ventas costos margen cliente región mes año semana total cuota mercado canal lista datos valores cifras informe objetivo tendencia plan tasa volumen precio
        área grupo nivel etapa tema punto página línea columna partida cuenta stock tienda pedido proyecto tarea proceso resultado análisis balance
        resumen evolución reparto calidad servicio gestión compras tecnología finanzas marketing logística entrega red sector`)
    }
  };
  // The language of the words read, by votes: its short words, its accents, and its report vocabulary. English counts
  // too, so a dashboard in English with a few French names stays English. Returns 'en', 'de', 'fr' or 'es'.
  const EN_STOP = new Set(words('the and of by to for from with per in on at is are vs this that total revenue sales'));
  const norm = t => String(t).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const SETS = {};
  for (const [k, v] of Object.entries(LEX)) SETS[k] = { safe: new Set(v.safe), stop: new Set(v.stop) };
  const ACCENTS = { de: /[äöüß]/, fr: /[éèêëàâçùûîïô]/, es: /[ñáíóú¡¿]/ };
  function detect(texts) {
    const score = { en: 0, de: 0, fr: 0, es: 0 };
    for (const t of texts) {
      const w = norm(t);
      if (!w || /\d/.test(w)) continue;
      if (EN_STOP.has(w)) score.en += 2;
      for (const k of Object.keys(LEX)) {
        if (SETS[k].stop.has(w)) score[k] += 2;
        else if (SETS[k].safe.has(w)) score[k] += 1;
        if (ACCENTS[k].test(w)) score[k] += 1;
      }
    }
    const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
    const [best, top] = ranked[0], second = ranked[1][1];
    // clearly ahead, on more than a word or two; otherwise English, the reader's own language
    return best !== 'en' && top >= 6 && top >= second * 1.5 ? best : 'en';
  }
  // A label in German, French or Spanish read as its English equivalent, for deciding what a column holds
  // ("Ventes par région" → "ventes by region"; a person's column → "manager").
  function toEnglish(label, lang) {
    const L = LEX[lang];
    if (!L) return label;
    return String(label).toLowerCase().split(/\s+/).map(w => {
      const k = norm(w);
      if (L.by.includes(k)) return 'by';
      if (L.person.includes(k)) return 'manager';
      return L.toEn[k] || w;
    }).join(' ');
  }
  const api = { LEX, detect, norm, toEnglish, safeSet: lang => (SETS[lang] ? SETS[lang].safe : null) };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.VSLexicon = api;
})(typeof window !== 'undefined' ? window : globalThis);
