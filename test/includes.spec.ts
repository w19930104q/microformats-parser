import { expect, describe, it } from "vitest";

import { mf2 } from "../src/index.js";

const options = {
  baseUrl: "http://example.com",
};

const emptyDocument = { "rel-urls": {}, rels: {} };

/**
 * Regression tests for v1 reference expansion (itemref, include class,
 * td[headers]). References must be expanded in order of appearance, at most
 * once per root, without recursing on cyclic references and without sharing
 * state between roots.
 */
describe("mf2() // includes", () => {
  it("should skip a self-referencing itemref edge and keep the root's own fields", () => {
    const html = `<div class="vcard" id="self" itemref="self">
      <span class="fn">Alice</span>
    </div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [{ type: ["h-card"], properties: { name: ["Alice"] } }],
    });
  });

  it("should terminate on a two-node reference cycle", () => {
    const html = `<div class="vcard" itemref="x y">
        <span class="fn">Root</span>
      </div>
      <div id="x" itemref="y"><span class="nickname">X</span></div>
      <div id="y" itemref="x"><span class="nickname">Y</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Root"], nickname: ["X", "Y"] },
        },
      ],
    });
  });

  it("should expand a shared fragment only once per root (diamond)", () => {
    const html = `<div class="vcard" itemref="b c">
        <span class="fn">Root</span>
      </div>
      <div id="b" itemref="d"><span class="nickname">B</span></div>
      <div id="c" itemref="d"><span class="nickname">C</span></div>
      <div id="d"><span class="nickname">D</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Root"], nickname: ["B", "D", "C"] },
        },
      ],
    });
  });

  it("should give each root an independent copy of a shared fragment", () => {
    const html = `<div class="vcard" itemref="shared"><span class="fn">One</span></div>
      <div class="vcard" itemref="shared"><span class="fn">Two</span></div>
      <div id="shared" itemref="inner"><span class="nickname">Shared</span></div>
      <div id="inner"><span class="nickname">Inner</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["One"], nickname: ["Shared", "Inner"] },
        },
        {
          type: ["h-card"],
          properties: { name: ["Two"], nickname: ["Shared", "Inner"] },
        },
      ],
    });
  });

  it("should use the first element in document order for duplicate IDs", () => {
    const html = `<div class="vcard" itemref="dup"><span class="fn">Root</span></div>
      <div id="dup"><span class="nickname">First</span></div>
      <div id="dup"><span class="nickname">Second</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Root"], nickname: ["First"] },
        },
      ],
    });
  });

  it("should ignore itemref on v2 roots while expanding it on v1 roots", () => {
    const html = `<div class="h-card" itemref="shared-v2"><span class="p-name">V2</span></div>
      <div class="vcard" itemref="shared-v1"><span class="fn">V1</span></div>
      <div id="shared-v2"><span class="p-nickname">NotIncluded</span></div>
      <div id="shared-v1"><span class="nickname">Included</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        { type: ["h-card"], properties: { name: ["V2"] } },
        {
          type: ["h-card"],
          properties: { name: ["V1"], nickname: ["Included"] },
        },
      ],
    });
  });

  it("should tokenize itemref on HTML whitespace and keep reference order", () => {
    const html = `<div class="vcard" itemref="  a&#9;b&#10;&#13;c  ">
        <span class="fn">Root</span>
      </div>
      <div id="c"><span class="nickname">C</span></div>
      <div id="b"><span class="nickname">B</span></div>
      <div id="a"><span class="nickname">A</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Root"], nickname: ["A", "B", "C"] },
        },
      ],
    });
  });

  it("should tokenize td[headers] on HTML whitespace", () => {
    const html = `<table>
        <tr><th id="org1"><span class="org">OrgOne</span></th></tr>
        <tr><th id="org2"><span class="org">OrgTwo</span></th></tr>
        <tr><td class="vcard" headers="org1 org2"><span class="fn">Chris</span></td></tr>
      </table>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Chris"], org: ["OrgOne", "OrgTwo"] },
        },
      ],
    });
  });

  it("should not let a missing target affect the remaining fields", () => {
    const html = `<div class="vcard" itemref="missing real">
        <span class="fn">Root</span>
      </div>
      <div id="real"><span class="nickname">R</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Root"], nickname: ["R"] },
        },
      ],
    });
  });

  it("should dedupe repeated references but keep genuine duplicate fields", () => {
    const html = `<div class="vcard" itemref="d d">
        <span class="fn">Root</span>
        <span class="nickname">Own</span>
      </div>
      <div id="d"><span class="nickname">Dup</span><span class="nickname">Dup</span></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: { name: ["Root"], nickname: ["Own", "Dup", "Dup"] },
        },
      ],
    });
  });

  it("should resolve relative URLs in included fragments against the base URL", () => {
    const html = `<div class="vcard" itemref="frag"><span class="fn">Root</span></div>
      <div id="frag"><a class="url" href="/about">About</a></div>`;

    expect(mf2(html, options)).to.deep.equal({
      ...emptyDocument,
      items: [
        {
          type: ["h-card"],
          properties: {
            name: ["Root"],
            url: ["http://example.com/about"],
          },
        },
      ],
    });
  });
});
