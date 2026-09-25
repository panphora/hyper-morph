// 30 DOM Manipulation Scenarios for Demo
// Extracted from src/test/comparison.js

import * as HyperMorph from '/src/index.js';
window.HyperMorph = HyperMorph;

const scenarios = [
  // SIMPLE OPERATIONS (1-10)
  {
    id: 1,
    category: 'simple',
    categoryTitle: 'Simple Operations',
    title: '1. Append one item to list',
    before: '<ul><li>A</li><li>B</li></ul>',
    after: '<ul><li>A</li><li>B</li><li>C</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 2,
    category: 'simple',
    title: '2. Prepend one item to list',
    before: '<ul><li>A</li><li>B</li></ul>',
    after: '<ul><li>NEW</li><li>A</li><li>B</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 3,
    category: 'simple',
    title: '3. Remove first item from list',
    before: '<ul><li>A</li><li>B</li><li>C</li></ul>',
    after: '<ul><li>B</li><li>C</li></ul>',
    trackSelector: 'li',
    trackIndices: [1, 2]
  },
  {
    id: 4,
    category: 'simple',
    title: '4. Remove middle item from list',
    before: '<ul><li>A</li><li>B</li><li>C</li></ul>',
    after: '<ul><li>A</li><li>C</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 2]
  },
  {
    id: 5,
    category: 'simple',
    title: '5. Remove last item from list',
    before: '<ul><li>A</li><li>B</li><li>C</li></ul>',
    after: '<ul><li>A</li><li>B</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 6,
    category: 'simple',
    title: '6. Swap two items',
    before: '<ul><li>A</li><li>B</li></ul>',
    after: '<ul><li>B</li><li>A</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 7,
    category: 'simple',
    title: '7. Reverse three items',
    before: '<ul><li>A</li><li>B</li><li>C</li></ul>',
    after: '<ul><li>C</li><li>B</li><li>A</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1, 2]
  },
  {
    id: 8,
    category: 'simple',
    title: '8. Insert item in middle',
    before: '<ul><li>A</li><li>C</li></ul>',
    after: '<ul><li>A</li><li>B</li><li>C</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 9,
    category: 'simple',
    title: '9. Append with unique tags',
    before: '<div><header>H</header><main>M</main></div>',
    after: '<div><header>H</header><main>M</main><footer>F</footer></div>',
    trackSelector: 'header, main',
    trackIndices: [0, 1]
  },
  {
    id: 10,
    category: 'simple',
    title: '10. Reorder unique tags',
    before: '<div><header>H</header><main>M</main><footer>F</footer></div>',
    after: '<div><footer>F</footer><main>M</main><header>H</header></div>',
    trackSelector: 'header, main, footer',
    trackIndices: [0, 1, 2]
  },

  // CLASS-DIFFERENTIATED ELEMENTS (11-15)
  {
    id: 11,
    category: 'class',
    categoryTitle: 'Class-Differentiated Elements',
    title: '11. Swap divs with different classes',
    before: '<div><div class="a">A</div><div class="b">B</div></div>',
    after: '<div><div class="b">B</div><div class="a">A</div></div>',
    trackSelector: '.a, .b',
    trackIndices: [0, 1]
  },
  {
    id: 12,
    category: 'class',
    title: '12. Prepend to class-differentiated list',
    before: '<div><div class="a">A</div><div class="b">B</div></div>',
    after: '<div><div class="new">NEW</div><div class="a">A</div><div class="b">B</div></div>',
    trackSelector: '.a, .b',
    trackIndices: [0, 1]
  },
  {
    id: 13,
    category: 'class',
    title: '13. Remove first from class-differentiated list',
    before: '<div><div class="a">A</div><div class="b">B</div><div class="c">C</div></div>',
    after: '<div><div class="b">B</div><div class="c">C</div></div>',
    trackSelector: '.b, .c',
    trackIndices: [0, 1]
  },
  {
    id: 14,
    category: 'class',
    title: '14. Rotate three class-differentiated elements',
    before: '<div><div class="a">A</div><div class="b">B</div><div class="c">C</div></div>',
    after: '<div><div class="c">C</div><div class="a">A</div><div class="b">B</div></div>',
    trackSelector: '.a, .b, .c',
    trackIndices: [0, 1, 2]
  },
  {
    id: 15,
    category: 'class',
    title: '15. Insert into class-differentiated list',
    before: '<div><div class="a">A</div><div class="c">C</div></div>',
    after: '<div><div class="a">A</div><div class="b">B</div><div class="c">C</div></div>',
    trackSelector: '.a, .c',
    trackIndices: [0, 1]
  },

  // TEXT-DIFFERENTIATED ELEMENTS (16-20)
  {
    id: 16,
    category: 'text',
    categoryTitle: 'Text-Differentiated Elements',
    title: '16. Swap divs by text content only',
    before: '<div><div>Alpha</div><div>Beta</div></div>',
    after: '<div><div>Beta</div><div>Alpha</div></div>',
    trackSelector: 'div > div',
    trackIndices: [0, 1]
  },
  {
    id: 17,
    category: 'text',
    title: '17. Prepend to text-differentiated list',
    before: '<ul><li>First</li><li>Second</li></ul>',
    after: '<ul><li>New</li><li>First</li><li>Second</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 18,
    category: 'text',
    title: '18. Remove middle from text-differentiated list',
    before: '<ul><li>One</li><li>Two</li><li>Three</li></ul>',
    after: '<ul><li>One</li><li>Three</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 2]
  },
  {
    id: 19,
    category: 'text',
    title: '19. Shuffle four text-differentiated items',
    before: '<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>',
    after: '<ul><li>C</li><li>A</li><li>D</li><li>B</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1, 2, 3]
  },
  {
    id: 20,
    category: 'text',
    title: '20. Insert multiple items',
    before: '<ul><li>A</li><li>D</li></ul>',
    after: '<ul><li>A</li><li>B</li><li>C</li><li>D</li></ul>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },

  // ATTRIBUTE-DIFFERENTIATED ELEMENTS (21-25)
  {
    id: 21,
    category: 'attribute',
    categoryTitle: 'Attribute-Differentiated Elements',
    title: '21. Swap links by href',
    before: '<nav><a href="/home">Home</a><a href="/about">About</a></nav>',
    after: '<nav><a href="/about">About</a><a href="/home">Home</a></nav>',
    trackSelector: 'a',
    trackIndices: [0, 1]
  },
  {
    id: 22,
    category: 'attribute',
    title: '22. Swap images by src',
    before: '<div><img src="a.jpg" alt="A"><img src="b.jpg" alt="B"></div>',
    after: '<div><img src="b.jpg" alt="B"><img src="a.jpg" alt="A"></div>',
    trackSelector: 'img',
    trackIndices: [0, 1]
  },
  {
    id: 23,
    category: 'attribute',
    title: '23. Swap inputs by type',
    before: '<form><input type="text" placeholder="Text"><input type="email" placeholder="Email"></form>',
    after: '<form><input type="email" placeholder="Email"><input type="text" placeholder="Text"></form>',
    trackSelector: 'input',
    trackIndices: [0, 1]
  },
  {
    id: 24,
    category: 'attribute',
    title: '24. Swap inputs by name',
    before: '<form><input name="first" placeholder="First"><input name="last" placeholder="Last"></form>',
    after: '<form><input name="last" placeholder="Last"><input name="first" placeholder="First"></form>',
    trackSelector: 'input',
    trackIndices: [0, 1]
  },
  {
    id: 25,
    category: 'attribute',
    title: '25. Prepend to href-differentiated links',
    before: '<nav><a href="/a">A</a><a href="/b">B</a></nav>',
    after: '<nav><a href="/new">New</a><a href="/a">A</a><a href="/b">B</a></nav>',
    trackSelector: 'a',
    trackIndices: [0, 1]
  },

  // NESTED STRUCTURES (26-30)
  {
    id: 26,
    category: 'nested',
    categoryTitle: 'Nested Structures',
    title: '26. Swap nested card structures',
    before: '<div><div class="card"><h2>Card A</h2><p>Body A</p></div><div class="card"><h2>Card B</h2><p>Body B</p></div></div>',
    after: '<div><div class="card"><h2>Card B</h2><p>Body B</p></div><div class="card"><h2>Card A</h2><p>Body A</p></div></div>',
    trackSelector: '.card',
    trackIndices: [0, 1]
  },
  {
    id: 27,
    category: 'nested',
    title: '27. Reorder items 3 levels deep',
    before: '<main><section><div><span>A</span><span>B</span><span>C</span></div></section></main>',
    after: '<main><section><div><span>C</span><span>A</span><span>B</span></div></section></main>',
    trackSelector: 'span',
    trackIndices: [0, 1, 2]
  },
  {
    id: 28,
    category: 'nested',
    title: '28. Prepend item 3 levels deep',
    before: '<main><section><ul><li>A</li><li>B</li></ul></section></main>',
    after: '<main><section><ul><li>NEW</li><li>A</li><li>B</li></ul></section></main>',
    trackSelector: 'li',
    trackIndices: [0, 1]
  },
  {
    id: 29,
    category: 'nested',
    title: '29. Remove first from nested list',
    before: '<div><div><ul><li>X</li><li>Y</li><li>Z</li></ul></div></div>',
    after: '<div><div><ul><li>Y</li><li>Z</li></ul></div></div>',
    trackSelector: 'li',
    trackIndices: [1, 2]
  },
  {
    id: 30,
    category: 'nested',
    title: '30. Shuffle nested wrappers',
    before: '<div class="list"><div class="item"><span>1</span></div><div class="item"><span>2</span></div><div class="item"><span>3</span></div></div>',
    after: '<div class="list"><div class="item"><span>3</span></div><div class="item"><span>1</span></div><div class="item"><span>2</span></div></div>',
    trackSelector: '.item',
    trackIndices: [0, 1, 2]
  }
];

// Escape HTML for display
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Get text from first leaf descendant (element with no children)
function getFirstLeafText(el) {
  if (el.children.length === 0) {
    return el.textContent.trim();
  }
  for (const child of el.children) {
    const text = getFirstLeafText(child);
    if (text) return text;
  }
  return '';
}

// Create a signature to identify an element by its content characteristics
function getElementSignature(el) {
  const parts = [el.tagName];

  // Add sorted classes
  if (el.classList && el.classList.length > 0) {
    parts.push('.' + Array.from(el.classList).sort().join('.'));
  }

  // Add key attributes that identify elements
  ['id', 'href', 'src', 'name', 'type', 'role', 'alt'].forEach(attr => {
    const val = el.getAttribute(attr);
    if (val) parts.push(`[${attr}=${val}]`);
  });

  // Use first leaf descendant's text for identification
  // This allows parent elements to be distinguished by their content
  const text = getFirstLeafText(el).slice(0, 64);
  if (text) parts.push(`"${text}"`);

  return parts.join('|');
}

// Format HTML with indentation
function formatHtml(html) {
  let formatted = '';
  let indent = 0;
  const tokens = html.match(/<[^>]+>|[^<]+/g) || [];

  tokens.forEach(token => {
    if (token.match(/^<\/\w/)) {
      indent--;
    }
    if (token.trim()) {
      formatted += '  '.repeat(Math.max(0, indent)) + token.trim() + '\n';
    }
    if (token.match(/^<\w[^>]*[^\/]>$/)) {
      indent++;
    }
  });

  return formatted.trim();
}

// Run morph and track element identity
function runMorph(scenario, library) {
  // Create a hidden container attached to the document (required for morph to work)
  const container = document.createElement('div');
  container.style.display = 'none';
  document.body.appendChild(container);
  container.innerHTML = scenario.before;

  // Query from the root element, not the container, to avoid selector matching the container's children
  const root = container.children[0];

  // Get elements to track - store element reference and its signature
  const allElements = root.querySelectorAll(scenario.trackSelector);
  const trackedElements = [];

  scenario.trackIndices.forEach((index) => {
    const el = allElements[index];
    if (el) {
      trackedElements.push({
        element: el,
        signature: getElementSignature(el),
        html: el.outerHTML
      });
    }
  });

  // Run the morph. Idiomorph mutates children in place; HyperMorph merges
  // the container's children against the incoming markup.
  try {
    if (library.morphElement) {
      library.morphElement(container, scenario.after, { children: true });
    } else {
      library.morph(container, scenario.after, { morphStyle: 'innerHTML' });
    }
  } catch (e) {
    console.error('Morph error:', e);
  }

  // Check results - verify same DOM node still has same content
  const results = [];
  let preserved = 0;

  trackedElements.forEach(({ element, signature, html }) => {
    // Element is preserved if it's still in the container AND still has the same signature
    const wasPreserved = container.contains(element) &&
                         getElementSignature(element) === signature;
    if (wasPreserved) preserved++;

    results.push({
      html: html,
      preserved: wasPreserved
    });
  });

  // Clean up
  document.body.removeChild(container);

  return { preserved, total: trackedElements.length, results };
}

// Build element result list HTML
function buildResultList(results) {
  return results.map(r => {
    const className = r.preserved ? 'preserved' : 'replaced';
    const status = r.preserved ? '✓' : '✗';
    return `<li class="${className}">
      <span class="element-code">${escapeHtml(r.html)}</span>
      <span class="status">${status}</span>
    </li>`;
  }).join('');
}

// Initialize the demo page
function init() {
  // Verify libraries loaded
  if (!window.OriginalIdiomorph || !window.OriginalIdiomorph.morph) {
    console.error('OriginalIdiomorph not loaded');
    return;
  }
  if (!window.HyperMorph || !window.HyperMorph.morphElement) {
    console.error('HyperMorph not loaded');
    return;
  }

  const container = document.getElementById('scenarios-container');
  let currentCategory = null;
  let categorySection = null;

  let idiomorphTotal = 0;
  let hypermatchTotal = 0;

  scenarios.forEach(scenario => {
    // Create category section if needed
    if (scenario.category !== currentCategory) {
      currentCategory = scenario.category;
      categorySection = document.createElement('section');
      categorySection.className = 'category';
      categorySection.innerHTML = `<h2>${scenario.categoryTitle || scenario.category}</h2>`;
      container.appendChild(categorySection);
    }

    // Run both morphs
    const idiomorphResult = runMorph(scenario, window.OriginalIdiomorph);
    const hypermatchResult = runMorph(scenario, window.HyperMorph);

    const idiomorphSuccess = idiomorphResult.preserved === idiomorphResult.total;
    const hypermatchSuccess = hypermatchResult.preserved === hypermatchResult.total;

    if (idiomorphSuccess) idiomorphTotal++;
    if (hypermatchSuccess) hypermatchTotal++;

    // Create scenario card
    const card = document.createElement('div');
    card.className = 'scenario';
    card.innerHTML = `
      <div class="scenario-header">
        <h3>${scenario.title}</h3>
      </div>
      <div class="scenario-body">
        <div class="transformation">
          <div class="transform-side">
            <h4>Before</h4>
            <div class="code-block">${escapeHtml(formatHtml(scenario.before))}</div>
          </div>
          <div class="transform-arrow">→</div>
          <div class="transform-side">
            <h4>After</h4>
            <div class="code-block">${escapeHtml(formatHtml(scenario.after))}</div>
          </div>
        </div>
        <div class="results">
          <div class="result-side">
            <div class="result-header">
              <h4>Idiomorph</h4>
              <span class="result-score ${idiomorphSuccess ? 'success' : 'failure'}">
                ${idiomorphResult.preserved}/${idiomorphResult.total}
              </span>
            </div>
            <ul class="result-list">${buildResultList(idiomorphResult.results)}</ul>
          </div>
          <div class="result-side">
            <div class="result-header">
              <h4>HyperMorph</h4>
              <span class="result-score ${hypermatchSuccess ? 'success' : 'failure'}">
                ${hypermatchResult.preserved}/${hypermatchResult.total}
              </span>
            </div>
            <ul class="result-list">${buildResultList(hypermatchResult.results)}</ul>
          </div>
        </div>
      </div>
    `;
    categorySection.appendChild(card);
  });

  // Update totals
  document.getElementById('idiomorph-total').textContent = `${idiomorphTotal}/30`;
  document.getElementById('hypermatch-total').textContent = `${hypermatchTotal}/30`;
  document.getElementById('idiomorph-final').textContent = `${idiomorphTotal}/30`;
  document.getElementById('hypermatch-final').textContent = `${hypermatchTotal}/30`;
}

// Run on load
document.addEventListener('DOMContentLoaded', init);
