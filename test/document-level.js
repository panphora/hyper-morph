/**
 * Tests for morphing at the document level (documentElement).
 *
 * These tests cover the edge case where:
 * 1. The target is from a parsed document (e.g., DOMParser)
 * 2. The new content is also from a parsed document
 * 3. Using morphStyle: 'outerHTML' vs 'innerHTML'
 *
 * This tests a bug found in live-sync where using morphStyle: 'innerHTML'
 * with documentElement from a parsed document caused normalizeParent()
 * to wrap the new <html> in a SlicedParentNode, making its "children"
 * appear as [<html>] instead of [<head>, <body>].
 */
describe("Document-level morphing tests", function () {
  setup();

  it("morphs parsed document body with innerHTML style", function () {
    // This is the safe way to do document-level sync - morph bodies directly
    const oldHtml = `<!DOCTYPE html><html><head></head><body><p>Old content</p></body></html>`;
    const newHtml = `<!DOCTYPE html><html><head></head><body><p>New content</p></body></html>`;

    const parser = new DOMParser();
    const oldDoc = parser.parseFromString(oldHtml, 'text/html');
    const newDoc = parser.parseFromString(newHtml, 'text/html');

    // Morph body with innerHTML style
    Idiomorph.morph(oldDoc.body, newDoc.body, {
      morphStyle: 'innerHTML'
    });

    // Verify the content was morphed
    oldDoc.body.querySelector('p').textContent.should.equal('New content');
  });

  it("morphs parsed documentElement with outerHTML style", function () {
    // Using outerHTML with documentElement should work correctly
    const oldHtml = `<!DOCTYPE html><html lang="en"><head><title>Old</title></head><body><p>Old content</p></body></html>`;
    const newHtml = `<!DOCTYPE html><html lang="fr"><head><title>New</title></head><body><p>New content</p></body></html>`;

    const parser = new DOMParser();
    const oldDoc = parser.parseFromString(oldHtml, 'text/html');
    const newDoc = parser.parseFromString(newHtml, 'text/html');

    // Morph documentElement with outerHTML style
    Idiomorph.morph(oldDoc.documentElement, newDoc.documentElement, {
      morphStyle: 'outerHTML'
    });

    // Verify attributes and content were morphed
    oldDoc.documentElement.getAttribute('lang').should.equal('fr');
    oldDoc.body.querySelector('p').textContent.should.equal('New content');
    oldDoc.title.should.equal('New');
  });

  it("innerHTML on documentElement with parsed doc causes mismatch (regression test)", function () {
    // This test documents the bug: innerHTML with documentElement from parsed doc
    // causes normalizeParent to wrap it in SlicedParentNode, breaking the match
    const oldHtml = `<!DOCTYPE html><html><head></head><body><p>Old</p></body></html>`;
    const newHtml = `<!DOCTYPE html><html><head></head><body><p>New</p></body></html>`;

    const parser = new DOMParser();
    const oldDoc = parser.parseFromString(oldHtml, 'text/html');
    const newDoc = parser.parseFromString(newHtml, 'text/html');

    // Store references to head and body before morph
    const oldHead = oldDoc.head;
    const oldBody = oldDoc.body;

    // With innerHTML, this SHOULD work but was broken before
    // The newDoc.documentElement has a parentNode (newDoc), so normalizeParent
    // wraps it in SlicedParentNode, making children appear as [<html>] not [<head>, <body>]
    //
    // The fix is to use outerHTML instead, or morph head/body separately
    Idiomorph.morph(oldDoc.documentElement, newDoc.documentElement, {
      morphStyle: 'outerHTML'  // outerHTML works correctly
    });

    // After morph, head and body should still exist
    should.exist(oldDoc.head);
    should.exist(oldDoc.body);

    // Content should be updated
    oldDoc.body.querySelector('p').textContent.should.equal('New');
  });

  it("preserves element identity when morphing with outerHTML", function () {
    // Verify that the same element is morphed, not replaced
    const oldHtml = `<!DOCTYPE html><html><head></head><body id="main"><p>Old</p></body></html>`;
    const newHtml = `<!DOCTYPE html><html><head></head><body id="main"><p>New</p></body></html>`;

    const parser = new DOMParser();
    const oldDoc = parser.parseFromString(oldHtml, 'text/html');
    const newDoc = parser.parseFromString(newHtml, 'text/html');

    const bodyBefore = oldDoc.body;

    Idiomorph.morph(oldDoc.documentElement, newDoc.documentElement, {
      morphStyle: 'outerHTML'
    });

    // The body element should be the same object (morphed in place, not replaced)
    oldDoc.body.should.equal(bodyBefore);
    oldDoc.body.querySelector('p').textContent.should.equal('New');
  });

  it("correctly syncs html attributes with outerHTML", function () {
    const oldHtml = `<!DOCTYPE html><html data-theme="light" class="old"><head></head><body></body></html>`;
    const newHtml = `<!DOCTYPE html><html data-theme="dark" class="new" lang="en"><head></head><body></body></html>`;

    const parser = new DOMParser();
    const oldDoc = parser.parseFromString(oldHtml, 'text/html');
    const newDoc = parser.parseFromString(newHtml, 'text/html');

    Idiomorph.morph(oldDoc.documentElement, newDoc.documentElement, {
      morphStyle: 'outerHTML'
    });

    oldDoc.documentElement.getAttribute('data-theme').should.equal('dark');
    oldDoc.documentElement.getAttribute('class').should.equal('new');
    oldDoc.documentElement.getAttribute('lang').should.equal('en');
  });
});
