import { describe, expect, it } from "vitest";
import {
  ascendingWindow,
  clampPageSize,
  descendingWindow,
  pageCount,
} from "./pagination";

describe("descendingWindow", () => {
  it("returns the newest records first", () => {
    // 25 records, 10 per page: newest 10 are offsets 15..24.
    expect(descendingWindow(25, 0, 10)).toEqual({
      offset: 15,
      limit: 10,
      hasOlder: true,
      isEmpty: false,
    });
    expect(descendingWindow(25, 1, 10)).toEqual({
      offset: 5,
      limit: 10,
      hasOlder: true,
      isEmpty: false,
    });
    // Final page is short, not padded and not overlapping.
    expect(descendingWindow(25, 2, 10)).toEqual({
      offset: 0,
      limit: 5,
      hasOlder: false,
      isEmpty: false,
    });
  });

  it("holds the whole collection on page 0 when it is smaller than a page", () => {
    expect(descendingWindow(5, 0, 10)).toEqual({
      offset: 0,
      limit: 5,
      hasOlder: false,
      isEmpty: false,
    });
  });

  it("returns nothing once the collection has been fully paged through", () => {
    expect(descendingWindow(5, 1, 10)).toEqual({
      offset: 0,
      limit: 0,
      hasOlder: false,
      isEmpty: true,
    });
  });

  it("returns an empty window for an empty collection", () => {
    expect(descendingWindow(0, 0, 10)).toEqual({
      offset: 0,
      limit: 0,
      hasOlder: false,
      isEmpty: true,
    });
  });
});

describe("ascendingWindow", () => {
  it("matches the contracts' own oldest-first convention", () => {
    expect(ascendingWindow(25, 0, 10)).toEqual({
      offset: 0,
      limit: 10,
      hasOlder: true,
      isEmpty: false,
    });
    expect(ascendingWindow(25, 2, 10)).toEqual({
      offset: 20,
      limit: 5,
      hasOlder: false,
      isEmpty: false,
    });
  });
});

describe("pagination guards", () => {
  it("rejects a non-positive limit, which the contracts revert on", () => {
    expect(() => descendingWindow(10, 0, 0)).toThrowError(RangeError);
    expect(() => ascendingWindow(10, 0, -5)).toThrowError(RangeError);
  });

  it("rejects a negative page", () => {
    expect(() => descendingWindow(10, -1, 5)).toThrowError(RangeError);
  });

  it("clamps caller-supplied page sizes into a bounded range", () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(50)).toBe(50);
    expect(clampPageSize(10_000)).toBe(100);
    expect(clampPageSize(Number.NaN)).toBe(100);
  });

  it("computes page counts", () => {
    expect(pageCount(0, 10)).toBe(0);
    expect(pageCount(1, 10)).toBe(1);
    expect(pageCount(20, 10)).toBe(2);
    expect(pageCount(21, 10)).toBe(3);
  });
});
