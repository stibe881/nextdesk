import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Minus,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import {
  EVENT_LABEL,
  ORDER_STATUS_LABEL,
  STOCK_LABEL,
  formatDate,
  newRequestId,
  shopApi,
  SPEC_FIELDS,
  type CatalogItem,
  type InventoryOption,
  type OrderAction,
  type OrderDetail,
  type OrderSummary,
  type ShopContext,
  type ShopCategory,
  type ShopPerson,
} from "./lib/shop";

type Tab = "catalog" | "mine" | "approvals" | "orders" | "manage";
type CartLine = { item: CatalogItem; quantity: number };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Shop({ tenantId }: { tenantId: string }) {
  const [context, setContext] = useState<ShopContext | null>(null);
  const [tab, setTab] = useState<Tab>("catalog");
  const [error, setError] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const reloadContext = useCallback(() => {
    shopApi
      .context(tenantId)
      .then((next) => {
        setContext(next);
        setError("");
      })
      .catch((nextError: Error) => setError(nextError.message));
  }, [tenantId]);

  useEffect(() => {
    setCart([]);
    setTab("catalog");
    reloadContext();
  }, [reloadContext]);

  const refresh = () => {
    setRevision((value) => value + 1);
    reloadContext();
  };

  if (error && !context) {
    return (
      <section className="shop">
        <p className="empty-state">{error}</p>
      </section>
    );
  }
  if (!context) {
    return (
      <section className="shop">
        <p className="empty-state">Shop wird geladen …</p>
      </section>
    );
  }

  const tabs: [Tab, string, number?][] = [
    ["catalog", "Katalog"],
    ["mine", "Meine Bestellungen"],
    ...(context.pendingApprovals > 0 || context.canFulfill
      ? ([["approvals", "Freigaben", context.pendingApprovals]] as [
          Tab,
          string,
          number,
        ][])
      : []),
    ...(context.canFulfill
      ? ([["orders", "Bestellungen bearbeiten", context.openOrders]] as [
          Tab,
          string,
          number,
        ][])
      : []),
    ...(context.canManage
      ? ([["manage", "Artikel verwalten"]] as [Tab, string][])
      : []),
  ];

  return (
    <section className="shop" aria-label="Shop">
      <p className="shop-intro">
        Zubehör bestellen oder Geräte ausleihen. Der Support stellt die
        Bestellung bereit und bucht sie aus dem Lager.
        {context.managerName
          ? ` Freigaben gehen an ${context.managerName}.`
          : ""}
      </p>
      <nav className="shop__tabs" aria-label="Shop-Bereiche">
        {tabs.map(([key, label, count]) => (
          <button
            aria-current={tab === key ? "page" : undefined}
            className={
              tab === key ? "shop__tab shop__tab--active" : "shop__tab"
            }
            key={key}
            onClick={() => setTab(key)}
            type="button"
          >
            {label}
            {count ? <span className="shop__count">{count}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "catalog" ? (
        <CatalogView
          cart={cart}
          canOrder={context.canOrder}
          canOrderForOthers={context.canFulfill}
          onCartChange={setCart}
          onOrdered={(orderId, forOther) => {
            setCart([]);
            refresh();
            setTab(forOther ? "orders" : "mine");
            setOpenOrderId(orderId);
          }}
          tenantId={tenantId}
        />
      ) : tab === "manage" ? (
        <CatalogManager tenantId={tenantId} />
      ) : (
        <OrderList
          key={`${tab}:${revision}`}
          onOpen={setOpenOrderId}
          scope={
            tab === "mine" ? "mine" : tab === "approvals" ? "approvals" : "all"
          }
          tenantId={tenantId}
        />
      )}

      {openOrderId ? (
        <OrderDialog
          onChanged={refresh}
          onClose={() => setOpenOrderId(null)}
          orderId={openOrderId}
          tenantId={tenantId}
        />
      ) : null}
    </section>
  );
}

/** Beschreibung auf wenige Zeilen gekürzt, bei Bedarf aufklappbar. */
function ShopDescription({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      // Nur im gekürzten Zustand messen; aufgeklappt bleibt der Knopf stehen.
      if (!expanded) setTruncated(node.scrollHeight > node.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <>
      <p
        className={`shop__description${expanded ? "" : " shop__description--clamped"}`}
        ref={ref}
      >
        {text}
      </p>
      {truncated || expanded ? (
        <button
          aria-expanded={expanded}
          className="text-button shop__description-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? "Weniger anzeigen" : "Mehr anzeigen …"}
        </button>
      ) : null}
    </>
  );
}

/** Cover photo with browsing when an article has several photos. */
function ShopImageGallery({ item }: { item: CatalogItem }) {
  const urls =
    item.imageUrls && item.imageUrls.length > 0
      ? item.imageUrls
      : item.imageUrl
        ? [item.imageUrl]
        : [];
  const [index, setIndex] = useState(0);
  const [coverFit, setCoverFit] = useState(false);
  const current = Math.min(index, Math.max(0, urls.length - 1));
  if (urls.length === 0) {
    return (
      <div className="shop__image" aria-hidden="true">
        <PackageCheck size={34} strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <div
      className="shop__image shop__image--gallery"
      style={{ "--shop-image": `url("${urls[current]}")` } as CSSProperties}
    >
      <img
        alt={`${item.name}, Foto ${current + 1}`}
        className={coverFit ? "shop__image-fill" : undefined}
        onLoad={(event) => {
          // Fast quadratische oder 4:3-Fotos füllen das Feld ganz aus (ein
          // kleiner Rand wird beschnitten); breite oder hohe Fotos bleiben
          // vollständig sichtbar, der Rest wird weichgezeichnet gefüllt.
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0) {
            const ratio = naturalWidth / naturalHeight / (4 / 3);
            setCoverFit(ratio >= 0.85 && ratio <= 1.2);
          }
        }}
        src={urls[current]}
      />
      {urls.length > 1 ? (
        <>
          <button
            aria-label="Vorheriges Foto"
            className="shop__gallery-nav shop__gallery-nav--prev"
            onClick={() => setIndex((current - 1 + urls.length) % urls.length)}
            type="button"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            aria-label="Nächstes Foto"
            className="shop__gallery-nav shop__gallery-nav--next"
            onClick={() => setIndex((current + 1) % urls.length)}
            type="button"
          >
            <ChevronRight size={16} />
          </button>
          <div className="shop__gallery-dots">
            {urls.map((url, dotIndex) => (
              <button
                aria-label={`Foto ${dotIndex + 1} anzeigen`}
                aria-pressed={dotIndex === current}
                className={
                  dotIndex === current
                    ? "shop__gallery-dot shop__gallery-dot--active"
                    : "shop__gallery-dot"
                }
                key={url}
                onClick={() => setIndex(dotIndex)}
                type="button"
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CatalogView({
  tenantId,
  cart,
  canOrder,
  canOrderForOthers,
  onCartChange,
  onOrdered,
}: {
  tenantId: string;
  cart: CartLine[];
  canOrder: boolean;
  canOrderForOthers: boolean;
  onCartChange: (cart: CartLine[]) => void;
  onOrdered: (orderId: string, forOther: boolean) => void;
}) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    let active = true;
    shopApi
      .catalog(tenantId)
      .then((next) => active && setItems(next))
      .catch((nextError: Error) => active && setError(nextError.message));
    return () => {
      active = false;
    };
  }, [tenantId]);

  const categories = useMemo(
    () =>
      [...new Set((items ?? []).map((item) => item.category))].sort((a, b) =>
        a.localeCompare(b, "de-CH"),
      ),
    [items],
  );
  const visible = (items ?? []).filter((item) => {
    const needle = query.trim().toLocaleLowerCase("de-CH");
    return (
      (category === "all" || item.category === category) &&
      (!needle ||
        `${item.name} ${item.description ?? ""} ${item.category}`
          .toLocaleLowerCase("de-CH")
          .includes(needle))
    );
  });

  // Gewählte Optionen je Artikel (werden beim Hinzufügen mit eingelegt).
  const [chosenOptions, setChosenOptions] = useState<Record<string, string[]>>(
    {},
  );
  const itemsById = useMemo(
    () => new Map((items ?? []).map((entry) => [entry.id, entry])),
    [items],
  );

  const add = (item: CatalogItem) => {
    const extras = (chosenOptions[item.id] ?? [])
      .map((id) => itemsById.get(id))
      .filter((entry): entry is CatalogItem => Boolean(entry));
    let next = cart;
    for (const entry of [item, ...extras]) {
      const existing = next.find((line) => line.item.id === entry.id);
      next = existing
        ? next.map((line) =>
            line.item.id === entry.id
              ? {
                  ...line,
                  quantity: Math.min(entry.maxQuantity, line.quantity + 1),
                }
              : line,
          )
        : [...next, { item: entry, quantity: 1 }];
    }
    onCartChange(next);
    setChosenOptions((current) => ({ ...current, [item.id]: [] }));
  };

  return (
    <div className="shop__layout">
      <div className="shop__catalog">
        <div className="shop__filters">
          <label className="shop__search">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Artikel suchen"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Artikel suchen, z. B. Ladekabel"
              type="search"
              value={query}
            />
          </label>
          <select
            aria-label="Kategorie"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option value="all">Alle Kategorien</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {items === null ? (
          <p className="empty-state">Katalog wird geladen …</p>
        ) : visible.length === 0 ? (
          <p className="empty-state">
            {items.length === 0
              ? "Im Shop sind noch keine Artikel verfügbar."
              : "Keine Artikel für diese Suche."}
          </p>
        ) : (
          <ul className="shop__grid">
            {visible.map((item) => (
              <li className="shop__card" key={item.id}>
                <ShopImageGallery item={item} />
                <div className="shop__card-body">
                  <p className="shop__category">{item.category}</p>
                  <h2>{item.name}</h2>
                  {item.description ? (
                    <ShopDescription text={item.description} />
                  ) : null}
                  {SPEC_FIELDS.some(({ key }) => item.specifications?.[key]) ? (
                    <details className="shop__specs">
                      <summary>Technische Angaben</summary>
                      <dl>
                        {SPEC_FIELDS.filter(
                          ({ key }) => item.specifications?.[key],
                        ).map(({ key, label }) => (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>{item.specifications?.[key]}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                  <div className="shop__badges">
                    <span
                      className={`shop__stock shop__stock--${item.stockLevel}`}
                    >
                      {STOCK_LABEL[item.stockLevel]}
                      {item.availableQuantity !== null
                        ? ` (${item.availableQuantity})`
                        : ""}
                    </span>
                    {item.kind === "loan" ? (
                      <span className="shop__badge">
                        Ausleihe
                        {item.maxLoanDays
                          ? ` · max. ${item.maxLoanDays} Tage`
                          : ""}
                      </span>
                    ) : null}
                    {item.requiresApproval ? (
                      <span className="shop__badge shop__badge--approval">
                        Mit Freigabe
                      </span>
                    ) : null}
                  </div>
                </div>
                {(item.optionItemIds ?? []).some((id) => itemsById.has(id)) ? (
                  <fieldset className="shop__options">
                    <legend>Dazu bestellen</legend>
                    {(item.optionItemIds ?? []).map((id) => {
                      const option = itemsById.get(id);
                      if (!option) return null;
                      const selected = (chosenOptions[item.id] ?? []).includes(
                        id,
                      );
                      return (
                        <label key={id}>
                          <input
                            checked={selected}
                            disabled={!canOrder}
                            onChange={() =>
                              setChosenOptions((current) => {
                                const list = current[item.id] ?? [];
                                return {
                                  ...current,
                                  [item.id]: selected
                                    ? list.filter((entry) => entry !== id)
                                    : [...list, id],
                                };
                              })
                            }
                            type="checkbox"
                          />
                          <span>
                            {option.name}
                            {option.stockLevel === "out_of_stock" ? (
                              <small> · {STOCK_LABEL.out_of_stock}</small>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={!canOrder}
                  onClick={() => add(item)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                  {item.kind === "loan" ? "Ausleihen" : "In den Warenkorb"}
                  {(chosenOptions[item.id] ?? []).length > 0
                    ? ` (+${(chosenOptions[item.id] ?? []).length})`
                    : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CartPanel
        canOrderForOthers={canOrderForOthers}
        cart={cart}
        onCartChange={onCartChange}
        onOrdered={onOrdered}
        tenantId={tenantId}
      />
    </div>
  );
}

function CartPanel({
  tenantId,
  cart,
  canOrderForOthers,
  onCartChange,
  onOrdered,
}: {
  tenantId: string;
  cart: CartLine[];
  canOrderForOthers: boolean;
  onCartChange: (cart: CartLine[]) => void;
  onOrdered: (orderId: string, forOther: boolean) => void;
}) {
  // Agents can place the order for an employee ("" = for myself).
  const [requesterId, setRequesterId] = useState("");
  const [people, setPeople] = useState<ShopPerson[] | null>(null);
  const forOther = canOrderForOthers && requesterId !== "";
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "desk">(
    "pickup",
  );
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [loanFrom, setLoanFrom] = useState(todayIso());
  const [loanUntil, setLoanUntil] = useState("");
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const hasLoan = cart.some((line) => line.item.kind === "loan");
  const needsApproval = cart.some((line) => line.item.requiresApproval);

  useEffect(() => {
    if (!canOrderForOthers || cart.length === 0 || people !== null) return;
    let active = true;
    shopApi
      .people(tenantId)
      .then((next) => active && setPeople(next))
      .catch(() => active && setPeople([]));
    return () => {
      active = false;
    };
  }, [canOrderForOthers, cart.length, people, tenantId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (cart.length === 0) return;
    setPending(true);
    setError("");
    try {
      const result = await shopApi.submit(tenantId, {
        clientRequestId: requestId,
        ...(forOther ? { requesterId } : {}),
        lines: cart.map((line) => ({
          catalogItemId: line.item.id,
          quantity: line.quantity,
        })),
        deliveryMethod,
        deliveryLocation: deliveryMethod === "desk" ? deliveryLocation : null,
        neededBy: neededBy || null,
        loanFrom: hasLoan ? loanFrom : null,
        loanUntil: hasLoan ? loanUntil : null,
        comment: comment || null,
      });
      setRequestId(newRequestId());
      setComment("");
      setNeededBy("");
      setLoanUntil("");
      setRequesterId("");
      onOrdered(result.orderId, forOther);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Bestellung ist fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <aside className="shop__cart" aria-label="Warenkorb">
      <h2>
        <ShoppingCart aria-hidden="true" size={18} /> Warenkorb
      </h2>
      {cart.length === 0 ? (
        <p className="shop__muted">Noch keine Artikel ausgewählt.</p>
      ) : (
        <form
          className="shop__cart-form"
          onSubmit={(event) => void submit(event)}
        >
          {canOrderForOthers ? (
            <label>
              Bestellen für
              <select
                onChange={(event) => setRequesterId(event.target.value)}
                value={requesterId}
              >
                <option value="">Mich selbst</option>
                {(people ?? []).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.jobTitle
                      ? `${person.name} – ${person.jobTitle}`
                      : person.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <ul className="shop__cart-lines">
            {cart.map((line) => (
              <li key={line.item.id}>
                <span>{line.item.name}</span>
                <div className="shop__qty">
                  <button
                    aria-label={`${line.item.name}: eins weniger`}
                    className="icon-button"
                    onClick={() =>
                      onCartChange(
                        line.quantity <= 1
                          ? cart.filter(
                              (candidate) => candidate.item.id !== line.item.id,
                            )
                          : cart.map((candidate) =>
                              candidate.item.id === line.item.id
                                ? {
                                    ...candidate,
                                    quantity: candidate.quantity - 1,
                                  }
                                : candidate,
                            ),
                      )
                    }
                    type="button"
                  >
                    {line.quantity <= 1 ? (
                      <Trash2 size={15} />
                    ) : (
                      <Minus size={15} />
                    )}
                  </button>
                  <strong>{line.quantity}</strong>
                  <button
                    aria-label={`${line.item.name}: eins mehr`}
                    className="icon-button"
                    disabled={line.quantity >= line.item.maxQuantity}
                    onClick={() =>
                      onCartChange(
                        cart.map((candidate) =>
                          candidate.item.id === line.item.id
                            ? { ...candidate, quantity: candidate.quantity + 1 }
                            : candidate,
                        ),
                      )
                    }
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {hasLoan ? (
            <div className="shop__row">
              <label>
                Ausleihe ab
                <input
                  min={todayIso()}
                  onChange={(event) => setLoanFrom(event.target.value)}
                  required
                  type="date"
                  value={loanFrom}
                />
              </label>
              <label>
                Rückgabe bis
                <input
                  min={loanFrom || todayIso()}
                  onChange={(event) => setLoanUntil(event.target.value)}
                  required
                  type="date"
                  value={loanUntil}
                />
              </label>
            </div>
          ) : null}
          <fieldset className="shop__delivery">
            <legend>Übergabe</legend>
            <label>
              <input
                checked={deliveryMethod === "pickup"}
                name="delivery"
                onChange={() => setDeliveryMethod("pickup")}
                type="radio"
              />
              Abholung beim Support
            </label>
            <label>
              <input
                checked={deliveryMethod === "desk"}
                name="delivery"
                onChange={() => setDeliveryMethod("desk")}
                type="radio"
              />
              {forOther ? "An den Arbeitsplatz" : "An meinen Arbeitsplatz"}
            </label>
          </fieldset>
          {deliveryMethod === "desk" ? (
            <label>
              Arbeitsplatz / Raum
              <input
                maxLength={200}
                onChange={(event) => setDeliveryLocation(event.target.value)}
                placeholder="z. B. Büro 2.14"
                required
                value={deliveryLocation}
              />
            </label>
          ) : null}
          {!hasLoan ? (
            <label>
              Benötigt bis (optional)
              <input
                min={todayIso()}
                onChange={(event) => setNeededBy(event.target.value)}
                type="date"
                value={neededBy}
              />
            </label>
          ) : null}
          <label>
            Bemerkung (optional)
            <textarea
              maxLength={2000}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              value={comment}
            />
          </label>
          {needsApproval ? (
            <p className="shop__hint">
              {forOther
                ? "Mindestens ein Artikel braucht die Freigabe der vorgesetzten Person der bestellenden Person."
                : "Mindestens ein Artikel braucht die Freigabe deiner vorgesetzten Person."}
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" disabled={pending} type="submit">
            {pending
              ? "Wird bestellt …"
              : needsApproval
                ? "Zur Freigabe senden"
                : forOther
                  ? "Für diese Person bestellen"
                  : "Jetzt bestellen"}
          </button>
        </form>
      )}
    </aside>
  );
}

function OrderList({
  tenantId,
  scope,
  onOpen,
}: {
  tenantId: string;
  scope: "mine" | "approvals" | "all";
  onOpen: (orderId: string) => void;
}) {
  const [filter, setFilter] = useState(scope === "all" ? "open" : "");
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setOrders(null);
    shopApi
      .orders(tenantId, scope, filter || undefined)
      .then((next) => active && setOrders(next))
      .catch((nextError: Error) => active && setError(nextError.message));
    return () => {
      active = false;
    };
  }, [filter, scope, tenantId]);

  return (
    <div className="shop__orders">
      {scope !== "approvals" ? (
        <div className="shop__filters">
          <select
            aria-label="Status"
            onChange={(event) => setFilter(event.target.value)}
            value={filter}
          >
            <option value="">Alle</option>
            <option value="open">Offen</option>
            {scope === "all" ? (
              <option value="pending_approval">Wartet auf Freigabe</option>
            ) : null}
            {scope === "all" ? (
              <option value="submitted">Neu eingegangen</option>
            ) : null}
            {scope === "all" ? (
              <option value="ready">Bereit zur Abholung</option>
            ) : null}
            <option value="loaned">Ausgeliehen</option>
            <option value="closed">Abgeschlossen</option>
          </select>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      {orders === null ? (
        <p className="empty-state">Bestellungen werden geladen …</p>
      ) : orders.length === 0 ? (
        <p className="empty-state">
          {scope === "approvals"
            ? "Keine Bestellungen warten auf deine Freigabe."
            : "Keine Bestellungen."}
        </p>
      ) : (
        <ul className="shop__order-list">
          {orders.map((order) => (
            <li key={order.id}>
              <button
                className="shop__order-row"
                onClick={() => onOpen(order.id)}
                type="button"
              >
                <span className="shop__order-number">{order.orderNumber}</span>
                <span className="shop__order-items">{order.itemsLabel}</span>
                {scope !== "mine" ? (
                  <span className="shop__muted">{order.requesterName}</span>
                ) : null}
                <span className="shop__muted">
                  {formatDate(order.createdAt)}
                </span>
                <span
                  className={`shop__status shop__status--${order.overdue ? "overdue" : order.status}`}
                >
                  {order.overdue
                    ? "Überfällig"
                    : ORDER_STATUS_LABEL[order.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderDialog({
  tenantId,
  orderId,
  onClose,
  onChanged,
}: {
  tenantId: string;
  orderId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [choices, setChoices] = useState<
    Record<
      string,
      { locationId?: string | undefined; serialUnitId?: string | undefined }
    >
  >({});

  const load = useCallback(() => {
    shopApi
      .order(tenantId, orderId)
      .then((next) => {
        setOrder(next);
        setError("");
      })
      .catch((nextError: Error) => setError(nextError.message));
  }, [orderId, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (
    action: OrderAction,
    extra: Record<string, unknown> = {},
  ) => {
    if (!order) return;
    let reason: string | null = null;
    if (action === "reject" || action === "reject_approval") {
      reason = window.prompt("Grund für die Ablehnung:");
      if (!reason?.trim()) return;
    }
    if (
      action === "cancel" &&
      !window.confirm("Bestellung wirklich stornieren?")
    )
      return;
    setPending(true);
    setError("");
    try {
      await shopApi.update(tenantId, order.id, action, {
        ...(reason ? { reason } : {}),
        ...extra,
      });
      setNote("");
      load();
      onChanged();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Aktion ist fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const lineChoices = () =>
    (order?.lines ?? []).map((line) => ({
      lineId: line.id,
      locationId: choices[line.id]?.locationId ?? null,
      serialUnitId: choices[line.id]?.serialUnitId ?? null,
    }));

  const status = order?.status;
  const process = order?.permissions.canProcess ?? false;
  const handOutPossible =
    process &&
    (status === "submitted" || status === "in_progress" || status === "ready");

  return (
    <div
      className="contracts__dialog-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        aria-labelledby="shop-order-title"
        aria-modal="true"
        className="contracts__editor-dialog shop__dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="panel-heading">
          <div>
            <p className="eyebrow">Bestellung</p>
            <h2 id="shop-order-title">{order?.orderNumber ?? "…"}</h2>
          </div>
          <button
            aria-label="Schliessen"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {!order ? (
          <p className="empty-state">Wird geladen …</p>
        ) : (
          <>
            <p>
              <span
                className={`shop__status shop__status--${order.overdue ? "overdue" : order.status}`}
              >
                {order.overdue
                  ? "Überfällig"
                  : ORDER_STATUS_LABEL[order.status]}
              </span>
            </p>
            <dl className="shop__facts">
              <div>
                <dt>{order.placedByName ? "Bestellt für" : "Bestellt von"}</dt>
                <dd>{order.requesterName ?? "–"}</dd>
              </div>
              {order.placedByName ? (
                <div>
                  <dt>Erfasst von</dt>
                  <dd>{order.placedByName}</dd>
                </div>
              ) : null}
              <div>
                <dt>Bestellt am</dt>
                <dd>{formatDate(order.createdAt)}</dd>
              </div>
              <div>
                <dt>Übergabe</dt>
                <dd>
                  {order.deliveryMethod === "desk"
                    ? `Arbeitsplatz: ${order.deliveryLocation ?? "–"}`
                    : "Abholung beim Support"}
                </dd>
              </div>
              {order.loanFrom ? (
                <div>
                  <dt>Ausleihe</dt>
                  <dd>
                    {formatDate(order.loanFrom)} – {formatDate(order.loanUntil)}
                  </dd>
                </div>
              ) : null}
              {order.neededBy ? (
                <div>
                  <dt>Benötigt bis</dt>
                  <dd>{formatDate(order.neededBy)}</dd>
                </div>
              ) : null}
              {order.approverName || order.approvedByName ? (
                <div>
                  <dt>Freigabe</dt>
                  <dd>
                    {order.approvedByName
                      ? `Freigegeben von ${order.approvedByName}`
                      : `Bei ${order.approverName}`}
                  </dd>
                </div>
              ) : null}
              {order.decisionReason ? (
                <div>
                  <dt>Begründung</dt>
                  <dd>{order.decisionReason}</dd>
                </div>
              ) : null}
              {order.comment ? (
                <div>
                  <dt>Bemerkung</dt>
                  <dd>{order.comment}</dd>
                </div>
              ) : null}
            </dl>

            <h3>Artikel</h3>
            <ul className="shop__lines">
              {order.lines.map((line) => (
                <li key={line.id}>
                  <div className="shop__line-thumb" aria-hidden="true">
                    {line.imageUrl ? (
                      <img alt="" src={line.imageUrl} />
                    ) : (
                      <PackageCheck size={20} strokeWidth={1.5} />
                    )}
                  </div>
                  <div className="shop__line-body">
                    <strong>
                      {line.quantity}× {line.itemName}
                    </strong>
                    {line.articleNumber || line.supplierUrl ? (
                      <span className="shop__line-internal">
                        {line.articleNumber
                          ? `Art.-Nr. ${line.articleNumber}`
                          : null}
                        {line.articleNumber && line.supplierUrl ? " · " : null}
                        {line.supplierUrl ? (
                          <a
                            href={line.supplierUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                          >
                            Beim Lieferanten ansehen
                          </a>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="shop__muted">
                      {line.kind === "loan" ? " · Ausleihe" : ""}
                      {line.status === "reserved"
                        ? " · reserviert"
                        : line.status === "backorder"
                          ? " · nicht an Lager"
                          : line.status === "issued"
                            ? " · ausgegeben"
                            : line.status === "returned"
                              ? " · zurück"
                              : ""}
                    </span>
                  </div>
                  {handOutPossible && line.stock && line.status !== "issued" ? (
                    <div className="shop__row">
                      <select
                        aria-label={`Lagerort für ${line.itemName}`}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [line.id]: {
                              ...current[line.id],
                              locationId: event.target.value || undefined,
                            },
                          }))
                        }
                        value={
                          choices[line.id]?.locationId ?? line.locationId ?? ""
                        }
                      >
                        <option value="">Lagerort automatisch</option>
                        {line.stock.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name} ({location.available} frei)
                          </option>
                        ))}
                      </select>
                      {line.stock.trackingMode === "serial" ? (
                        <select
                          aria-label={`Seriennummer für ${line.itemName}`}
                          onChange={(event) =>
                            setChoices((current) => ({
                              ...current,
                              [line.id]: {
                                ...current[line.id],
                                serialUnitId: event.target.value || undefined,
                              },
                            }))
                          }
                          value={choices[line.id]?.serialUnitId ?? ""}
                        >
                          <option value="">Seriennummer wählen</option>
                          {line.stock.serialUnits.map((serial) => (
                            <option key={serial.id} value={serial.id}>
                              {serial.serialNumber}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="form-actions shop__actions">
              {order.permissions.canApprove ? (
                <>
                  <button
                    className="primary-button"
                    disabled={pending}
                    onClick={() => void run("approve")}
                    type="button"
                  >
                    Freigeben
                  </button>
                  <button
                    className="danger-button"
                    disabled={pending}
                    onClick={() => void run("reject_approval")}
                    type="button"
                  >
                    Ablehnen
                  </button>
                </>
              ) : null}
              {process && status === "submitted" ? (
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => void run("accept")}
                  type="button"
                >
                  In Bearbeitung nehmen
                </button>
              ) : null}
              {process &&
              order.deliveryMethod === "pickup" &&
              (status === "submitted" || status === "in_progress") ? (
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => void run("ready")}
                  type="button"
                >
                  Bereit zur Abholung
                </button>
              ) : null}
              {handOutPossible ? (
                <button
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void run("issue", { lines: lineChoices() })}
                  type="button"
                >
                  Ausgeben &amp; aus Lager buchen
                </button>
              ) : null}
              {process && status === "loaned" ? (
                <button
                  className="primary-button"
                  disabled={pending}
                  onClick={() => void run("return", { lines: lineChoices() })}
                  type="button"
                >
                  Rückgabe erfassen
                </button>
              ) : null}
              {process &&
              status &&
              ["submitted", "in_progress", "ready"].includes(status) ? (
                <button
                  className="danger-button"
                  disabled={pending}
                  onClick={() => void run("reject")}
                  type="button"
                >
                  Ablehnen
                </button>
              ) : null}
              {order.permissions.canCancel && order.permissions.isRequester ? (
                <button
                  className="secondary-button"
                  disabled={pending}
                  onClick={() => void run("cancel")}
                  type="button"
                >
                  Stornieren
                </button>
              ) : null}
            </div>

            <h3>Verlauf</h3>
            <ol className="shop__timeline">
              {order.events.map((event) => (
                <li key={event.id}>
                  <strong>{EVENT_LABEL[event.type] ?? event.type}</strong>
                  {event.internal ? (
                    <span className="shop__badge">intern</span>
                  ) : null}
                  <span className="shop__muted">
                    {" "}
                    · {event.actorName ?? "System"} ·{" "}
                    {formatDate(event.createdAt)}
                  </span>
                  {event.note ? <p>{event.note}</p> : null}
                </li>
              ))}
            </ol>
            {process || order.permissions.isRequester ? (
              <form
                className="shop__note"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (note.trim())
                    void run("note", {
                      note,
                      internal: process && !order.permissions.isRequester,
                    });
                }}
              >
                <label>
                  {process && !order.permissions.isRequester
                    ? "Interne Notiz"
                    : "Nachricht an den Support"}
                  <textarea
                    maxLength={2000}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    value={note}
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={pending || !note.trim()}
                  type="submit"
                >
                  Hinzufügen
                </button>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

type Draft = {
  id?: string;
  name: string;
  description: string;
  /** Technische Angaben (Schlüssel siehe SPEC_FIELDS). */
  specifications: Record<string, string>;
  category: string;
  categoryId: string;
  /** Name of a category to create on save ("" = none). */
  newCategory: string;
  articleNumber: string;
  supplierUrl: string;
  kind: "order" | "loan";
  requiresApproval: boolean;
  maxQuantity: number;
  maxLoanDays: string;
  inventoryItemId: string;
  /** Artikel, die dazu bestellt werden können (Optionen). */
  optionItemIds: string[];
  active: boolean;
  sortOrder: number;
  /** Saved photos that stay. */
  images: { id: string; url: string }[];
  /** Saved photos to delete on save. */
  removedImageIds: string[];
  /** New photos to upload on save. */
  newFiles: File[];
  /** Inventory photo shown when the article has no own photos. */
  fallbackImageUrl: string | null;
};

const MAX_IMAGES = 5;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const MAX_IMAGE_EDGE = 1600;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    image.src = url;
  });
}

/**
 * Makes any photo the browser can read upload-ready: large or unusual images
 * (e.g. phone photos, HEIC on Safari) are scaled to max. 1600 px and saved
 * as JPEG, so they stay well below the 3 MB limit.
 */
async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && file.type !== "") {
    throw new Error(`«${file.name}» ist kein Foto.`);
  }
  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch {
    throw new Error(
      `«${file.name}» kann nicht gelesen werden. Bitte JPG, PNG oder WebP verwenden.`,
    );
  }
  const scale = Math.min(
    1,
    MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
  );
  if (
    scale === 1 &&
    IMAGE_TYPES.includes(file.type) &&
    file.size <= MAX_IMAGE_BYTES
  ) {
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Das Foto konnte nicht verarbeitet werden.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob || blob.size > MAX_IMAGE_BYTES) {
    throw new Error(`«${file.name}» ist zu gross.`);
  }
  const name = file.name.replace(/\.[^.]+$/, "") || "foto";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(new Error("Das Foto konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  specifications: {},
  category: "",
  categoryId: "",
  newCategory: "",
  articleNumber: "",
  supplierUrl: "",
  kind: "order",
  requiresApproval: false,
  maxQuantity: 2,
  maxLoanDays: "14",
  inventoryItemId: "",
  optionItemIds: [],
  active: true,
  sortOrder: 0,
  images: [],
  removedImageIds: [],
  newFiles: [],
  fallbackImageUrl: null,
};

/** Optionen eines Artikels wählen, mit Suche über alle Artikel. */
function OptionsEditor({
  candidates,
  onChange,
  selected,
}: {
  candidates: CatalogItem[];
  onChange: (ids: string[]) => void;
  selected: string[];
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase("de-CH");
  const visible = needle
    ? candidates.filter((other) =>
        `${other.name} ${other.category} ${other.articleNumber ?? ""}`
          .toLocaleLowerCase("de-CH")
          .includes(needle),
      )
    : candidates;
  return (
    <fieldset className="shop__options-editor">
      <legend>
        Optionen (dazu bestellbar)
        {selected.length > 0 ? ` · ${selected.length} gewählt` : ""}
      </legend>
      <p className="shop__options-hint">
        Diese Artikel werden beim Bestellen dieses Artikels zur Auswahl
        angeboten, z. B. die Ladestation beim Headset. Sie bleiben zusätzlich
        einzeln bestellbar.
      </p>
      {candidates.length === 0 ? (
        <p className="shop__options-hint">
          Es gibt noch keine weiteren Artikel.
        </p>
      ) : (
        <>
          <label className="shop__search">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Artikel für Optionen suchen"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Artikel suchen …"
              type="search"
              value={query}
            />
          </label>
          {visible.length === 0 ? (
            <p className="shop__options-hint">Keine Artikel gefunden.</p>
          ) : (
            <ul>
              {visible.map((other) => {
                const checked = selected.includes(other.id);
                return (
                  <li key={other.id}>
                    <label>
                      <input
                        checked={checked}
                        disabled={!checked && selected.length >= 10}
                        onChange={() =>
                          onChange(
                            checked
                              ? selected.filter((id) => id !== other.id)
                              : [...selected, other.id],
                          )
                        }
                        type="checkbox"
                      />
                      {other.name}
                      {!other.active ? " (ausgeblendet)" : ""}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}

function CatalogManager({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [categoryDraft, setCategoryDraft] = useState<{
    id?: string;
    name: string;
  } | null>(null);

  const load = useCallback(() => {
    shopApi
      .catalog(tenantId, true)
      .then(setItems)
      .catch((nextError: Error) => setError(nextError.message));
    shopApi
      .categories(tenantId)
      .then(setCategories)
      .catch(() => setCategories([]));
  }, [tenantId]);

  const saveCategoryDraft = async () => {
    if (!categoryDraft) return;
    setError("");
    try {
      await shopApi.saveCategory(tenantId, {
        ...(categoryDraft.id ? { id: categoryDraft.id } : {}),
        name: categoryDraft.name.trim(),
      });
      setCategoryDraft(null);
      setNotice("Kategorie gespeichert.");
      load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Kategorie konnte nicht gespeichert werden.",
      );
    }
  };

  const removeCategory = async (category: ShopCategory) => {
    if (!window.confirm(`Kategorie «${category.name}» löschen?`)) return;
    setError("");
    try {
      await shopApi.deleteCategory(tenantId, category.id);
      setNotice("Kategorie gelöscht.");
      load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Die Kategorie konnte nicht gelöscht werden.",
      );
    }
  };

  useEffect(() => {
    load();
    shopApi
      .inventoryItems(tenantId)
      .then(setInventory)
      .catch(() => setInventory([]));
  }, [load, tenantId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    setPending(true);
    setError("");
    try {
      let categoryId = draft.categoryId;
      if (draft.newCategory.trim()) {
        const created = await shopApi.saveCategory(tenantId, {
          name: draft.newCategory.trim(),
        });
        categoryId = created.id;
      }
      const saved = await shopApi.saveItem(tenantId, {
        id: draft.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        specifications: Object.fromEntries(
          SPEC_FIELDS.flatMap(({ key }) => {
            const value = (draft.specifications[key] ?? "").trim();
            return value ? [[key, value]] : [];
          }),
        ),
        ...(categoryId && categoryId !== "__new__"
          ? { categoryId }
          : { category: "Allgemein" }),
        articleNumber: draft.articleNumber.trim() || null,
        supplierUrl: draft.supplierUrl.trim() || null,
        kind: draft.kind,
        requiresApproval: draft.requiresApproval,
        maxQuantity: draft.maxQuantity,
        maxLoanDays:
          draft.kind === "loan" && draft.maxLoanDays
            ? Number(draft.maxLoanDays)
            : null,
        inventoryItemId: draft.inventoryItemId || null,
        optionItemIds: draft.optionItemIds,
        active: draft.active,
        sortOrder: draft.sortOrder,
      });
      for (const imageId of draft.removedImageIds) {
        await shopApi.removeImage(tenantId, saved.id, imageId);
      }
      for (const file of draft.newFiles) {
        await shopApi.addImage(tenantId, saved.id, {
          data: await fileToBase64(file),
          contentType: file.type,
        });
      }
      setNotice(
        draft.id ? "Artikel gespeichert." : "Artikel ist jetzt im Shop.",
      );
      setDraft(null);
      load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Speichern fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  };

  const newFiles = draft?.newFiles;
  const newFilePreviews = useMemo(
    () => (newFiles ?? []).map((file) => URL.createObjectURL(file)),
    [newFiles],
  );
  useEffect(
    () => () => {
      for (const url of newFilePreviews) URL.revokeObjectURL(url);
    },
    [newFilePreviews],
  );
  const imageCount = draft ? draft.images.length + draft.newFiles.length : 0;

  const [photoError, setPhotoError] = useState("");
  const [preparingPhotos, setPreparingPhotos] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!draft || files.length === 0) return;
    const free = MAX_IMAGES - imageCount;
    if (free <= 0) {
      setPhotoError(`Pro Artikel sind höchstens ${MAX_IMAGES} Fotos möglich.`);
      return;
    }
    setPhotoError("");
    setPreparingPhotos(true);
    const prepared: File[] = [];
    const problems: string[] = [];
    for (const file of files.slice(0, free)) {
      try {
        prepared.push(await prepareImage(file));
      } catch (nextError) {
        problems.push(
          nextError instanceof Error
            ? nextError.message
            : "Ein Foto konnte nicht verarbeitet werden.",
        );
      }
    }
    if (files.length > free) {
      problems.push(
        `Pro Artikel sind höchstens ${MAX_IMAGES} Fotos möglich – ${files.length - free} wurden nicht übernommen.`,
      );
    }
    setPhotoError(problems.join(" "));
    setPreparingPhotos(false);
    setDraft((current) =>
      current
        ? {
            ...current,
            newFiles: [...current.newFiles, ...prepared].slice(
              0,
              MAX_IMAGES - current.images.length,
            ),
          }
        : current,
    );
  };

  const fromInventory =
    (option: InventoryOption | undefined) =>
    (current: Draft | null): Draft | null =>
      !current
        ? current
        : option
          ? {
              ...current,
              inventoryItemId: option.id,
              name: current.name || option.name,
              kind:
                option.trackingMode === "serial" && !current.id
                  ? "loan"
                  : current.kind,
            }
          : { ...current, inventoryItemId: "" };

  return (
    <div className="shop__manage">
      <div className="contracts__actions">
        <button
          className="primary-button"
          onClick={() => {
            setPhotoError("");
            setError("");
            setDraft({ ...EMPTY_DRAFT });
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Artikel hinzufügen
        </button>
        <button
          className="secondary-button"
          onClick={() => setCategoryDraft({ name: "" })}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Kategorie hinzufügen
        </button>
      </div>
      <section className="shop__categories" aria-label="Kategorien">
        <h3>Kategorien</h3>
        {categoryDraft ? (
          <form
            className="shop__category-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveCategoryDraft();
            }}
          >
            <input
              aria-label="Name der Kategorie"
              autoFocus
              maxLength={80}
              minLength={2}
              onChange={(event) =>
                setCategoryDraft({ ...categoryDraft, name: event.target.value })
              }
              placeholder="Name der Kategorie"
              required
              value={categoryDraft.name}
            />
            <button className="primary-button" type="submit">
              Speichern
            </button>
            <button
              className="secondary-button"
              onClick={() => setCategoryDraft(null)}
              type="button"
            >
              Abbrechen
            </button>
          </form>
        ) : null}
        {categories.length === 0 ? (
          <p className="shop__muted">Noch keine Kategorien.</p>
        ) : (
          <ul className="shop__category-list">
            {categories.map((category) => (
              <li key={category.id}>
                <span>{category.name}</span>
                <span className="shop__muted">
                  {category.itemCount === 1
                    ? "1 Artikel"
                    : `${category.itemCount} Artikel`}
                </span>
                <button
                  aria-label={`Kategorie ${category.name} umbenennen`}
                  className="icon-button"
                  onClick={() =>
                    setCategoryDraft({ id: category.id, name: category.name })
                  }
                  type="button"
                >
                  <Pencil size={15} />
                </button>
                <button
                  aria-label={`Kategorie ${category.name} löschen`}
                  className="icon-button"
                  disabled={category.itemCount > 0}
                  onClick={() => void removeCategory(category)}
                  title={
                    category.itemCount > 0
                      ? "Nur leere Kategorien können gelöscht werden."
                      : undefined
                  }
                  type="button"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {notice ? (
        <p className="form-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {items === null ? (
        <p className="empty-state">Artikel werden geladen …</p>
      ) : items.length === 0 ? (
        <p className="empty-state">
          Noch keine Artikel. Füge Artikel aus dem Lager oder freie Artikel
          hinzu.
        </p>
      ) : (
        <ul className="shop__order-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                aria-label={`${item.name} bearbeiten`}
                className="shop__order-row shop__order-row--article"
                onClick={() => {
                  setPhotoError("");
                  setError("");
                  setDraft({
                    id: item.id,
                    name: item.name,
                    description: item.description ?? "",
                    specifications: { ...(item.specifications ?? {}) },
                    category: item.category,
                    categoryId: item.categoryId ?? "",
                    newCategory: "",
                    articleNumber: item.articleNumber ?? "",
                    supplierUrl: item.supplierUrl ?? "",
                    kind: item.kind,
                    requiresApproval: item.requiresApproval,
                    maxQuantity: item.maxQuantity,
                    maxLoanDays: item.maxLoanDays
                      ? String(item.maxLoanDays)
                      : "",
                    inventoryItemId: item.inventoryItemId ?? "",
                    optionItemIds: item.optionItemIds ?? [],
                    active: item.active,
                    sortOrder: item.sortOrder,
                    images: item.images ?? [],
                    removedImageIds: [],
                    newFiles: [],
                    fallbackImageUrl:
                      (item.images ?? []).length === 0 ? item.imageUrl : null,
                  });
                }}
                type="button"
              >
                <span className="shop__order-number">{item.name}</span>
                <span className="shop__muted">{item.category}</span>
                <span className="shop__muted">
                  {item.kind === "loan" ? "Ausleihe" : "Bestellung"}
                  {item.requiresApproval ? " · mit Freigabe" : ""}
                  {item.inventoryItemId
                    ? ` · Lager: ${item.availableQuantity ?? 0} frei`
                    : " · ohne Lager"}
                </span>
                <span
                  className={`shop__status shop__status--${item.active ? "issued" : "cancelled"}`}
                >
                  {item.active ? "Im Shop" : "Ausgeblendet"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div
          className="contracts__dialog-backdrop"
          role="presentation"
          onClick={() => setDraft(null)}
        >
          <form
            aria-labelledby="shop-item-title"
            aria-modal="true"
            className="contracts__editor-dialog shop__dialog"
            onClick={(event) => event.stopPropagation()}
            // A photo dropped next to the drop zone must not open in the tab.
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => event.preventDefault()}
            onSubmit={(event) => void save(event)}
            role="dialog"
          >
            <header className="panel-heading">
              <div>
                <p className="eyebrow">Shop</p>
                <h2 id="shop-item-title">
                  {draft.id ? "Artikel bearbeiten" : "Artikel hinzufügen"}
                </h2>
              </div>
              <button
                aria-label="Schliessen"
                className="icon-button"
                onClick={() => setDraft(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <label>
              Lagerartikel (optional)
              <select
                onChange={(event) =>
                  setDraft(
                    fromInventory(
                      inventory.find(
                        (option) => option.id === event.target.value,
                      ),
                    ),
                  )
                }
                value={draft.inventoryItemId}
              >
                <option value="">Kein Lagerartikel – wird beschafft</option>
                {inventory.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} ({option.articleNumber})
                    {option.trackingMode === "serial" ? " · Seriennummern" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="shop__image-field">
              <span className="shop__image-label">
                Fotos ({imageCount}/{MAX_IMAGES})
              </span>
              {imageCount < MAX_IMAGES ? (
                <label
                  className={`shop__dropzone${dragActive ? " shop__dropzone--active" : ""}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(
                        event.relatedTarget as Node | null,
                      )
                    ) {
                      setDragActive(false);
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    void addFiles(Array.from(event.dataTransfer.files));
                  }}
                >
                  <ImagePlus aria-hidden="true" size={26} />
                  <strong>
                    {preparingPhotos
                      ? "Fotos werden vorbereitet …"
                      : "Fotos hierher ziehen"}
                  </strong>
                  <span>
                    oder <u>vom Computer auswählen</u>
                  </span>
                  <input
                    accept="image/*"
                    disabled={preparingPhotos}
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void addFiles(files);
                    }}
                    type="file"
                  />
                </label>
              ) : null}
              {photoError ? (
                <p className="form-error" role="alert">
                  {photoError}
                </p>
              ) : null}
              {imageCount > 0 ? (
                <div className="shop__image-gallery">
                  {draft.images.map((image, index) => (
                    <div className="shop__image-thumb" key={image.id}>
                      <img alt={`Foto ${index + 1}`} src={image.url} />
                      {index === 0 ? (
                        <span className="shop__image-cover">Titelbild</span>
                      ) : null}
                      <button
                        aria-label={`Foto ${index + 1} entfernen`}
                        className="shop__image-remove"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            images: draft.images.filter(
                              (candidate) => candidate.id !== image.id,
                            ),
                            removedImageIds: [
                              ...draft.removedImageIds,
                              image.id,
                            ],
                          })
                        }
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {draft.newFiles.map((file, index) => (
                    <div
                      className="shop__image-thumb shop__image-thumb--new"
                      key={`${file.name}-${index}`}
                    >
                      <img
                        alt={`Neues Foto ${index + 1}`}
                        src={newFilePreviews[index]}
                      />
                      {draft.images.length === 0 && index === 0 ? (
                        <span className="shop__image-cover">Titelbild</span>
                      ) : null}
                      <button
                        aria-label={`Neues Foto ${index + 1} entfernen`}
                        className="shop__image-remove"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            newFiles: draft.newFiles.filter(
                              (_, fileIndex) => fileIndex !== index,
                            ),
                          })
                        }
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <span className="shop__muted">
                Bis zu {MAX_IMAGES} Fotos. Grosse Fotos werden automatisch
                verkleinert. Das erste Foto ist das Titelbild; neue Fotos werden
                beim Speichern hochgeladen.
                {imageCount === 0 && draft.fallbackImageUrl
                  ? " Ohne eigene Fotos wird das Bild des Lagerartikels gezeigt."
                  : ""}
              </span>
            </div>
            <label>
              Name im Shop
              <input
                maxLength={160}
                minLength={2}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                required
                value={draft.name}
              />
            </label>
            <OptionsEditor
              candidates={(items ?? []).filter(
                (other) => other.id !== draft.id,
              )}
              onChange={(optionItemIds) =>
                setDraft({ ...draft, optionItemIds })
              }
              selected={draft.optionItemIds}
            />
            <div className="shop__row">
              <label>
                Kategorie
                <select
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft(
                      value === "__new__"
                        ? { ...draft, categoryId: "__new__", newCategory: "" }
                        : { ...draft, categoryId: value, newCategory: "" },
                    );
                  }}
                  required
                  value={draft.categoryId}
                >
                  <option disabled value="">
                    Kategorie wählen …
                  </option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                  <option value="__new__">+ Neue Kategorie …</option>
                </select>
              </label>
              {draft.categoryId === "__new__" ? (
                <label>
                  Name der neuen Kategorie
                  <input
                    autoFocus
                    maxLength={80}
                    minLength={2}
                    onChange={(event) =>
                      setDraft({ ...draft, newCategory: event.target.value })
                    }
                    placeholder="z. B. Kabel & Adapter"
                    required
                    value={draft.newCategory}
                  />
                </label>
              ) : null}
            </div>
            <div className="shop__row">
              <label>
                Artikelnummer (intern)
                <input
                  maxLength={80}
                  onChange={(event) =>
                    setDraft({ ...draft, articleNumber: event.target.value })
                  }
                  placeholder="z. B. LOG-MX-VERT"
                  value={draft.articleNumber}
                />
              </label>
              <label>
                Link zum Lieferanten (intern)
                <input
                  maxLength={1000}
                  onChange={(event) =>
                    setDraft({ ...draft, supplierUrl: event.target.value })
                  }
                  placeholder="https://…"
                  type="url"
                  value={draft.supplierUrl}
                />
              </label>
            </div>
            <p className="shop__muted shop__internal-hint">
              Artikelnummer und Lieferanten-Link sehen nur Agenten – im Shop und
              in Bestellungen von Mitarbeitenden werden sie nicht angezeigt.
            </p>
            <label>
              Beschreibung
              <textarea
                maxLength={2000}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                rows={3}
                value={draft.description}
              />
            </label>
            <fieldset className="shop__options-editor shop__specs-editor">
              <legend>Technische Angaben (optional)</legend>
              <p className="shop__options-hint">
                Erscheinen im Shop unter «Technische Angaben». Eine Zeile pro
                Punkt ist am übersichtlichsten.
              </p>
              {SPEC_FIELDS.map(({ key, label }) => (
                <label key={key}>
                  {label}
                  <textarea
                    maxLength={2000}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        specifications: {
                          ...draft.specifications,
                          [key]: event.target.value,
                        },
                      })
                    }
                    rows={2}
                    value={draft.specifications[key] ?? ""}
                  />
                </label>
              ))}
            </fieldset>
            <div className="shop__row">
              <label>
                Art
                <select
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as Draft["kind"],
                    })
                  }
                  value={draft.kind}
                >
                  <option value="order">
                    Bestellen (bleibt bei der Person)
                  </option>
                  <option value="loan">Ausleihen (mit Rückgabe)</option>
                </select>
              </label>
              <label>
                Höchstmenge pro Bestellung
                <input
                  max={100}
                  min={1}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      maxQuantity: Number(event.target.value) || 1,
                    })
                  }
                  type="number"
                  value={draft.maxQuantity}
                />
              </label>
              {draft.kind === "loan" ? (
                <label>
                  Max. Ausleihdauer (Tage)
                  <input
                    max={365}
                    min={1}
                    onChange={(event) =>
                      setDraft({ ...draft, maxLoanDays: event.target.value })
                    }
                    type="number"
                    value={draft.maxLoanDays}
                  />
                </label>
              ) : null}
            </div>
            <label className="shop__check">
              <input
                checked={draft.requiresApproval}
                onChange={(event) =>
                  setDraft({ ...draft, requiresApproval: event.target.checked })
                }
                type="checkbox"
              />
              Braucht die Freigabe der vorgesetzten Person
            </label>
            <label className="shop__check">
              <input
                checked={draft.active}
                onChange={(event) =>
                  setDraft({ ...draft, active: event.target.checked })
                }
                type="checkbox"
              />
              Im Shop sichtbar
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <button
                className="secondary-button"
                onClick={() => setDraft(null)}
                type="button"
              >
                Abbrechen
              </button>
              <button
                className="primary-button"
                disabled={pending || preparingPhotos}
                type="submit"
              >
                {pending ? "Speichert …" : "Speichern"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
