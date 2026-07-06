// Large DOM Sync Tests
// Tests for real-world scenarios with large, complex DOM structures
// Focus: text blocks, testimonials, landing pages, edge cases

describe("Large DOM Sync: Text Blocks", function () {
  setup();

  // ==========================================================================
  // Long Text Content (200+ chars)
  // ==========================================================================

  describe("Long Text Blocks (200+ chars)", function () {
    const longText200 = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.";
    const longText300 = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.";

    it("1. Text appended at end (same first 64 chars) - should match and update", function () {
      const initial = make(`<div><p class="text-block">${longText200}</p></div>`);
      const appended = longText200 + " This is new text added at the end.";
      const final = make(`<div><p class="text-block">${appended}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p class="text-block">${appended}</p></div>`);
    });

    it("2. Text prepended at start (different first 64 chars) - should still match by signature", function () {
      const initial = make(`<div><p class="text-block">${longText200}</p></div>`);
      const prepended = "NEW PREFIX: " + longText200;
      const final = make(`<div><p class="text-block">${prepended}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p class="text-block">${prepended}</p></div>`);
    });

    it("3. Two long text blocks with same first 64 chars but different endings", function () {
      const text1 = longText200 + " ENDING A";
      const text2 = longText200 + " ENDING B";
      const initial = make(`<div><p class="block">${text1}</p><p class="block">${text2}</p></div>`);
      const final = make(`<div><p class="block">${text2}</p><p class="block">${text1}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p class="block">${text2}</p><p class="block">${text1}</p></div>`);
    });

    it("4. Long text block with minor edit in middle", function () {
      const initial = make(`<div><p>${longText200}</p></div>`);
      const edited = longText200.replace("consectetur", "REPLACED");
      const final = make(`<div><p>${edited}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p>${edited}</p></div>`);
    });

    it("5. Multiple paragraphs, one changes", function () {
      const para1 = "First paragraph with some content here.";
      const para2 = longText200;
      const para3 = "Third paragraph with other content.";

      const initial = make(`<article><p>${para1}</p><p>${para2}</p><p>${para3}</p></article>`);
      const newPara2 = longText200 + " UPDATED";
      const final = make(`<article><p>${para1}</p><p>${newPara2}</p><p>${para3}</p></article>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<article><p>${para1}</p><p>${newPara2}</p><p>${para3}</p></article>`);
    });

    it("6. Long text in nested div structure", function () {
      const initial = make(`<div class="wrapper"><div class="inner"><div class="content"><p>${longText300}</p></div></div></div>`);
      const updated = longText300 + " APPENDED TEXT";
      const final = make(`<div class="wrapper"><div class="inner"><div class="content"><p>${updated}</p></div></div></div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("p").textContent.should.equal(updated);
    });
  });

  // ==========================================================================
  // Text Hint Edge Cases (64 char boundary)
  // ==========================================================================

  describe("Text Hint Boundary Cases (64 chars)", function () {
    it("7. Text exactly 64 chars - should use full text as hint", function () {
      const exact64 = "0123456789012345678901234567890123456789012345678901234567890123";
      exact64.length.should.equal(64);

      const initial = make(`<div><span class="a">${exact64}</span><span class="b">Other</span></div>`);
      const final = make(`<div><span class="b">Other</span><span class="a">${exact64}</span></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><span class="b">Other</span><span class="a">${exact64}</span></div>`);
    });

    it("8. Text 66 chars - should truncate to 64", function () {
      const text66 = "012345678901234567890123456789012345678901234567890123456789012345";
      text66.length.should.equal(66);

      const initial = make(`<div><p>${text66}</p></div>`);
      const updated = text66 + " MORE";
      const final = make(`<div><p>${updated}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p>${updated}</p></div>`);
    });

    it("9. Two elements with identical first 64 chars, different after", function () {
      const prefix = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 64 A's
      const text1 = prefix + " SUFFIX ONE";
      const text2 = prefix + " SUFFIX TWO";

      const initial = make(`<div><p class="x">${text1}</p><p class="y">${text2}</p></div>`);
      const final = make(`<div><p class="y">${text2}</p><p class="x">${text1}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p class="y">${text2}</p><p class="x">${text1}</p></div>`);
    });

    it("10. Short text vs long text (asymmetric lengths)", function () {
      const short = "Short";
      const long = "This is a much longer piece of text that exceeds sixty-four characters for sure.";

      const initial = make(`<div><p>${short}</p><p>${long}</p></div>`);
      const final = make(`<div><p>${long}</p><p>${short}</p></div>`);

      Idiomorph.morph(initial, final);
      initial.outerHTML.should.equal(`<div><p>${long}</p><p>${short}</p></div>`);
    });
  });
});


describe("Large DOM Sync: Testimonial Cards", function () {
  setup();

  // ==========================================================================
  // Testimonial Card Reordering
  // ==========================================================================

  describe("Testimonial Card Reordering", function () {
    const testimonial1 = `<div class="testimonial-card">
      <img src="alice.jpg" alt="Alice">
      <blockquote>"This product changed my life! Highly recommend to everyone."</blockquote>
      <cite>Alice Johnson, CEO of TechCorp</cite>
    </div>`;

    const testimonial2 = `<div class="testimonial-card">
      <img src="bob.jpg" alt="Bob">
      <blockquote>"Amazing service and support. Five stars all the way!"</blockquote>
      <cite>Bob Smith, Freelancer</cite>
    </div>`;

    const testimonial3 = `<div class="testimonial-card">
      <img src="carol.jpg" alt="Carol">
      <blockquote>"I've tried many solutions but this one is the best by far."</blockquote>
      <cite>Carol Williams, Designer</cite>
    </div>`;

    it("11. Move 3rd testimonial to 1st position", function () {
      const initial = make(`<section class="testimonials">${testimonial1}${testimonial2}${testimonial3}</section>`);
      const final = make(`<section class="testimonials">${testimonial3}${testimonial1}${testimonial2}</section>`);

      Idiomorph.morph(initial, final);

      const cards = initial.querySelectorAll(".testimonial-card");
      cards[0].querySelector("cite").textContent.should.include("Carol");
      cards[1].querySelector("cite").textContent.should.include("Alice");
      cards[2].querySelector("cite").textContent.should.include("Bob");
    });

    it("12. Swap first and last testimonials", function () {
      const initial = make(`<section class="testimonials">${testimonial1}${testimonial2}${testimonial3}</section>`);
      const final = make(`<section class="testimonials">${testimonial3}${testimonial2}${testimonial1}</section>`);

      Idiomorph.morph(initial, final);

      const cards = initial.querySelectorAll(".testimonial-card");
      cards[0].querySelector("cite").textContent.should.include("Carol");
      cards[2].querySelector("cite").textContent.should.include("Alice");
    });

    it("13. Reverse all testimonials", function () {
      const initial = make(`<section class="testimonials">${testimonial1}${testimonial2}${testimonial3}</section>`);
      const final = make(`<section class="testimonials">${testimonial3}${testimonial2}${testimonial1}</section>`);

      Idiomorph.morph(initial, final);

      initial.querySelectorAll(".testimonial-card").length.should.equal(3);
    });

    it("14. Add new testimonial at beginning", function () {
      const testimonial4 = `<div class="testimonial-card">
        <img src="dave.jpg" alt="Dave">
        <blockquote>"New favorite product!"</blockquote>
        <cite>Dave Brown, Engineer</cite>
      </div>`;

      const initial = make(`<section class="testimonials">${testimonial1}${testimonial2}${testimonial3}</section>`);
      const final = make(`<section class="testimonials">${testimonial4}${testimonial1}${testimonial2}${testimonial3}</section>`);

      Idiomorph.morph(initial, final);

      const cards = initial.querySelectorAll(".testimonial-card");
      cards.length.should.equal(4);
      cards[0].querySelector("cite").textContent.should.include("Dave");
    });

    it("15. Remove middle testimonial", function () {
      const initial = make(`<section class="testimonials">${testimonial1}${testimonial2}${testimonial3}</section>`);
      const final = make(`<section class="testimonials">${testimonial1}${testimonial3}</section>`);

      Idiomorph.morph(initial, final);

      const cards = initial.querySelectorAll(".testimonial-card");
      cards.length.should.equal(2);
      cards[0].querySelector("cite").textContent.should.include("Alice");
      cards[1].querySelector("cite").textContent.should.include("Carol");
    });

    it("16. Update testimonial text without changing position", function () {
      const initial = make(`<section class="testimonials">${testimonial1}${testimonial2}${testimonial3}</section>`);
      const updated2 = testimonial2.replace("Amazing service", "UPDATED: Amazing service");
      const final = make(`<section class="testimonials">${testimonial1}${updated2}${testimonial3}</section>`);

      Idiomorph.morph(initial, final);

      initial.querySelectorAll(".testimonial-card")[1].querySelector("blockquote").textContent.should.include("UPDATED");
    });
  });

  // ==========================================================================
  // Similar Testimonials (Edge Case)
  // ==========================================================================

  describe("Similar Testimonials", function () {
    it("17. Testimonials with same structure but different names", function () {
      const card = (name) => `<div class="testimonial-card">
        <div class="avatar"></div>
        <p class="quote">Great product!</p>
        <span class="name">${name}</span>
      </div>`;

      const initial = make(`<div>${card("Alice")}${card("Bob")}${card("Carol")}</div>`);
      const final = make(`<div>${card("Carol")}${card("Alice")}${card("Bob")}</div>`);

      Idiomorph.morph(initial, final);

      const names = Array.from(initial.querySelectorAll(".name")).map(n => n.textContent);
      names.should.eql(["Carol", "Alice", "Bob"]);
    });

    it("18. Testimonials with identical quotes, different authors", function () {
      const card = (author) => `<div class="card">
        <p>"This is the same quote for everyone!"</p>
        <footer>${author}</footer>
      </div>`;

      const initial = make(`<div>${card("Author A")}${card("Author B")}${card("Author C")}</div>`);
      const final = make(`<div>${card("Author B")}${card("Author C")}${card("Author A")}</div>`);

      Idiomorph.morph(initial, final);

      const authors = Array.from(initial.querySelectorAll("footer")).map(f => f.textContent);
      authors.should.eql(["Author B", "Author C", "Author A"]);
    });
  });
});


describe("Large DOM Sync: Parent-Child Text Matching", function () {
  setup();

  // ==========================================================================
  // Parent textContent includes children
  // ==========================================================================

  describe("Parent Element Text Includes Children", function () {
    it("19. Parent div with nested text - child text changes", function () {
      const initial = make(`<div class="container">
        <div class="card">
          <h3>Title</h3>
          <p>Original description text</p>
        </div>
      </div>`);

      const final = make(`<div class="container">
        <div class="card">
          <h3>Title</h3>
          <p>Updated description text</p>
        </div>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("p").textContent.should.equal("Updated description text");
    });

    it("20. Children reordered within parent - affects parent textHint", function () {
      const initial = make(`<div class="wrapper">
        <div class="item">
          <span>Alpha</span>
          <span>Beta</span>
        </div>
      </div>`);

      const final = make(`<div class="wrapper">
        <div class="item">
          <span>Beta</span>
          <span>Alpha</span>
        </div>
      </div>`);

      Idiomorph.morph(initial, final);
      const spans = initial.querySelectorAll(".item span");
      spans[0].textContent.should.equal("Beta");
      spans[1].textContent.should.equal("Alpha");
    });

    it("21. Deeply nested text change affects ancestors", function () {
      const initial = make(`<section>
        <article>
          <div class="content">
            <p><strong>Important:</strong> <em>Original text here</em></p>
          </div>
        </article>
      </section>`);

      const final = make(`<section>
        <article>
          <div class="content">
            <p><strong>Important:</strong> <em>Updated text here</em></p>
          </div>
        </article>
      </section>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("em").textContent.should.equal("Updated text here");
    });

    it("22. Two parents with same structure but different child text", function () {
      const initial = make(`<div>
        <div class="card"><p>Content A</p></div>
        <div class="card"><p>Content B</p></div>
      </div>`);

      const final = make(`<div>
        <div class="card"><p>Content B</p></div>
        <div class="card"><p>Content A</p></div>
      </div>`);

      Idiomorph.morph(initial, final);
      const cards = initial.querySelectorAll(".card p");
      cards[0].textContent.should.equal("Content B");
      cards[1].textContent.should.equal("Content A");
    });

    it("23. Parent with mixed content (text + elements)", function () {
      const initial = make(`<p class="mixed">Prefix <strong>bold</strong> suffix</p>`);
      const final = make(`<p class="mixed">Prefix <strong>UPDATED</strong> suffix</p>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("strong").textContent.should.equal("UPDATED");
    });

    it("24. Adding child to parent changes parent textContent", function () {
      const initial = make(`<div class="container"><span>Original</span></div>`);
      const final = make(`<div class="container"><span>Original</span><span>New</span></div>`);

      Idiomorph.morph(initial, final);
      initial.querySelectorAll("span").length.should.equal(2);
    });
  });
});


describe("Large DOM Sync: Full Landing Page", function () {
  setup();

  // ==========================================================================
  // Complete Landing Page Structure
  // ==========================================================================

  const createLandingPage = (options = {}) => {
    const {
      heroTitle = "Welcome to Our Product",
      heroSubtitle = "The best solution for your needs",
      navLinks = ["Home", "Features", "Pricing", "Contact"],
      features = [
        { title: "Fast", desc: "Lightning quick performance" },
        { title: "Secure", desc: "Enterprise-grade security" },
        { title: "Scalable", desc: "Grows with your business" }
      ],
      testimonials = [
        { name: "Alice", quote: "Amazing product!" },
        { name: "Bob", quote: "Changed my workflow!" },
        { name: "Carol", quote: "Highly recommended!" }
      ],
      ctaText = "Get Started"
    } = options;

    return `<div class="landing-page">
      <header class="header">
        <nav class="nav">
          <a href="/" class="logo">Brand</a>
          <ul class="nav-links">
            ${navLinks.map(link => `<li><a href="#${link.toLowerCase()}">${link}</a></li>`).join("")}
          </ul>
          <button class="cta-btn">${ctaText}</button>
        </nav>
      </header>

      <main>
        <section class="hero">
          <h1>${heroTitle}</h1>
          <p class="subtitle">${heroSubtitle}</p>
          <button class="hero-cta">Learn More</button>
        </section>

        <section class="features">
          <h2>Features</h2>
          <div class="feature-grid">
            ${features.map(f => `<div class="feature-card">
              <h3>${f.title}</h3>
              <p>${f.desc}</p>
            </div>`).join("")}
          </div>
        </section>

        <section class="testimonials">
          <h2>What Our Customers Say</h2>
          <div class="testimonial-grid">
            ${testimonials.map(t => `<div class="testimonial">
              <blockquote>"${t.quote}"</blockquote>
              <cite>— ${t.name}</cite>
            </div>`).join("")}
          </div>
        </section>
      </main>

      <footer class="footer">
        <p>&copy; 2024 Brand. All rights reserved.</p>
      </footer>
    </div>`;
  };

  describe("Landing Page Mutations", function () {
    it("25. Update hero title only", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({ heroTitle: "New Amazing Title" }));

      Idiomorph.morph(initial, final);
      initial.querySelector(".hero h1").textContent.should.equal("New Amazing Title");
    });

    it("26. Update hero title and subtitle", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        heroTitle: "Updated Title",
        heroSubtitle: "Updated subtitle text here"
      }));

      Idiomorph.morph(initial, final);
      initial.querySelector(".hero h1").textContent.should.equal("Updated Title");
      initial.querySelector(".subtitle").textContent.should.equal("Updated subtitle text here");
    });

    it("27. Reorder nav links", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        navLinks: ["Pricing", "Features", "Contact", "Home"]
      }));

      Idiomorph.morph(initial, final);
      const links = Array.from(initial.querySelectorAll(".nav-links a")).map(a => a.textContent);
      links.should.eql(["Pricing", "Features", "Contact", "Home"]);
    });

    it("28. Add new nav link", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        navLinks: ["Home", "Features", "Pricing", "Blog", "Contact"]
      }));

      Idiomorph.morph(initial, final);
      initial.querySelectorAll(".nav-links li").length.should.equal(5);
    });

    it("29. Reorder feature cards", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        features: [
          { title: "Scalable", desc: "Grows with your business" },
          { title: "Fast", desc: "Lightning quick performance" },
          { title: "Secure", desc: "Enterprise-grade security" }
        ]
      }));

      Idiomorph.morph(initial, final);
      const titles = Array.from(initial.querySelectorAll(".feature-card h3")).map(h => h.textContent);
      titles.should.eql(["Scalable", "Fast", "Secure"]);
    });

    it("30. Update feature descriptions", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        features: [
          { title: "Fast", desc: "UPDATED: Even faster now!" },
          { title: "Secure", desc: "UPDATED: More secure!" },
          { title: "Scalable", desc: "UPDATED: Infinitely scalable!" }
        ]
      }));

      Idiomorph.morph(initial, final);
      initial.querySelectorAll(".feature-card p")[0].textContent.should.include("UPDATED");
    });

    it("31. Reorder testimonials (3rd to 1st)", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        testimonials: [
          { name: "Carol", quote: "Highly recommended!" },
          { name: "Alice", quote: "Amazing product!" },
          { name: "Bob", quote: "Changed my workflow!" }
        ]
      }));

      Idiomorph.morph(initial, final);
      const names = Array.from(initial.querySelectorAll(".testimonial cite")).map(c => c.textContent);
      names[0].should.include("Carol");
    });

    it("32. Update CTA button text", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({ ctaText: "Start Free Trial" }));

      Idiomorph.morph(initial, final);
      initial.querySelector(".cta-btn").textContent.should.equal("Start Free Trial");
    });

    it("33. Multiple sections updated simultaneously", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        heroTitle: "New Title",
        ctaText: "Sign Up Now",
        features: [
          { title: "New Feature 1", desc: "Description 1" },
          { title: "New Feature 2", desc: "Description 2" },
          { title: "New Feature 3", desc: "Description 3" }
        ]
      }));

      Idiomorph.morph(initial, final);
      initial.querySelector(".hero h1").textContent.should.equal("New Title");
      initial.querySelector(".cta-btn").textContent.should.equal("Sign Up Now");
    });

    it("34. Add new feature card", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        features: [
          { title: "Fast", desc: "Lightning quick performance" },
          { title: "Secure", desc: "Enterprise-grade security" },
          { title: "Scalable", desc: "Grows with your business" },
          { title: "Reliable", desc: "99.9% uptime guaranteed" }
        ]
      }));

      Idiomorph.morph(initial, final);
      initial.querySelectorAll(".feature-card").length.should.equal(4);
    });

    it("35. Remove a testimonial", function () {
      const initial = make(createLandingPage());
      const final = make(createLandingPage({
        testimonials: [
          { name: "Alice", quote: "Amazing product!" },
          { name: "Carol", quote: "Highly recommended!" }
        ]
      }));

      Idiomorph.morph(initial, final);
      initial.querySelectorAll(".testimonial").length.should.equal(2);
    });
  });
});


describe("Large DOM Sync: Stress Tests", function () {
  setup();

  // ==========================================================================
  // Many Similar Elements
  // ==========================================================================

  describe("Many Similar Elements", function () {
    it("36. 10 identical divs with only text difference", function () {
      const items = Array.from({ length: 10 }, (_, i) => `<div class="item">Item ${i + 1}</div>`).join("");
      const reordered = Array.from({ length: 10 }, (_, i) => `<div class="item">Item ${10 - i}</div>`).join("");

      const initial = make(`<div class="list">${items}</div>`);
      const final = make(`<div class="list">${reordered}</div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector(".item").textContent.should.equal("Item 10");
    });

    it("37. 20 list items shuffled", function () {
      const items = Array.from({ length: 20 }, (_, i) => `<li>Item ${i + 1}</li>`).join("");
      const shuffled = Array.from({ length: 20 }, (_, i) => `<li>Item ${((i * 7) % 20) + 1}</li>`).join("");

      const initial = make(`<ul>${items}</ul>`);
      const final = make(`<ul>${shuffled}</ul>`);

      Idiomorph.morph(initial, final);
      initial.querySelectorAll("li").length.should.equal(20);
    });

    it("38. 50 similar cards with unique titles", function () {
      const cards = Array.from({ length: 50 }, (_, i) =>
        `<div class="card"><h3>Card ${i + 1}</h3><p>Same description for all</p></div>`
      ).join("");

      const reordered = Array.from({ length: 50 }, (_, i) =>
        `<div class="card"><h3>Card ${50 - i}</h3><p>Same description for all</p></div>`
      ).join("");

      const initial = make(`<div class="grid">${cards}</div>`);
      const final = make(`<div class="grid">${reordered}</div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector(".card h3").textContent.should.equal("Card 50");
    });

    it("39. Grid of 100 cells (10x10)", function () {
      const rows = Array.from({ length: 10 }, (_, r) =>
        `<tr>${Array.from({ length: 10 }, (_, c) => `<td>R${r}C${c}</td>`).join("")}</tr>`
      ).join("");

      const initial = make(`<table><tbody>${rows}</tbody></table>`);

      // Reverse the rows
      const reversedRows = Array.from({ length: 10 }, (_, r) =>
        `<tr>${Array.from({ length: 10 }, (_, c) => `<td>R${9-r}C${c}</td>`).join("")}</tr>`
      ).join("");

      const final = make(`<table><tbody>${reversedRows}</tbody></table>`);

      Idiomorph.morph(initial, final);
      initial.querySelectorAll("td").length.should.equal(100);
    });

    it("40. Deeply nested structure (5 levels, 3 children each)", function () {
      const createNested = (depth, prefix = "") => {
        if (depth === 0) return `<span>${prefix || "leaf"}</span>`;
        return Array.from({ length: 3 }, (_, i) =>
          `<div class="level-${depth}">${createNested(depth - 1, `${prefix}${i}`)}</div>`
        ).join("");
      };

      const initial = make(`<div class="root">${createNested(5)}</div>`);
      const final = make(`<div class="root">${createNested(5)}</div>`);

      Idiomorph.morph(initial, final);
      initial.querySelectorAll("span").length.should.equal(243); // 3^5
    });
  });

  // ==========================================================================
  // Edge Cases with Similar Content
  // ==========================================================================

  describe("Similar Content Edge Cases", function () {
    it("41. Elements with same class and similar text (only differ by number)", function () {
      const initial = make(`<div>
        <p class="msg">Message 1</p>
        <p class="msg">Message 2</p>
        <p class="msg">Message 3</p>
      </div>`);

      const final = make(`<div>
        <p class="msg">Message 3</p>
        <p class="msg">Message 1</p>
        <p class="msg">Message 2</p>
      </div>`);

      Idiomorph.morph(initial, final);
      const msgs = Array.from(initial.querySelectorAll(".msg")).map(p => p.textContent);
      msgs.should.eql(["Message 3", "Message 1", "Message 2"]);
    });

    it("42. Empty elements with only class differences", function () {
      const initial = make(`<div>
        <div class="box red"></div>
        <div class="box blue"></div>
        <div class="box green"></div>
      </div>`);

      const final = make(`<div>
        <div class="box green"></div>
        <div class="box red"></div>
        <div class="box blue"></div>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector(".box").classList.contains("green").should.be.true;
    });

    it("43. Elements with long identical prefixes in attributes", function () {
      const longPrefix = "very-long-class-name-prefix-that-is-shared-";
      const initial = make(`<div>
        <span class="${longPrefix}a">A</span>
        <span class="${longPrefix}b">B</span>
      </div>`);

      const final = make(`<div>
        <span class="${longPrefix}b">B</span>
        <span class="${longPrefix}a">A</span>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("span").textContent.should.equal("B");
    });

    it("44. Cards with same text but different images", function () {
      const initial = make(`<div>
        <div class="card"><img src="img1.jpg"><p>Same text</p></div>
        <div class="card"><img src="img2.jpg"><p>Same text</p></div>
      </div>`);

      const final = make(`<div>
        <div class="card"><img src="img2.jpg"><p>Same text</p></div>
        <div class="card"><img src="img1.jpg"><p>Same text</p></div>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector(".card img").src.should.include("img2.jpg");
    });

    it("45. Buttons with same text but different types", function () {
      const initial = make(`<form>
        <button type="submit">Click</button>
        <button type="reset">Click</button>
        <button type="button">Click</button>
      </form>`);

      const final = make(`<form>
        <button type="button">Click</button>
        <button type="submit">Click</button>
        <button type="reset">Click</button>
      </form>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("button").type.should.equal("button");
    });
  });

  // ==========================================================================
  // Real-world Complex Scenarios
  // ==========================================================================

  describe("Complex Real-world Scenarios", function () {
    it("46. Dashboard with multiple widget types", function () {
      const dashboard = `<div class="dashboard">
        <div class="widget stats"><h3>Statistics</h3><p>100 users</p></div>
        <div class="widget chart"><h3>Chart</h3><canvas></canvas></div>
        <div class="widget table"><h3>Data</h3><table><tr><td>A</td></tr></table></div>
      </div>`;

      const reordered = `<div class="dashboard">
        <div class="widget table"><h3>Data</h3><table><tr><td>A</td></tr></table></div>
        <div class="widget stats"><h3>Statistics</h3><p>200 users</p></div>
        <div class="widget chart"><h3>Chart</h3><canvas></canvas></div>
      </div>`;

      const initial = make(dashboard);
      const final = make(reordered);

      Idiomorph.morph(initial, final);
      initial.querySelector(".widget").classList.contains("table").should.be.true;
    });

    it("47. E-commerce product grid with filters", function () {
      const product = (id, name, price) =>
        `<div class="product" data-id="${id}"><h4>${name}</h4><span class="price">$${price}</span></div>`;

      const initial = make(`<div class="products">
        ${product(1, "Widget A", 19.99)}
        ${product(2, "Widget B", 29.99)}
        ${product(3, "Widget C", 39.99)}
      </div>`);

      // Sorted by price descending
      const final = make(`<div class="products">
        ${product(3, "Widget C", 39.99)}
        ${product(2, "Widget B", 29.99)}
        ${product(1, "Widget A", 19.99)}
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector(".product h4").textContent.should.equal("Widget C");
    });

    it("48. Comment thread with nested replies", function () {
      const initial = make(`<div class="thread">
        <div class="comment">
          <p>Parent comment</p>
          <div class="replies">
            <div class="comment"><p>Reply A</p></div>
            <div class="comment"><p>Reply B</p></div>
          </div>
        </div>
      </div>`);

      // Add new reply at beginning
      const final = make(`<div class="thread">
        <div class="comment">
          <p>Parent comment</p>
          <div class="replies">
            <div class="comment"><p>New Reply</p></div>
            <div class="comment"><p>Reply A</p></div>
            <div class="comment"><p>Reply B</p></div>
          </div>
        </div>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelectorAll(".replies .comment").length.should.equal(3);
    });

    it("49. Kanban board with cards moving between columns", function () {
      const initial = make(`<div class="kanban">
        <div class="column todo">
          <h3>To Do</h3>
          <div class="card">Task A</div>
          <div class="card">Task B</div>
        </div>
        <div class="column doing">
          <h3>Doing</h3>
          <div class="card">Task C</div>
        </div>
        <div class="column done">
          <h3>Done</h3>
        </div>
      </div>`);

      // Move Task A to Doing
      const final = make(`<div class="kanban">
        <div class="column todo">
          <h3>To Do</h3>
          <div class="card">Task B</div>
        </div>
        <div class="column doing">
          <h3>Doing</h3>
          <div class="card">Task A</div>
          <div class="card">Task C</div>
        </div>
        <div class="column done">
          <h3>Done</h3>
        </div>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector(".todo .card").textContent.should.equal("Task B");
      initial.querySelectorAll(".doing .card").length.should.equal(2);
    });

    it("50. News feed with articles of varying lengths", function () {
      const shortArticle = "Short article text.";
      const longArticle = "This is a much longer article that contains more than sixty-four characters to test the text hint boundary properly and see how matching works with longer content that might have similar prefixes.";

      const initial = make(`<div class="feed">
        <article><h2>Short</h2><p>${shortArticle}</p></article>
        <article><h2>Long</h2><p>${longArticle}</p></article>
        <article><h2>Medium</h2><p>Medium length article content here.</p></article>
      </div>`);

      // Reverse order
      const final = make(`<div class="feed">
        <article><h2>Medium</h2><p>Medium length article content here.</p></article>
        <article><h2>Long</h2><p>${longArticle}</p></article>
        <article><h2>Short</h2><p>${shortArticle}</p></article>
      </div>`);

      Idiomorph.morph(initial, final);
      initial.querySelector("article h2").textContent.should.equal("Medium");
    });
  });
});


describe("Large DOM Sync: DOM Node Preservation", function () {
  setup();

  // ==========================================================================
  // Verify actual DOM node identity is preserved
  // ==========================================================================

  describe("Node Identity Preservation", function () {
    it("51. Verify same DOM node is reused on reorder", function () {
      const initial = make(`<div><span class="a">Alpha</span><span class="b">Beta</span></div>`);
      const nodeA = initial.querySelector(".a");
      const nodeB = initial.querySelector(".b");

      const final = make(`<div><span class="b">Beta</span><span class="a">Alpha</span></div>`);

      Idiomorph.morph(initial, final);

      // Same nodes should be in new positions
      initial.children[0].should.equal(nodeB);
      initial.children[1].should.equal(nodeA);
    });

    it("52. Verify testimonial card nodes preserved on reorder", function () {
      const initial = make(`<section>
        <div class="card"><p>Card One</p></div>
        <div class="card"><p>Card Two</p></div>
        <div class="card"><p>Card Three</p></div>
      </section>`);

      const card1 = initial.children[0];
      const card2 = initial.children[1];
      const card3 = initial.children[2];

      const final = make(`<section>
        <div class="card"><p>Card Three</p></div>
        <div class="card"><p>Card One</p></div>
        <div class="card"><p>Card Two</p></div>
      </section>`);

      Idiomorph.morph(initial, final);

      initial.children[0].should.equal(card3);
      initial.children[1].should.equal(card1);
      initial.children[2].should.equal(card2);
    });

    it("53. Node preserved when text updated (appended)", function () {
      const longText = "This is some long text content that will have more added to it.";
      const initial = make(`<div><p class="text">${longText}</p></div>`);
      const pNode = initial.querySelector("p");

      const final = make(`<div><p class="text">${longText} More text here!</p></div>`);

      Idiomorph.morph(initial, final);

      initial.querySelector("p").should.equal(pNode);
      pNode.textContent.should.include("More text here!");
    });

    it("54. Nested nodes preserved through parent reorder", function () {
      const initial = make(`<div>
        <div class="wrapper-a"><span class="inner-a">A</span></div>
        <div class="wrapper-b"><span class="inner-b">B</span></div>
      </div>`);

      const innerA = initial.querySelector(".inner-a");
      const innerB = initial.querySelector(".inner-b");

      const final = make(`<div>
        <div class="wrapper-b"><span class="inner-b">B</span></div>
        <div class="wrapper-a"><span class="inner-a">A</span></div>
      </div>`);

      Idiomorph.morph(initial, final);

      initial.querySelector(".inner-a").should.equal(innerA);
      initial.querySelector(".inner-b").should.equal(innerB);
    });

    it("55. List items preserved when list is reversed", function () {
      const initial = make(`<ul>
        <li>First</li>
        <li>Second</li>
        <li>Third</li>
      </ul>`);

      const li1 = initial.children[0];
      const li2 = initial.children[1];
      const li3 = initial.children[2];

      const final = make(`<ul>
        <li>Third</li>
        <li>Second</li>
        <li>First</li>
      </ul>`);

      Idiomorph.morph(initial, final);

      initial.children[0].should.equal(li3);
      initial.children[1].should.equal(li2);
      initial.children[2].should.equal(li1);
    });
  });
});


describe("Large DOM Sync: Oversized same-signature buckets", function () {
  setup();

  it("matches correctly and quickly with 1500 same-signature rows", function () {
    const N = 1500;
    const rows = Array.from(
      { length: N },
      (_, i) => `<li class="item">unique text ${i}</li>`,
    ).join("");
    const initial = make(`<ul>${rows}</ul>`);
    getWorkArea().appendChild(initial);

    // Stamp identity on a sample of rows that stay put (they only shift by 3,
    // which keeps them above the confidence threshold via their unique text).
    const sampleIdx = [3, 100, 750, 1400, 1499];
    const stamped = {};
    const lis = initial.querySelectorAll("li");
    for (const i of sampleIdx) {
      lis[i].__probe = `probe-${i}`;
      stamped[i] = lis[i];
    }

    // New order: move the first 3 rows to the end and append 5 brand-new rows.
    const texts = Array.from({ length: N }, (_, i) => `unique text ${i}`);
    const reordered = texts.slice(3).concat(texts.slice(0, 3));
    const extra = Array.from({ length: 5 }, (_, i) => `brand new ${i}`);
    const newRows = reordered
      .concat(extra)
      .map((t) => `<li class="item">${t}</li>`)
      .join("");
    const final = make(`<ul>${newRows}</ul>`);

    const start = performance.now();
    Idiomorph.morph(initial, final);
    const duration = performance.now() - start;

    for (const i of sampleIdx) {
      const match = Array.from(initial.querySelectorAll("li")).find(
        (li) => li.textContent === `unique text ${i}`,
      );
      (match === stamped[i]).should.equal(true);
      match.__probe.should.equal(`probe-${i}`);
    }
    initial.querySelectorAll("li").length.should.equal(N + 5);
    duration.should.be.below(3000);
  });

  it("preserves identity across reorders larger than the drift cap", function () {
    // Rows shift by 30 positions — far past maxDriftPenalty (19). The capped
    // drift must never cancel a text-confirmed match: signature (100) +
    // textMatch (20) − cap (19) = 101 = minConfidence.
    const N = 80;
    const texts = Array.from({ length: N }, (_, i) => `unique text ${i}`);
    const initial = make(
      `<ul>${texts.map((t) => `<li class="item">${t}</li>`).join("")}</ul>`,
    );
    getWorkArea().appendChild(initial);

    const sampleIdx = [0, 15, 29, 30, 55, 79];
    const stamped = {};
    const lis = initial.querySelectorAll("li");
    for (const i of sampleIdx) {
      lis[i].__probe = `probe-${i}`;
      stamped[i] = lis[i];
    }

    const reordered = texts.slice(30).concat(texts.slice(0, 30));
    const final = make(
      `<ul>${reordered.map((t) => `<li class="item">${t}</li>`).join("")}</ul>`,
    );

    Idiomorph.morph(initial, final);

    for (const i of sampleIdx) {
      const match = Array.from(initial.querySelectorAll("li")).find(
        (li) => li.textContent === `unique text ${i}`,
      );
      (match === stamped[i]).should.equal(true);
      match.__probe.should.equal(`probe-${i}`);
    }
    initial.querySelectorAll("li").length.should.equal(N);
  });
});
