import { assertEquals } from "jsr:@std/assert@1";
import { isAllowedProductUrl, parseProductPage } from "./product-import.ts";

const HTML = `<html><head>
<meta property="og:title" content="Fallback">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":"BreadcrumbList","itemListElement":[
 {"position":1,"item":{"name":"Computer"}},
 {"position":2,"item":{"name":"Monitore"}},
 {"position":3,"item":{"name":"Dell U2723QE"}}]},
{"@type":"Product","name":"Dell UltraSharp U2723QE &amp; Kabel","description":"<p>27&quot; 4K</p>",
 "sku":"1234567","brand":{"@type":"Brand","name":"Dell"},
 "image":["/img/a.jpg"],
 "offers":{"@type":"Offer","price":"599.00","priceCurrency":"CHF"},
 "additionalProperty":[{"name":"Diagonale","value":"27 Zoll"}]}]}
</script></head></html>`;

Deno.test("parseProductPage liest JSON-LD", () => {
  const url = new URL("https://www.brack.ch/dell-u2723qe-1234567");
  const product = parseProductPage(HTML, url)!;
  assertEquals(product.name, "Dell UltraSharp U2723QE & Kabel");
  assertEquals(product.description, '27" 4K');
  assertEquals(product.articleNumber, "1234567");
  assertEquals(product.category, "Monitore");
  assertEquals(product.price, "599.00 CHF");
  assertEquals(product.imageUrl, "https://www.brack.ch/img/a.jpg");
  assertEquals(
    product.specifications.properties,
    "Hersteller: Dell\nDiagonale: 27 Zoll",
  );
});

Deno.test(
  "parseProductPage fällt auf Open Graph zurück und erkennt leere Seiten",
  () => {
    const url = new URL("https://www.brack.ch/x");
    assertEquals(
      parseProductPage('<meta property="og:title" content="Maus">', url)?.name,
      "Maus",
    );
    assertEquals(parseProductPage("<html></html>", url), null);
  },
);

Deno.test("isAllowedProductUrl erlaubt nur Brack über https", () => {
  assertEquals(!!isAllowedProductUrl("https://www.brack.ch/a"), true);
  assertEquals(!!isAllowedProductUrl("https://brack.ch/a"), true);
  assertEquals(!!isAllowedProductUrl("http://www.brack.ch/a"), false);
  assertEquals(!!isAllowedProductUrl("https://brack.ch.evil.com/a"), false);
  assertEquals(!!isAllowedProductUrl("https://user:x@brack.ch/a"), false);
  assertEquals(!!isAllowedProductUrl("https://127.0.0.1/"), false);
});

Deno.test("Technische Daten aus Tabellen werden den Feldern zugeordnet", () => {
  const html = `<html><head><meta property="og:title" content="Maus"></head><body>
  <img src="https://assets.brack.ch/images/logo.png">
  <img src="https://assets.brack.ch/images/maus-gross.jpg?x=1">
  <table><tr><th>Lieferumfang</th><td>Maus, Empfänger, Kabel</td></tr>
  <tr><th>Schnittstelle</th><td>USB-A</td></tr>
  <tr><th>Gewicht</th><td>141 g</td></tr></table></body></html>`;
  const product = parseProductPage(html, new URL("https://www.brack.ch/x"))!;
  assertEquals(product.specifications.scope, "Maus, Empfänger, Kabel");
  assertEquals(product.specifications.connectivity, "Schnittstelle: USB-A");
  assertEquals(product.specifications.properties, "Gewicht: 141 g");
  assertEquals(
    product.imageUrl,
    "https://assets.brack.ch/images/maus-gross.jpg?x=1",
  );
});
