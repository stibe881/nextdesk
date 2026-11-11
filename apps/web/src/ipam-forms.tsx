import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  FormCard,
  FormDialog,
  FormField,
  FormGrid,
  FormNote,
  FormSummary,
} from "./form-kit";
import { ipamCall } from "./lib/ipam-api";
import { formatCidr, parseCidr, splitCidr } from "./lib/ipam-cidr";
import {
  ADDRESS_STATUS_LABEL,
  childLengths,
  customFieldRows,
  customFieldsFromRows,
  defaultChildLength,
  DEVICE_TYPE_LABEL,
  PREFIX_STATUS_LABEL,
  parseTagInput,
  vlanLabel,
  type AddressStatus,
  type DepartmentOption,
  type FieldRow,
  type IpamAddress,
  type IpamPrefix,
  type IpamSite,
  type IpamVlan,
  type IpamVrf,
  type NamedOption,
  type PrefixStatus,
} from "./lib/ipam-model";

export type IpamLookups = {
  vrfs: IpamVrf[];
  sites: IpamSite[];
  vlans: IpamVlan[];
  departments: DepartmentOption[];
  people: NamedOption[];
  teams: NamedOption[];
  services: NamedOption[];
};

type Saved = (message: string) => void;

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Die Änderung konnte nicht gespeichert werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Department select; only shown when the person has several departments. */
function DepartmentField({
  departments,
  onChange,
  value,
}: {
  departments: DepartmentOption[];
  onChange: (value: string) => void;
  value: string;
}) {
  if (departments.length <= 1) return null;
  return (
    <FormField
      hint="Ohne Abteilung ist der Eintrag für alle Abteilungen sichtbar."
      label="Abteilung"
    >
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Alle Abteilungen</option>
        {departments.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function OptionSelect({
  empty,
  onChange,
  options,
  value,
}: {
  empty: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  value: string;
}) {
  return (
    <select onChange={(event) => onChange(event.target.value)} value={value}>
      <option value="">{empty}</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}

function vlanOptions(vlans: IpamVlan[], sites: IpamSite[]) {
  return vlans.map((vlan) => {
    const site = sites.find((entry) => entry.id === vlan.siteId);
    return {
      id: vlan.id,
      name: `${vlanLabel(vlan)}${site ? ` (${site.name})` : ""}`,
    };
  });
}

// ---------------------------------------------------------------------------

export function VrfDialog({
  initial,
  onClose,
  onSaved,
  tenantId,
}: {
  initial: IpamVrf | null;
  onClose: () => void;
  onSaved: Saved;
  tenantId: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rd, setRd] = useState(initial?.routeDistinguisher ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const { busy, error, run } = useSubmit(onClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await ipamCall({
        type: "saveVrf",
        tenantId,
        vrf: {
          id: initial?.id ?? null,
          name,
          routeDistinguisher: rd,
          description,
        },
      });
      onSaved(initial ? "VRF gespeichert." : "VRF angelegt.");
    });
  };
  return (
    <FormDialog
      error={error}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={submit}
      submitting={busy}
      title={initial ? "VRF bearbeiten" : "VRF anlegen"}
    >
      <FormCard title="VRF">
        <FormNote>
          Ein VRF ist eine eigene Routing-Tabelle. Gleiche Subnetze dürfen in
          verschiedenen VRFs vorkommen, innerhalb eines VRF nicht.
        </FormNote>
        <FormGrid>
          <FormField label="Name" required>
            <input
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </FormField>
          <FormField label="Route Distinguisher" optional>
            <input
              maxLength={40}
              onChange={(event) => setRd(event.target.value)}
              placeholder="65000:100"
              value={rd}
            />
          </FormField>
        </FormGrid>
        <FormField label="Beschreibung" optional>
          <textarea
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            value={description}
          />
        </FormField>
      </FormCard>
    </FormDialog>
  );
}

export function SiteDialog({
  initial,
  lookups,
  onClose,
  onSaved,
  tenantId,
}: {
  initial: IpamSite | null;
  lookups: IpamLookups;
  onClose: () => void;
  onSaved: Saved;
  tenantId: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? "");
  const { busy, error, run } = useSubmit(onClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await ipamCall({
        type: "saveSite",
        tenantId,
        site: {
          id: initial?.id ?? null,
          name,
          code,
          address,
          description,
          departmentId: departmentId || null,
        },
      });
      onSaved(initial ? "Standort gespeichert." : "Standort angelegt.");
    });
  };
  return (
    <FormDialog
      error={error}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={submit}
      submitting={busy}
      title={initial ? "Standort bearbeiten" : "Standort anlegen"}
    >
      <FormCard title="Standort">
        <FormGrid>
          <FormField label="Name" required>
            <input
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Haus A, 2. OG"
              required
              value={name}
            />
          </FormField>
          <FormField label="Kürzel" optional>
            <input
              maxLength={40}
              onChange={(event) => setCode(event.target.value)}
              placeholder="HA2"
              value={code}
            />
          </FormField>
        </FormGrid>
        <FormField label="Adresse" optional>
          <input
            maxLength={300}
            onChange={(event) => setAddress(event.target.value)}
            value={address}
          />
        </FormField>
        <FormField label="Beschreibung" optional>
          <textarea
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            value={description}
          />
        </FormField>
        <DepartmentField
          departments={lookups.departments}
          onChange={setDepartmentId}
          value={departmentId}
        />
      </FormCard>
    </FormDialog>
  );
}

export function VlanDialog({
  initial,
  lookups,
  onClose,
  onSaved,
  tenantId,
}: {
  initial: IpamVlan | null;
  lookups: IpamLookups;
  onClose: () => void;
  onSaved: Saved;
  tenantId: string;
}) {
  const [vlanNumber, setVlanNumber] = useState(
    initial ? String(initial.vlanNumber) : "",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [siteId, setSiteId] = useState(initial?.siteId ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? "");
  const { busy, error, run } = useSubmit(onClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await ipamCall({
        type: "saveVlan",
        tenantId,
        vlan: {
          id: initial?.id ?? null,
          vlanNumber: Number(vlanNumber),
          name,
          siteId: siteId || null,
          description,
          departmentId: departmentId || null,
        },
      });
      onSaved(initial ? "VLAN gespeichert." : "VLAN angelegt.");
    });
  };
  return (
    <FormDialog
      error={error}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={submit}
      submitting={busy}
      title={initial ? "VLAN bearbeiten" : "VLAN anlegen"}
    >
      <FormCard title="VLAN">
        <FormGrid>
          <FormField label="VLAN-ID" required>
            <input
              inputMode="numeric"
              max={4094}
              min={1}
              onChange={(event) => setVlanNumber(event.target.value)}
              required
              type="number"
              value={vlanNumber}
            />
          </FormField>
          <FormField label="Name" required>
            <input
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Clients-A"
              required
              value={name}
            />
          </FormField>
        </FormGrid>
        <FormField
          hint="Dieselbe VLAN-ID darf an verschiedenen Standorten vorkommen."
          label="Standort"
          optional
        >
          <OptionSelect
            empty="Ohne Standort"
            onChange={setSiteId}
            options={lookups.sites}
            value={siteId}
          />
        </FormField>
        <FormField label="Beschreibung" optional>
          <textarea
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            value={description}
          />
        </FormField>
        <DepartmentField
          departments={lookups.departments}
          onChange={setDepartmentId}
          value={departmentId}
        />
      </FormCard>
    </FormDialog>
  );
}

export function PrefixDialog({
  initial,
  lookups,
  onClose,
  onSaved,
  tenantId,
}: {
  initial: IpamPrefix | null;
  lookups: IpamLookups;
  onClose: () => void;
  onSaved: (message: string, id: string) => void;
  tenantId: string;
}) {
  const [prefix, setPrefix] = useState(initial?.prefix ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [vrfId, setVrfId] = useState(initial?.vrfId ?? "");
  const [status, setStatus] = useState<PrefixStatus>(
    initial?.status ?? "active",
  );
  const [vlanId, setVlanId] = useState(initial?.vlanId ?? "");
  const [siteId, setSiteId] = useState(initial?.siteId ?? "");
  const [securityZone, setSecurityZone] = useState(initial?.securityZone ?? "");
  const [gateway, setGateway] = useState(initial?.gateway ?? "");
  const [gatewayDevice, setGatewayDevice] = useState(
    initial?.gatewayDevice ?? "",
  );
  const [dhcpStart, setDhcpStart] = useState(initial?.dhcpStart ?? "");
  const [dhcpEnd, setDhcpEnd] = useState(initial?.dhcpEnd ?? "");
  const [dhcpHelper, setDhcpHelper] = useState(initial?.dhcpHelper ?? "");
  const [warning, setWarning] = useState(
    String(initial?.utilizationWarningPercent ?? 85),
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [fields, setFields] = useState<FieldRow[]>(
    customFieldRows(initial?.customFields),
  );
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? "");
  const { busy, error, run } = useSubmit(onClose);
  const valid = parseCidr(prefix.trim()) !== null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await ipamCall<{ id: string }>({
        type: "savePrefix",
        tenantId,
        prefix: {
          id: initial?.id ?? null,
          prefix,
          description,
          vrfId: vrfId || null,
          status,
          vlanId: vlanId || null,
          siteId: siteId || null,
          securityZone,
          gateway,
          gatewayDevice,
          dhcpStart,
          dhcpEnd,
          dhcpHelper,
          utilizationWarningPercent: Number(warning),
          tags: parseTagInput(tags),
          customFields: customFieldsFromRows(fields),
          departmentId: departmentId || null,
        },
      });
      onSaved(
        initial ? "Subnetz gespeichert." : "Subnetz angelegt.",
        result.id,
      );
    });
  };
  return (
    <FormDialog
      error={error}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={submit}
      side={
        <FormSummary
          eyebrow="Subnetz"
          rows={[
            [
              "VRF",
              lookups.vrfs.find((vrf) => vrf.id === vrfId)?.name ?? "Global",
            ],
            ["Status", PREFIX_STATUS_LABEL[status]],
            [
              "VLAN",
              vlanLabel(lookups.vlans.find((vlan) => vlan.id === vlanId)) ?? "",
            ],
          ]}
          title={prefix || "Neues Subnetz"}
        />
      }
      submitting={busy}
      title={initial ? "Subnetz bearbeiten" : "Subnetz anlegen"}
    >
      <FormCard title="Netz">
        <FormGrid>
          <FormField
            hint={
              prefix && !valid
                ? "Bitte als Netzadresse mit Präfixlänge erfassen, z. B. 10.20.30.0/24."
                : "IPv4 oder IPv6, z. B. 10.20.30.0/24 oder fd12:3456::/48"
            }
            label="Subnetz (CIDR)"
            required
          >
            <input
              autoComplete="off"
              onChange={(event) => setPrefix(event.target.value)}
              required
              spellCheck={false}
              value={prefix}
            />
          </FormField>
          <FormField label="Beschreibung" optional>
            <input
              maxLength={1000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Clients Haus A"
              value={description}
            />
          </FormField>
          <FormField label="VRF">
            <select
              onChange={(event) => setVrfId(event.target.value)}
              value={vrfId}
            >
              <option value="">Global</option>
              {lookups.vrfs.map((vrf) => (
                <option key={vrf.id} value={vrf.id}>
                  {vrf.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Status">
            <select
              onChange={(event) =>
                setStatus(event.target.value as PrefixStatus)
              }
              value={status}
            >
              {(Object.keys(PREFIX_STATUS_LABEL) as PrefixStatus[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {PREFIX_STATUS_LABEL[key]}
                  </option>
                ),
              )}
            </select>
          </FormField>
          <FormField label="VLAN" optional>
            <OptionSelect
              empty="Ohne VLAN"
              onChange={setVlanId}
              options={vlanOptions(lookups.vlans, lookups.sites)}
              value={vlanId}
            />
          </FormField>
          <FormField label="Standort" optional>
            <OptionSelect
              empty="Ohne Standort"
              onChange={setSiteId}
              options={lookups.sites}
              value={siteId}
            />
          </FormField>
        </FormGrid>
        <DepartmentField
          departments={lookups.departments}
          onChange={setDepartmentId}
          value={departmentId}
        />
      </FormCard>
      <FormCard title="Gateway und DHCP">
        <FormGrid>
          <FormField label="Gateway" optional>
            <input
              onChange={(event) => setGateway(event.target.value)}
              placeholder="10.20.30.1"
              spellCheck={false}
              value={gateway}
            />
          </FormField>
          <FormField label="Gateway-Gerät" optional>
            <input
              maxLength={160}
              onChange={(event) => setGatewayDevice(event.target.value)}
              placeholder="Core-Switch"
              value={gatewayDevice}
            />
          </FormField>
          <FormField label="DHCP-Pool von" optional>
            <input
              onChange={(event) => setDhcpStart(event.target.value)}
              placeholder="10.20.30.100"
              spellCheck={false}
              value={dhcpStart}
            />
          </FormField>
          <FormField label="DHCP-Pool bis" optional>
            <input
              onChange={(event) => setDhcpEnd(event.target.value)}
              placeholder="10.20.30.199"
              spellCheck={false}
              value={dhcpEnd}
            />
          </FormField>
          <FormField label="DHCP-Helper" optional>
            <input
              maxLength={200}
              onChange={(event) => setDhcpHelper(event.target.value)}
              value={dhcpHelper}
            />
          </FormField>
          <FormField label="Sicherheitszone" optional>
            <input
              maxLength={60}
              onChange={(event) => setSecurityZone(event.target.value)}
              placeholder="LAN, DMZ, Gäste …"
              value={securityZone}
            />
          </FormField>
        </FormGrid>
      </FormCard>
      <FormCard collapsed title="Warnschwelle, Schlagwörter, eigene Felder">
        <FormGrid>
          <FormField
            hint="Ab dieser Auslastung wird das Subnetz gelb markiert."
            label="Warnschwelle in %"
          >
            <input
              max={100}
              min={50}
              onChange={(event) => setWarning(event.target.value)}
              type="number"
              value={warning}
            />
          </FormField>
          <FormField hint="Mit Komma trennen." label="Schlagwörter" optional>
            <input
              onChange={(event) => setTags(event.target.value)}
              value={tags}
            />
          </FormField>
        </FormGrid>
        <CustomFieldsEditor onChange={setFields} rows={fields} />
      </FormCard>
    </FormDialog>
  );
}

/** Editable list of own fields (name/value). */
export function CustomFieldsEditor({
  onChange,
  rows,
}: {
  onChange: (rows: FieldRow[]) => void;
  rows: FieldRow[];
}) {
  const update = (index: number, patch: Partial<FieldRow>) =>
    onChange(
      rows.map((row, current) =>
        current === index ? { ...row, ...patch } : row,
      ),
    );
  return (
    <div className="ipam-fields">
      <span className="fk-label">Eigene Felder</span>
      {rows.map((row, index) => (
        <div className="ipam-fields__row" key={index}>
          <input
            aria-label="Feldname"
            maxLength={60}
            onChange={(event) => update(index, { key: event.target.value })}
            placeholder="z. B. Inventarnr."
            value={row.key}
          />
          <input
            aria-label="Wert"
            maxLength={500}
            onChange={(event) => update(index, { value: event.target.value })}
            value={row.value}
          />
          <button
            aria-label="Feld entfernen"
            className="text-button"
            onClick={() =>
              onChange(rows.filter((_, current) => current !== index))
            }
            type="button"
          >
            Entfernen
          </button>
        </div>
      ))}
      {rows.length < 30 ? (
        <button
          className="text-button"
          onClick={() => onChange([...rows, { key: "", value: "" }])}
          type="button"
        >
          + Feld hinzufügen
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ReserveDialog({
  lookups,
  onClose,
  onSaved,
  prefix,
  suggestion,
  tenantId,
}: {
  lookups: IpamLookups;
  onClose: () => void;
  onSaved: (message: string, addressId: string) => void;
  prefix: IpamPrefix;
  suggestion: string | null;
  tenantId: string;
}) {
  const [address, setAddress] = useState(suggestion ?? "");
  const [hostname, setHostname] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [reservedUntil, setReservedUntil] = useState("");
  const [deviceType, setDeviceType] = useState("");
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const { busy, error, run } = useSubmit(onClose);

  const fetchSuggestion = async (after: string | null) => {
    setLoadingSuggestion(true);
    setHint(null);
    try {
      const result = await ipamCall<{ address: string | null }>({
        type: "nextFreeAddress",
        tenantId,
        prefixId: prefix.id,
        after,
      });
      if (result.address) setAddress(result.address);
      else setHint("In diesem Subnetz ist keine Adresse mehr frei.");
    } catch (failure) {
      setHint(failure instanceof Error ? failure.message : null);
    } finally {
      setLoadingSuggestion(false);
    }
  };

  useEffect(() => {
    if (!suggestion) void fetchSuggestion(null);
    // Only once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await ipamCall<{ id: string; address: string }>({
        type: "reserveAddress",
        tenantId,
        reservation: {
          prefixId: prefix.id,
          address,
          hostname,
          description,
          ownerUserId: ownerUserId || null,
          teamId: teamId || null,
          reservedUntil: reservedUntil || null,
          deviceType: deviceType || null,
        },
      });
      onSaved(`${result.address} reserviert.`, result.id);
    });
  };
  const inPool =
    prefix.dhcpStart && prefix.dhcpEnd
      ? `DHCP-Pool ${prefix.dhcpStart} – ${prefix.dhcpEnd} wird ausgelassen.`
      : null;
  return (
    <FormDialog
      error={error}
      eyebrow={prefix.prefix}
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={!address || loadingSuggestion}
      submitLabel="Reservieren"
      submitting={busy}
      title="Adresse reservieren"
    >
      <FormCard title="Adresse">
        <FormGrid>
          <FormField
            hint={
              hint ??
              inPool ??
              "Vorschlag ohne Gateway, Netz- und Broadcastadresse."
            }
            label="IP-Adresse"
            required
          >
            <input
              onChange={(event) => setAddress(event.target.value)}
              required
              spellCheck={false}
              value={address}
            />
          </FormField>
          <FormField label="Vorschlag">
            <button
              className="secondary-button"
              disabled={loadingSuggestion}
              onClick={() => void fetchSuggestion(address || null)}
              type="button"
            >
              {loadingSuggestion ? "Sucht …" : "Nächste freie danach"}
            </button>
          </FormField>
          <FormField label="Hostname" optional>
            <input
              maxLength={253}
              onChange={(event) => setHostname(event.target.value)}
              placeholder="DRU-A2-KOPIE"
              value={hostname}
            />
          </FormField>
          <FormField label="Gerätetyp" optional>
            <select
              onChange={(event) => setDeviceType(event.target.value)}
              value={deviceType}
            >
              <option value="">Nicht angegeben</option>
              {Object.entries(DEVICE_TYPE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
        </FormGrid>
        <FormField label="Zweck" optional>
          <input
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Kopierer A2"
            value={description}
          />
        </FormField>
      </FormCard>
      <FormCard title="Verantwortung">
        <FormGrid>
          <FormField label="Verantwortliche Person" optional>
            <OptionSelect
              empty="Niemand"
              onChange={setOwnerUserId}
              options={lookups.people}
              value={ownerUserId}
            />
          </FormField>
          <FormField label="Team" optional>
            <OptionSelect
              empty="Kein Team"
              onChange={setTeamId}
              options={lookups.teams}
              value={teamId}
            />
          </FormField>
          <FormField
            hint="Für Tests, Events oder Lieferanten."
            label="Befristet bis"
            optional
          >
            <input
              onChange={(event) => setReservedUntil(event.target.value)}
              type="date"
              value={reservedUntil}
            />
          </FormField>
        </FormGrid>
      </FormCard>
    </FormDialog>
  );
}

export function NextPrefixDialog({
  lookups,
  onClose,
  onSaved,
  parent,
  tenantId,
}: {
  lookups: IpamLookups;
  onClose: () => void;
  onSaved: (message: string, id: string) => void;
  parent: IpamPrefix;
  tenantId: string;
}) {
  const lengths = childLengths(parent.prefix);
  const [length, setLength] = useState(
    String(defaultChildLength(parent.prefix) ?? lengths[0] ?? ""),
  );
  const [proposal, setProposal] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [vlanId, setVlanId] = useState("");
  const [status, setStatus] = useState<PrefixStatus>("active");
  const { busy, error, run } = useSubmit(onClose);

  useEffect(() => {
    if (!length) return;
    let current = true;
    setChecking(true);
    setHint(null);
    void ipamCall<{ prefix: string | null }>({
      type: "nextFreePrefix",
      tenantId,
      parentId: parent.id,
      length: Number(length),
    })
      .then((result) => {
        if (!current) return;
        setProposal(result.prefix);
        if (!result.prefix)
          setHint(`Im ${parent.prefix} ist kein /${length} mehr frei.`);
      })
      .catch((failure: unknown) => {
        if (current) {
          setProposal(null);
          setHint(failure instanceof Error ? failure.message : null);
        }
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [length, parent.id, parent.prefix, tenantId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await ipamCall<{ id: string; prefix: string }>({
        type: "createPrefix",
        tenantId,
        parentId: parent.id,
        length: Number(length),
        description,
        vlanId: vlanId || null,
        status,
      });
      onSaved(`${result.prefix} angelegt.`, result.id);
    });
  };
  return (
    <FormDialog
      error={error}
      eyebrow={parent.prefix}
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={!proposal || checking}
      submitLabel="Subnetz anlegen"
      submitting={busy}
      title="Nächstes freies Subnetz"
    >
      <FormCard title="Grösse">
        <FormGrid>
          <FormField label="Präfixlänge">
            <select
              onChange={(event) => setLength(event.target.value)}
              value={length}
            >
              {lengths.map((value) => (
                <option key={value} value={value}>
                  /{value}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Vorschlag">
            <output className="ipam-proposal">
              {checking ? "Berechnet …" : (proposal ?? "–")}
            </output>
          </FormField>
        </FormGrid>
        {hint ? <FormNote>{hint}</FormNote> : null}
      </FormCard>
      <FormCard title="Angaben">
        <FormGrid>
          <FormField label="Beschreibung" optional>
            <input
              maxLength={1000}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </FormField>
          <FormField label="Status">
            <select
              onChange={(event) =>
                setStatus(event.target.value as PrefixStatus)
              }
              value={status}
            >
              {(["active", "reserved", "container"] as PrefixStatus[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {PREFIX_STATUS_LABEL[key]}
                  </option>
                ),
              )}
            </select>
          </FormField>
          <FormField label="VLAN" optional>
            <OptionSelect
              empty="Ohne VLAN"
              onChange={setVlanId}
              options={vlanOptions(lookups.vlans, lookups.sites)}
              value={vlanId}
            />
          </FormField>
        </FormGrid>
        <FormNote>
          VRF, Standort, Abteilung und Warnschwelle werden vom übergeordneten
          Subnetz übernommen.
        </FormNote>
      </FormCard>
    </FormDialog>
  );
}

export function SplitDialog({
  onClose,
  onSaved,
  prefix,
  tenantId,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
  prefix: IpamPrefix;
  tenantId: string;
}) {
  const lengths = childLengths(prefix.prefix, 8);
  const [length, setLength] = useState(String(lengths[0] ?? ""));
  const { busy, error, run } = useSubmit(onClose);
  const preview = useMemo(() => {
    const cidr = parseCidr(prefix.prefix);
    return cidr && length ? (splitCidr(cidr, Number(length), 256) ?? []) : [];
  }, [prefix.prefix, length]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await ipamCall<{ created: string[]; skipped: number }>({
        type: "splitPrefix",
        tenantId,
        prefixId: prefix.id,
        length: Number(length),
      });
      onSaved(
        `${result.created.length} Teilnetze angelegt${result.skipped ? `, ${result.skipped} bereits vorhanden` : ""}.`,
      );
    });
  };
  return (
    <FormDialog
      error={error}
      eyebrow={prefix.prefix}
      onClose={onClose}
      onSubmit={submit}
      submitDisabled={!lengths.length}
      submitLabel="Aufteilen"
      submitting={busy}
      title="Subnetz aufteilen"
    >
      <FormCard title="Teilnetze">
        {lengths.length ? (
          <>
            <FormField label="Grösse der Teilnetze">
              <select
                onChange={(event) => setLength(event.target.value)}
                value={length}
              >
                {lengths.map((value) => (
                  <option key={value} value={value}>
                    /{value} (
                    {2 ** (value - Number(prefix.prefix.split("/")[1]))}{" "}
                    Teilnetze)
                  </option>
                ))}
              </select>
            </FormField>
            <ul className="ipam-split-preview">
              {preview.slice(0, 16).map((child) => (
                <li key={formatCidr(child)}>{formatCidr(child)}</li>
              ))}
              {preview.length > 16 ? (
                <li>… und {preview.length - 16} weitere</li>
              ) : null}
            </ul>
            <FormNote>
              Bereits erfasste Teilnetze bleiben unverändert. Ein aktives
              Subnetz wird danach als Supernetz geführt.
            </FormNote>
          </>
        ) : (
          <FormNote>Dieses Subnetz lässt sich nicht weiter aufteilen.</FormNote>
        )}
      </FormCard>
    </FormDialog>
  );
}

export function AddressDialog({
  assets,
  initial,
  lookups,
  onClose,
  onSaved,
  tenantId,
}: {
  assets: { id: string; name: string }[];
  initial: Partial<IpamAddress> & { address: string };
  lookups: IpamLookups;
  onClose: () => void;
  onSaved: (message: string, id: string) => void;
  tenantId: string;
}) {
  const [address, setAddress] = useState(initial.address);
  const [status, setStatus] = useState<AddressStatus>(
    initial.status ?? "active",
  );
  const [hostname, setHostname] = useState(initial.hostname ?? "");
  const [dnsName, setDnsName] = useState(initial.dnsName ?? "");
  const [macAddress, setMacAddress] = useState(initial.macAddress ?? "");
  const [vendor, setVendor] = useState(initial.vendor ?? "");
  const [deviceType, setDeviceType] = useState(initial.deviceType ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [switchName, setSwitchName] = useState(initial.switchName ?? "");
  const [switchPort, setSwitchPort] = useState(initial.switchPort ?? "");
  const [ownerUserId, setOwnerUserId] = useState(initial.ownerUserId ?? "");
  const [teamId, setTeamId] = useState(initial.teamId ?? "");
  const [assetId, setAssetId] = useState(initial.assetId ?? "");
  const [serviceId, setServiceId] = useState(initial.serviceId ?? "");
  const [reservedUntil, setReservedUntil] = useState(
    initial.reservedUntil ?? "",
  );
  const [tags, setTags] = useState((initial.tags ?? []).join(", "));
  const [fields, setFields] = useState<FieldRow[]>(
    customFieldRows(initial.customFields),
  );
  const { busy, error, run } = useSubmit(onClose);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await ipamCall<{ id: string }>({
        type: "saveAddress",
        tenantId,
        address: {
          id: initial.id ?? null,
          address,
          vrfId: initial.vrfId ?? null,
          status,
          hostname,
          dnsName,
          macAddress,
          vendor,
          deviceType: deviceType || null,
          description,
          switchName,
          switchPort,
          ownerUserId: ownerUserId || null,
          teamId: teamId || null,
          assetId: assetId || null,
          serviceId: serviceId || null,
          reservedUntil: reservedUntil || null,
          tags: parseTagInput(tags),
          customFields: customFieldsFromRows(fields),
        },
      });
      onSaved(
        initial.id ? "Adresse gespeichert." : "Adresse erfasst.",
        result.id,
      );
    });
  };
  const assetOptions = useMemo(() => {
    const list = [...assets];
    if (
      initial.assetId &&
      !list.some((asset) => asset.id === initial.assetId)
    ) {
      list.unshift({ id: initial.assetId, name: "Verknüpftes Asset" });
    }
    return list;
  }, [assets, initial.assetId]);
  const section = (title: string, children: ReactNode) => (
    <FormCard title={title}>{children}</FormCard>
  );
  return (
    <FormDialog
      error={error}
      eyebrow="IP-Adressen"
      onClose={onClose}
      onSubmit={submit}
      submitting={busy}
      title={initial.id ? `${initial.address} bearbeiten` : "Adresse erfassen"}
    >
      {section(
        "Adresse",
        <FormGrid>
          <FormField label="IP-Adresse" required>
            <input
              onChange={(event) => setAddress(event.target.value)}
              required
              spellCheck={false}
              value={address}
            />
          </FormField>
          <FormField label="Status">
            <select
              onChange={(event) =>
                setStatus(event.target.value as AddressStatus)
              }
              value={status}
            >
              {(Object.keys(ADDRESS_STATUS_LABEL) as AddressStatus[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {ADDRESS_STATUS_LABEL[key]}
                  </option>
                ),
              )}
            </select>
          </FormField>
          <FormField label="Hostname" optional>
            <input
              maxLength={253}
              onChange={(event) => setHostname(event.target.value)}
              value={hostname}
            />
          </FormField>
          <FormField label="DNS-Name" optional>
            <input
              maxLength={253}
              onChange={(event) => setDnsName(event.target.value)}
              value={dnsName}
            />
          </FormField>
          <FormField label="Beschreibung" optional>
            <input
              maxLength={1000}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </FormField>
          <FormField label="Reserviert bis" optional>
            <input
              onChange={(event) => setReservedUntil(event.target.value)}
              type="date"
              value={reservedUntil}
            />
          </FormField>
        </FormGrid>,
      )}
      {section(
        "Gerät",
        <FormGrid>
          <FormField label="MAC-Adresse" optional>
            <input
              onChange={(event) => setMacAddress(event.target.value)}
              placeholder="00:1E:0B:7A:41:C9"
              spellCheck={false}
              value={macAddress}
            />
          </FormField>
          <FormField label="Hersteller" optional>
            <input
              maxLength={160}
              onChange={(event) => setVendor(event.target.value)}
              value={vendor}
            />
          </FormField>
          <FormField label="Gerätetyp" optional>
            <select
              onChange={(event) => setDeviceType(event.target.value)}
              value={deviceType}
            >
              <option value="">Nicht angegeben</option>
              {Object.entries(DEVICE_TYPE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Switch" optional>
            <input
              maxLength={160}
              onChange={(event) => setSwitchName(event.target.value)}
              placeholder="SW-A2-01"
              value={switchName}
            />
          </FormField>
          <FormField label="Switch-Port" optional>
            <input
              maxLength={80}
              onChange={(event) => setSwitchPort(event.target.value)}
              placeholder="Gi1/0/14"
              value={switchPort}
            />
          </FormField>
        </FormGrid>,
      )}
      {section(
        "Verantwortung und Verknüpfungen",
        <FormGrid>
          <FormField label="Verantwortliche Person" optional>
            <OptionSelect
              empty="Niemand"
              onChange={setOwnerUserId}
              options={lookups.people}
              value={ownerUserId}
            />
          </FormField>
          <FormField label="Team" optional>
            <OptionSelect
              empty="Kein Team"
              onChange={setTeamId}
              options={lookups.teams}
              value={teamId}
            />
          </FormField>
          <FormField label="Asset" optional>
            <OptionSelect
              empty="Kein Asset"
              onChange={setAssetId}
              options={assetOptions}
              value={assetId}
            />
          </FormField>
          <FormField label="Dienst" optional>
            <OptionSelect
              empty="Kein Dienst"
              onChange={setServiceId}
              options={lookups.services}
              value={serviceId}
            />
          </FormField>
        </FormGrid>,
      )}
      <FormCard collapsed title="Schlagwörter und eigene Felder">
        <FormField hint="Mit Komma trennen." label="Schlagwörter" optional>
          <input
            onChange={(event) => setTags(event.target.value)}
            value={tags}
          />
        </FormField>
        <CustomFieldsEditor onChange={setFields} rows={fields} />
      </FormCard>
    </FormDialog>
  );
}
