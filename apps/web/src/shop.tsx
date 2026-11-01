import {
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
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  EVENT_LABEL,
  ORDER_STATUS_LABEL,
  STOCK_LABEL,
  formatDate,
  newRequestId,
  shopApi,
  type CatalogItem,
  type InventoryOption,
  type OrderAction,
  type OrderDetail,
  type OrderSummary,
  type ShopContext,
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
    <section className="shop" aria-labelledby="shop-heading">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Selbstbedienung</p>
          <h1 id="shop-heading">Shop</h1>
          <p>
            Zubehör bestellen oder Geräte ausleihen. Der Support stellt die
            Bestellung bereit und bucht sie aus dem Lager.
            {context.managerName
              ? ` Freigaben gehen an ${context.managerName}.`
              : ""}
          </p>
        </div>
      </header>
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

  const add = (item: CatalogItem) => {
    const existing = cart.find((line) => line.item.id === item.id);
    if (existing) {
      onCartChange(
        cart.map((line) =>
          line.item.id === item.id
            ? {
                ...line,
                quantity: Math.min(item.maxQuantity, line.quantity + 1),
              }
            : line,
        ),
      );
    } else {
      onCartChange([...cart, { item, quantity: 1 }]);
    }
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
                <div className="shop__image" aria-hidden="true">
                  {item.imageUrl ? (
                    <img alt="" src={item.imageUrl} />
                  ) : (
                    <PackageCheck size={34} strokeWidth={1.5} />
                  )}
                </div>
                <div className="shop__card-body">
                  <p className="shop__category">{item.category}</p>
                  <h2>{item.name}</h2>
                  {item.description ? (
                    <p className="shop__description">{item.description}</p>
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
                <button
                  className="secondary-button"
                  disabled={!canOrder}
                  onClick={() => add(item)}
                  type="button"
                >
                  <Plus aria-hidden="true" size={16} />
                  {item.kind === "loan" ? "Ausleihen" : "In den Warenkorb"}
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
                  <div>
                    <strong>
                      {line.quantity}× {line.itemName}
                    </strong>
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
  category: string;
  kind: "order" | "loan";
  requiresApproval: boolean;
  maxQuantity: number;
  maxLoanDays: string;
  inventoryItemId: string;
  active: boolean;
  sortOrder: number;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  category: "Zubehör",
  kind: "order",
  requiresApproval: false,
  maxQuantity: 2,
  maxLoanDays: "14",
  inventoryItemId: "",
  active: true,
  sortOrder: 0,
};

function CatalogManager({ tenantId }: { tenantId: string }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [inventory, setInventory] = useState<InventoryOption[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(() => {
    shopApi
      .catalog(tenantId, true)
      .then(setItems)
      .catch((nextError: Error) => setError(nextError.message));
  }, [tenantId]);

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
      await shopApi.saveItem(tenantId, {
        id: draft.id,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        category: draft.category.trim() || "Allgemein",
        kind: draft.kind,
        requiresApproval: draft.requiresApproval,
        maxQuantity: draft.maxQuantity,
        maxLoanDays:
          draft.kind === "loan" && draft.maxLoanDays
            ? Number(draft.maxLoanDays)
            : null,
        inventoryItemId: draft.inventoryItemId || null,
        active: draft.active,
        sortOrder: draft.sortOrder,
      });
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
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          type="button"
        >
          <Plus aria-hidden="true" size={16} /> Artikel hinzufügen
        </button>
      </div>
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
              <div className="shop__order-row">
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
                <button
                  aria-label={`${item.name} bearbeiten`}
                  className="icon-button"
                  onClick={() =>
                    setDraft({
                      id: item.id,
                      name: item.name,
                      description: item.description ?? "",
                      category: item.category,
                      kind: item.kind,
                      requiresApproval: item.requiresApproval,
                      maxQuantity: item.maxQuantity,
                      maxLoanDays: item.maxLoanDays
                        ? String(item.maxLoanDays)
                        : "",
                      inventoryItemId: item.inventoryItemId ?? "",
                      active: item.active,
                      sortOrder: item.sortOrder,
                    })
                  }
                  type="button"
                >
                  <Pencil size={16} />
                </button>
              </div>
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
            <label>
              Kategorie
              <input
                maxLength={80}
                onChange={(event) =>
                  setDraft({ ...draft, category: event.target.value })
                }
                placeholder="z. B. Kabel & Adapter"
                value={draft.category}
              />
            </label>
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
                disabled={pending}
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
