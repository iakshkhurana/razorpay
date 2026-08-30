import { describe, expect, it } from "vitest";
import { LedgerVerdictSchema, OrderStatusSchema, type OrderStatus } from "../schemas";
import {
  InvalidTransitionError,
  ORDER_EVENTS,
  ORDER_STATUSES,
  OrderEventSchema,
  STAMP_FOR_STATUS,
  TRANSITIONS,
  canTransition,
  describeStatus,
  isTerminal,
  nextEvents,
  transition,
  type OrderEvent,
  type OrderTransition,
} from "./stateMachine";

const ALL_STATUSES = OrderStatusSchema.options;

function walk(start: OrderStatus, events: OrderEvent[]): OrderStatus[] {
  const path: OrderStatus[] = [start];
  let current = start;
  for (const e of events) {
    current = transition(current, e);
    path.push(current);
  }
  return path;
}

function reachableFrom(start: OrderStatus): Set<OrderStatus> {
  const seen = new Set<OrderStatus>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const s = queue.shift() as OrderStatus;
    for (const e of nextEvents(s)) {
      const to = transition(s, e);
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return seen;
}

describe("transition table", () => {
  it("has exactly the eight rows the spec lists", () => {
    expect(TRANSITIONS).toEqual([
      { from: "DRAFT", event: "PAYMENT_LINK_CREATED", to: "AWAITING_PAYMENT" },
      { from: "DRAFT", event: "GATE", to: "PENDING_APPROVAL" },
      { from: "AWAITING_PAYMENT", event: "PAYMENT_CAPTURED", to: "PAID" },
      { from: "AWAITING_PAYMENT", event: "PAYMENT_FAILED", to: "FAILED" },
      { from: "FAILED", event: "HOLD", to: "HELD" },
      { from: "HELD", event: "FALLBACK_LINK_ISSUED", to: "AWAITING_PAYMENT" },
      { from: "PENDING_APPROVAL", event: "OWNER_APPROVED", to: "AWAITING_PAYMENT" },
      { from: "PENDING_APPROVAL", event: "OWNER_REJECTED", to: "REJECTED" },
    ]);
  });

  it.each(TRANSITIONS.map((t) => [t.from, t.event, t.to] as const))(
    "%s + %s → %s",
    (from, event, to) => {
      expect(transition(from, event)).toBe(to);
      expect(canTransition(from, event)).toBe(true);
    },
  );

  it("never pairs the same (from, event) twice", () => {
    const keys = TRANSITIONS.map((t) => `${t.from}:${t.event}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("only uses statuses and events that exist", () => {
    for (const t of TRANSITIONS) {
      expect(ALL_STATUSES).toContain(t.from);
      expect(ALL_STATUSES).toContain(t.to);
      expect(ORDER_EVENTS).toContain(t.event);
    }
    expect(ORDER_STATUSES).toEqual(ALL_STATUSES);
  });

  it("reaches every status from DRAFT", () => {
    expect([...reachableFrom("DRAFT")].sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("lets money move only through a captured payment on a live link", () => {
    const intoPaid = TRANSITIONS.filter((t) => t.to === "PAID");
    expect(intoPaid).toEqual([{ from: "AWAITING_PAYMENT", event: "PAYMENT_CAPTURED", to: "PAID" }]);
    expect(transition("PENDING_APPROVAL", "OWNER_APPROVED")).not.toBe("PAID");
    expect(canTransition("HELD", "PAYMENT_CAPTURED")).toBe(false);
  });

  it("rejects an order only by the owner's explicit decision", () => {
    const intoRejected = TRANSITIONS.filter((t) => t.to === "REJECTED");
    expect(intoRejected).toEqual([{ from: "PENDING_APPROVAL", event: "OWNER_REJECTED", to: "REJECTED" }]);
  });

  it("cannot be rewired at runtime", () => {
    const rows = TRANSITIONS as OrderTransition[];
    expect(() => rows.push({ from: "HELD", event: "PAYMENT_CAPTURED", to: "PAID" })).toThrow(TypeError);
    expect(() => {
      (rows[2] as { to: OrderStatus }).to = "REJECTED";
    }).toThrow(TypeError);
    expect(() => {
      (STAMP_FOR_STATUS as Record<OrderStatus, string>).REJECTED = "PAID";
    }).toThrow(TypeError);
    expect(transition("AWAITING_PAYMENT", "PAYMENT_CAPTURED")).toBe("PAID");
    expect(canTransition("HELD", "PAYMENT_CAPTURED")).toBe(false);
  });

  it("nextEvents hands back a fresh array each call", () => {
    const first = nextEvents("DRAFT");
    first.push("PAYMENT_CAPTURED");
    expect(nextEvents("DRAFT")).toEqual(["PAYMENT_LINK_CREATED", "GATE"]);
  });
});

describe("OrderEventSchema", () => {
  it("accepts every declared event", () => {
    for (const e of ORDER_EVENTS) expect(OrderEventSchema.parse(e)).toBe(e);
  });

  it.each(["PAID", "payment_captured", "", "REFUND", 42, null])("rejects %j", (bad) => {
    expect(OrderEventSchema.safeParse(bad).success).toBe(false);
  });
});

describe("paths", () => {
  it("happy path: DRAFT → AWAITING_PAYMENT → PAID", () => {
    expect(walk("DRAFT", ["PAYMENT_LINK_CREATED", "PAYMENT_CAPTURED"])).toEqual([
      "DRAFT",
      "AWAITING_PAYMENT",
      "PAID",
    ]);
  });

  it("failure path: AWAITING_PAYMENT → FAILED → HELD → AWAITING_PAYMENT → PAID", () => {
    expect(walk("AWAITING_PAYMENT", ["PAYMENT_FAILED", "HOLD", "FALLBACK_LINK_ISSUED", "PAYMENT_CAPTURED"])).toEqual([
      "AWAITING_PAYMENT",
      "FAILED",
      "HELD",
      "AWAITING_PAYMENT",
      "PAID",
    ]);
  });

  it("a fallback link can fail again and be held again", () => {
    const end = walk("HELD", ["FALLBACK_LINK_ISSUED", "PAYMENT_FAILED", "HOLD"]).at(-1);
    expect(end).toBe("HELD");
  });

  it("gate path, approved: DRAFT → PENDING_APPROVAL → AWAITING_PAYMENT → PAID", () => {
    expect(walk("DRAFT", ["GATE", "OWNER_APPROVED", "PAYMENT_CAPTURED"])).toEqual([
      "DRAFT",
      "PENDING_APPROVAL",
      "AWAITING_PAYMENT",
      "PAID",
    ]);
  });

  it("gate path, rejected: DRAFT → PENDING_APPROVAL → REJECTED", () => {
    expect(walk("DRAFT", ["GATE", "OWNER_REJECTED"])).toEqual(["DRAFT", "PENDING_APPROVAL", "REJECTED"]);
  });

  it("a gated order that failed at the bank is not re-gated on retry", () => {
    expect(walk("PENDING_APPROVAL", ["OWNER_APPROVED", "PAYMENT_FAILED", "HOLD", "FALLBACK_LINK_ISSUED"])).toEqual([
      "PENDING_APPROVAL",
      "AWAITING_PAYMENT",
      "FAILED",
      "HELD",
      "AWAITING_PAYMENT",
    ]);
  });
});

describe("terminal statuses", () => {
  it("PAID and REJECTED are terminal; nothing else is", () => {
    const terminal = ALL_STATUSES.filter(isTerminal);
    expect(terminal.sort()).toEqual(["PAID", "REJECTED"]);
  });

  it("terminal statuses accept no events", () => {
    for (const s of ALL_STATUSES.filter(isTerminal)) {
      expect(nextEvents(s)).toEqual([]);
      for (const e of ORDER_EVENTS) expect(canTransition(s, e)).toBe(false);
    }
  });

  it("every non-terminal status has at least one exit", () => {
    for (const s of ALL_STATUSES.filter((x) => !isTerminal(x))) {
      expect(nextEvents(s).length).toBeGreaterThan(0);
    }
  });

  it("duplicate webhooks on a settled order are detectable without throwing", () => {
    expect(canTransition("PAID", "PAYMENT_CAPTURED")).toBe(false);
    expect(canTransition("PAID", "PAYMENT_FAILED")).toBe(false);
    expect(canTransition("FAILED", "PAYMENT_FAILED")).toBe(false);
    expect(canTransition("HELD", "PAYMENT_FAILED")).toBe(false);
  });
});

describe("invalid transitions", () => {
  it.each<[OrderStatus, OrderEvent]>([
    ["PAID", "PAYMENT_FAILED"],
    ["PAID", "PAYMENT_CAPTURED"],
    ["DRAFT", "PAYMENT_CAPTURED"],
    ["DRAFT", "OWNER_APPROVED"],
    ["HELD", "PAYMENT_CAPTURED"],
    ["REJECTED", "OWNER_APPROVED"],
    ["AWAITING_PAYMENT", "GATE"],
    ["AWAITING_PAYMENT", "OWNER_APPROVED"],
    ["FAILED", "FALLBACK_LINK_ISSUED"],
    ["FAILED", "PAYMENT_CAPTURED"],
  ])("%s + %s throws InvalidTransitionError with from/event set", (from, event) => {
    expect(() => transition(from, event)).toThrow(InvalidTransitionError);
    try {
      transition(from, event);
    } catch (err) {
      const e = err as InvalidTransitionError;
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe("InvalidTransitionError");
      expect(e.from).toBe(from);
      expect(e.event).toBe(event);
      expect(e.message).toContain(from);
      expect(e.message).toContain(event);
    }
  });

  it("the message names the events a non-terminal status accepts", () => {
    const err = new InvalidTransitionError("HELD", "PAYMENT_CAPTURED");
    expect(err.message).toContain("FALLBACK_LINK_ISSUED");
    expect(err.message).not.toMatch(/final/i);
  });

  it("the message says a terminal order is final", () => {
    const err = new InvalidTransitionError("PAID", "PAYMENT_FAILED");
    expect(err.message).toMatch(/final/i);
  });

  it("a status the database no longer recognises is reported as unknown, not final", () => {
    const stale = "CANCELLED" as OrderStatus;
    expect(canTransition(stale, "PAYMENT_CAPTURED")).toBe(false);
    expect(isTerminal(stale)).toBe(false);
    expect(nextEvents(stale)).toEqual([]);
    expect(() => transition(stale, "PAYMENT_CAPTURED")).toThrow(InvalidTransitionError);
    const err = new InvalidTransitionError(stale, "PAYMENT_CAPTURED");
    expect(err.message).toMatch(/not a known order status/);
    expect(err.message).not.toMatch(/final/i);
  });
});

describe("canTransition and nextEvents mirror transition", () => {
  it("agrees with transition on every (status, event) pair", () => {
    for (const s of ALL_STATUSES) {
      for (const e of ORDER_EVENTS) {
        let ok = true;
        try {
          transition(s, e);
        } catch {
          ok = false;
        }
        expect(canTransition(s, e)).toBe(ok);
        expect(nextEvents(s).includes(e)).toBe(ok);
      }
    }
  });

  it("nextEvents lists exactly the table's events for each status, in table order", () => {
    expect(nextEvents("DRAFT")).toEqual(["PAYMENT_LINK_CREATED", "GATE"]);
    expect(nextEvents("AWAITING_PAYMENT")).toEqual(["PAYMENT_CAPTURED", "PAYMENT_FAILED"]);
    expect(nextEvents("FAILED")).toEqual(["HOLD"]);
    expect(nextEvents("HELD")).toEqual(["FALLBACK_LINK_ISSUED"]);
    expect(nextEvents("PENDING_APPROVAL")).toEqual(["OWNER_APPROVED", "OWNER_REJECTED"]);
  });
});

describe("merchant-facing copy", () => {
  it("describeStatus returns a non-empty, distinct line for every status", () => {
    const lines = ALL_STATUSES.map(describeStatus);
    for (const line of lines) {
      expect(typeof line).toBe("string");
      expect(line.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(lines).size).toBe(ALL_STATUSES.length);
  });

  it("HELD tells the merchant the bank failed and a backup link is ready", () => {
    expect(describeStatus("HELD")).toBe("Payment failed at the bank. A backup payment link is ready.");
  });

  it("FAILED says what happened and what happens next", () => {
    expect(describeStatus("FAILED")).toMatch(/failed at the bank/);
    expect(describeStatus("FAILED")).toMatch(/backup link/);
  });

  it("an unrecognised status still yields a sentence rather than undefined", () => {
    const line = describeStatus("CANCELLED" as OrderStatus);
    expect(typeof line).toBe("string");
    expect(line).toContain("CANCELLED");
  });
});

describe("STAMP_FOR_STATUS", () => {
  it("maps every status to a valid ledger stamp label", () => {
    for (const s of ALL_STATUSES) {
      expect(LedgerVerdictSchema.safeParse(STAMP_FOR_STATUS[s]).success).toBe(true);
    }
  });

  it("uses the labels the UI expects", () => {
    expect(STAMP_FOR_STATUS).toEqual({
      DRAFT: "INFO",
      AWAITING_PAYMENT: "ALLOW",
      PAID: "PAID",
      FAILED: "FAILED",
      HELD: "HELD",
      PENDING_APPROVAL: "GATE",
      REJECTED: "DENY",
    });
  });
});
