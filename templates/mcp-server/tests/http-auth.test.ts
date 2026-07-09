import { describe, expect, it } from "vitest";
import { isAuthorized, tokensMatch } from "../src/http-auth.js";

describe("isAuthorized", () => {
  it("sin token configurado, cualquier petición pasa", () => {
    expect(isAuthorized({ headers: {} }, undefined)).toBe(true);
  });

  it("con token configurado y sin cabecera, rechaza", () => {
    expect(isAuthorized({ headers: {} }, "secreto")).toBe(false);
  });

  it("con token configurado, acepta Authorization: Bearer <token> correcto", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer secreto" } }, "secreto")).toBe(true);
  });

  it("con token configurado, acepta X-API-Key correcto", () => {
    expect(isAuthorized({ headers: { "x-api-key": "secreto" } }, "secreto")).toBe(true);
  });

  it("con token configurado y clave incorrecta, rechaza", () => {
    expect(isAuthorized({ headers: { authorization: "Bearer otra-cosa" } }, "secreto")).toBe(false);
  });
});

describe("tokensMatch", () => {
  it("compara igual solo si son idénticos", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
  });
});
