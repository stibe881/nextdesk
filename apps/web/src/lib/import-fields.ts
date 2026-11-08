import type { ImportField } from "./csv-import";

const CATEGORY_OPTIONS: Record<string, string[]> = {
  server: ["server"],
  switch: ["switch", "switches"],
  access_point: ["access point", "accesspoint", "ap", "wlan", "wlan-ap"],
  firewall: ["firewall"],
  router: ["router"],
  storage: ["storage", "nas", "san"],
  ups: ["usv", "ups"],
  virtual_host: ["virtualisierung", "hypervisor", "esx", "hyper-v", "vm-host"],
  other: ["sonstiges", "andere", "other"],
};

/** Columns of the infrastructure import. */
export const INFRASTRUCTURE_IMPORT_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["bezeichnung", "gerät", "geraet", "device"],
    maxLength: 240,
  },
  {
    key: "category",
    label: "Kategorie",
    required: true,
    aliases: ["typ", "gerätetyp", "type"],
    type: "enum",
    options: CATEGORY_OPTIONS,
  },
  {
    key: "hostname",
    label: "Hostname",
    aliases: ["host", "dns"],
    maxLength: 253,
  },
  {
    key: "ipAddress",
    label: "IP-Adresse",
    aliases: ["ip", "ipv4"],
    maxLength: 64,
  },
  { key: "macAddress", label: "MAC-Adresse", aliases: ["mac"], maxLength: 32 },
  {
    key: "manufacturer",
    label: "Hersteller",
    aliases: ["vendor", "marke"],
    maxLength: 160,
  },
  {
    key: "model",
    label: "Modell",
    aliases: ["model", "typenbezeichnung"],
    maxLength: 160,
  },
  {
    key: "serialNumber",
    label: "Seriennummer",
    aliases: ["serial", "sn", "s/n"],
    maxLength: 160,
  },
  {
    key: "inventoryNumber",
    label: "Inventarnummer",
    aliases: ["inventar", "inventarnr"],
    maxLength: 160,
  },
  {
    key: "firmwareVersion",
    label: "Firmware",
    aliases: ["firmwareversion", "version", "os"],
    maxLength: 120,
  },
  {
    key: "location",
    label: "Standort",
    aliases: ["ort", "location", "raum"],
    maxLength: 160,
  },
  { key: "rack", label: "Rack", aliases: ["schrank"], maxLength: 80 },
  {
    key: "rackUnit",
    label: "Höheneinheit",
    aliases: ["he", "u", "rackunit"],
    maxLength: 20,
  },
  {
    key: "purchaseDate",
    label: "Kaufdatum",
    aliases: ["gekauft", "anschaffung"],
    type: "date",
  },
  {
    key: "purchasePrice",
    label: "Kaufpreis",
    aliases: ["preis", "price"],
    type: "number",
  },
  {
    key: "supplier",
    label: "Lieferant",
    aliases: ["supplier", "händler"],
    maxLength: 160,
  },
  {
    key: "warrantyUntil",
    label: "Garantie bis",
    aliases: ["garantie", "warranty"],
    type: "date",
  },
  {
    key: "supportUntil",
    label: "Support bis",
    aliases: ["support", "wartungsvertrag"],
    type: "date",
  },
  { key: "endOfLife", label: "End of Life", aliases: ["eol"], type: "date" },
  {
    key: "criticality",
    label: "Kritikalität",
    aliases: ["kritisch", "criticality"],
    type: "enum",
    options: {
      low: ["niedrig", "tief"],
      medium: ["mittel", "normal"],
      high: ["hoch"],
      critical: ["kritisch", "sehr hoch"],
    },
  },
  {
    key: "maintenanceIntervalMonths",
    label: "Wartungsintervall (Monate)",
    aliases: ["wartungsintervall", "intervall"],
    type: "integer",
  },
  {
    key: "notes",
    label: "Notizen",
    aliases: ["bemerkung", "kommentar"],
    maxLength: 4000,
  },
];

/** Columns of the general asset import (laptops, phones, printers …). */
export const ASSET_IMPORT_FIELDS: ImportField[] = [
  {
    key: "name",
    label: "Name",
    required: true,
    aliases: ["bezeichnung", "gerät", "geraet", "device"],
    maxLength: 240,
  },
  {
    key: "kind",
    label: "Art",
    aliases: ["typ", "gerätetyp", "kategorie"],
    maxLength: 64,
  },
  {
    key: "manufacturer",
    label: "Hersteller",
    aliases: ["vendor", "marke"],
    maxLength: 160,
  },
  { key: "model", label: "Modell", aliases: ["model"], maxLength: 160 },
  {
    key: "serialNumber",
    label: "Seriennummer",
    aliases: ["serial", "sn"],
    maxLength: 160,
  },
  {
    key: "inventoryNumber",
    label: "Inventarnummer",
    aliases: ["inventar", "inventarnr"],
    maxLength: 160,
  },
  {
    key: "assetTag",
    label: "Asset-Tag",
    aliases: ["tag", "assettag"],
    maxLength: 160,
  },
  {
    key: "operatingSystem",
    label: "Betriebssystem",
    aliases: ["os", "system"],
    maxLength: 160,
  },
];
