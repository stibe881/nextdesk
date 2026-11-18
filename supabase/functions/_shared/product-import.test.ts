import { assertEquals } from "jsr:@std/assert@1";
import {
  isAllowedImageUrl,
  isAllowedProductUrl,
  parseProductPage,
} from "./product-import.ts";

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

Deno.test(
  "Brack-Business-Seite: Eigenschaften, Weitere Angaben, kein Zubehör, Bilder von Competec",
  () => {
    const html = `<html><head><title>x</title></head><body>
  <img src="https://cdn.competec.ch/manufacturers/2/0/2050@2x.jpg">
  <h1>Logitech Maus MX Master 4 Bluetooth RF Wireless Schwarz</h1>
  <ul>
   <li><span>Maus-Typ:</span> <span>Standard</span></li>
   <li><span>Maus-Features:</span> <span>Daumentaste, Scrollrad, Silent-Tasten</span></li>
   <li><span>Detailfarbe:</span> <span>Graphit</span></li>
   <li><span>Schnittstelle:</span> <span>Bluetooth, USB-C</span></li>
   <li><span>Verbindungsart:</span> <span>kabellos</span></li>
  </ul>
  <div>Weitere Angaben</div>
  <div>Artikelnummer: 1969905</div><div>Herst.-Nr.: 910-007562</div>
  <div>Herstellerseite: Logitech</div><div>Herstellergarantie: 24 Monate</div>
  <div>Verkauf seit: 27.10.2025</div><div>EAN: 5099206133082</div><div>Lagerbestand: +153</div>
  <a href="https://cdn.competec.ch/images2/8/9/7/401302798/401302798_xxl3.jpg"><img src="https://cdn.competec.ch/images2/8/9/7/401302798/401302798_xxl.jpg"></a>
  <img src="https://cdn.competec.ch/images2/0/9/7/401302790/401302790_xxl.jpg">
  <img src="https://cdn.competec.ch/images2/8/9/7/401302798/401302798_xs.jpg">
  <img src="https://cdn.competec.ch/images2/8/9/7/401302798/401302798_xxs.jpg">
  <h2>Zubehör18</h2>
  <table><tr><td>Artikelnummer :</td><td>808245</td></tr><tr><td>Kategorie :</td><td>Maus</td></tr></table>
  </body></html>`;
    const product = parseProductPage(
      html,
      new URL("https://business.brack.ch/de/product/1969905"),
    )!;
    assertEquals(product.articleNumber, "1969905");
    assertEquals(
      product.specifications.connectivity,
      "Schnittstelle: Bluetooth, USB-C\nVerbindungsart: kabellos",
    );
    assertEquals(
      product.specifications.equipment,
      "Maus-Features: Daumentaste, Scrollrad, Silent-Tasten",
    );
    assertEquals(
      product.specifications.properties,
      "Maus-Typ: Standard\nDetailfarbe: Graphit\nHerstellergarantie: 24 Monate",
    );
    assertEquals(product.imageUrls, [
      "https://cdn.competec.ch/images2/8/9/7/401302798/401302798_xxl.jpg",
      "https://cdn.competec.ch/images2/0/9/7/401302790/401302790_xxl.jpg",
    ]);
    assertEquals(!!isAllowedImageUrl("https://cdn.competec.ch/x.jpg"), true);
    assertEquals(!!isAllowedProductUrl("https://cdn.competec.ch/x.jpg"), false);
  },
);
