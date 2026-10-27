// The supported-charts page (web/charts.html): one card per catalogue entry, its example drawn by the replica engine.
(function () {
  'use strict';
  const grid = document.getElementById('grid');
  VSCatalog.ENTRIES.forEach((e, i) => {
    const card = document.createElement('section'); card.className = 'entry'; card.dataset.type = e.type;
    const h = document.createElement('h2'); h.textContent = e.label;
    const d = document.createElement('p'); d.className = 'data'; d.textContent = e.data;
    const demo = document.createElement('div'); demo.className = 'demo';
    card.append(h, d, demo); grid.appendChild(card);
    DSCReplica.render(demo, VSCatalog.exampleSpec(e, i), { mode: 'shape', seed: 11 + i, realistic: true });
  });
})();
