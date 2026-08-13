import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { renderRichText, renderMentionNodes } from "@/lib/mention-render";

function toHtml(node: React.ReactNode): string {
  return renderToStaticMarkup(<>{node}</>);
}

describe("renderRichText()", () => {
  it("returns the original string unchanged for plain text", () => {
    expect(renderRichText("hello world")).toBe("hello world");
  });

  it("returns falsy for empty string", () => {
    expect(renderRichText("")).toBeFalsy();
  });

  it("auto-links a bare https URL", () => {
    const html = toHtml(renderRichText("see https://example.com for details"));
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("https://example.com");
    expect(html).toContain("see ");
    expect(html).toContain(" for details");
  });

  it("auto-links a bare http URL", () => {
    const html = toHtml(renderRichText("visit http://example.com now"));
    expect(html).toContain('<a href="http://example.com"');
  });

  it("renders a URL that is the entire string", () => {
    const html = toHtml(renderRichText("https://cpbuild.com"));
    expect(html).toContain('<a href="https://cpbuild.com"');
  });

  it("renders multiple URLs in the same string", () => {
    const html = toHtml(renderRichText("a https://one.com b https://two.com c"));
    expect(html).toContain('href="https://one.com"');
    expect(html).toContain('href="https://two.com"');
  });

  it("renders an @mention as a highlighted span", () => {
    const html = toHtml(renderRichText("hi @[Alice](user-1) there"));
    expect(html).toContain("<span");
    expect(html).toContain("@Alice");
    expect(html).toContain("hi ");
    expect(html).toContain(" there");
    expect(html).not.toContain("@[Alice](user-1)");
  });

  it("renders mixed content: mention + URL + plain text", () => {
    const html = toHtml(
      renderRichText("@[Bob](user-2) check https://example.com please")
    );
    expect(html).toContain("@Bob");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain(" check ");
    expect(html).toContain(" please");
  });

  it("does not double-render mention syntax inside an already-matched mention", () => {
    const html = toHtml(renderRichText("@[Alice](user-1)"));
    expect(html.match(/@Alice/g)?.length).toBe(1);
  });
});

describe("renderMentionNodes()", () => {
  it("returns plain string when there are no mentions", () => {
    expect(renderMentionNodes("no mentions here")).toBe("no mentions here");
  });

  it("renders a mention as a span chip", () => {
    const html = toHtml(renderMentionNodes("hey @[Carol](user-3) there"));
    expect(html).toContain("<span");
    expect(html).toContain("@Carol");
    expect(html).not.toContain("@[Carol](user-3)");
  });
});
